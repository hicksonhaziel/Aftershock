import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { campaignRequestSchema, projectRequestSchema } from "@aftershock/contracts";
import { digest, json } from "../../runner/src/regression.js";

export class ControlError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export type Job = {
  id: string; project_id: string; case_id: string;
  request: ReturnType<typeof campaignRequestSchema.parse>;
  state: "QUEUED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  verdict: string | null; generation: number; worker_id: string | null;
  cancel_requested: boolean; result: any;
  created_at: Date; updated_at: Date;
};
export type Claim = Job & { worker_id: string; storage_path: string; lock_sha256: string; provenance: any };
type Queryable = pg.Pool | pg.PoolClient;
const table = "aftershock_workbench";
export function publicJob(job: Job) {
  return { id: job.id, projectId: job.project_id, caseId: job.case_id,
    variant: job.request.variant, maxSeconds: job.request.maxSeconds,
    state: job.state, verdict: job.verdict, attempt: job.generation,
    cancelRequested: job.cancel_requested, createdAtUtc: job.created_at.toISOString(),
    updatedAtUtc: job.updated_at.toISOString(), result: job.result };
}

export class ControlStore {
  constructor(public readonly pool: pg.Pool) {}
  async transaction<T>(action: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async migrate() {
    await this.transaction(async client => {
      const { rows } = await client.query("SELECT current_database() AS name");
      if (!/^aftershock_control(?:_test_[a-f0-9]{32})?$/.test(rows[0].name)) throw new Error("A dedicated Aftershock control database is required.");
      await client.query("SELECT pg_advisory_xact_lock(48372100)");
      await client.query(readFileSync(new URL("../../../migrations/003_workbench_control.sql", import.meta.url), "utf8"));
    });
  }
  async createProject(value: unknown) {
    const body = projectRequestSchema.parse(value);
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(48372101)");
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.projects`);
      if (count.rows[0].count >= 100) throw new ControlError(429, "Project limit reached.");
      const { rows } = await client.query(`INSERT INTO ${table}.projects(id,name,adapter) VALUES($1,$2,$3) RETURNING id,name,adapter`, [randomUUID(), body.name, body.adapter]);
      return rows[0];
    });
  }
  async projects() { return (await this.pool.query(`SELECT id,name,adapter FROM ${table}.projects ORDER BY created_at LIMIT 100`)).rows; }
  async registerCase(projectId: string, storagePath: string, lockSha256: string, provenance: unknown) {
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(48372101)");
      if (!(await client.query(`SELECT id FROM ${table}.projects WHERE id=$1`, [projectId])).rowCount) throw new ControlError(404, "Project not found.");
      const existing = await client.query(`SELECT id,storage_path FROM ${table}.cases WHERE project_id=$1 AND lock_sha256=$2`, [projectId, lockSha256]);
      if (existing.rowCount) return existing.rows[0];
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.cases`);
      if (count.rows[0].count >= 200) throw new ControlError(429, "Case limit reached.");
      const { rows } = await client.query(`INSERT INTO ${table}.cases(id,project_id,storage_path,lock_sha256,provenance) VALUES($1,$2,$3,$4,$5) RETURNING id,storage_path`, [randomUUID(), projectId, storagePath, lockSha256, json(provenance)]);
      return rows[0];
    });
  }
  async cases(projectId: string) {
    return (await this.pool.query(`SELECT id,project_id AS "projectId",lock_sha256 AS "lockSha256",provenance FROM ${table}.cases WHERE project_id=$1 ORDER BY created_at LIMIT 200`, [projectId])).rows;
  }
  async enqueue(value: unknown) {
    const body = campaignRequestSchema.parse(value), hash = digest(json(body));
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(48372102)");
      const previous = await client.query(`SELECT * FROM ${table}.jobs WHERE project_id=$1 AND idempotency_key=$2`, [body.projectId, body.idempotencyKey]);
      if (previous.rowCount) {
        if (previous.rows[0].request_sha256 !== hash) throw new ControlError(409, "This request key already belongs to different settings.");
        return previous.rows[0] as Job;
      }
      const source = await client.query(`SELECT id FROM ${table}.cases WHERE id=$1 AND project_id=$2`, [body.caseId, body.projectId]);
      if (!source.rowCount) throw new ControlError(404, "Case not found in this project.");
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.jobs WHERE state IN ('QUEUED','RUNNING')`);
      if (count.rows[0].count >= 20) throw new ControlError(429, "The job queue is full.");
      const { rows } = await client.query(`INSERT INTO ${table}.jobs(id,project_id,case_id,request,request_sha256,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(), body.projectId, body.caseId, json(body), hash, body.idempotencyKey]);
      await this.event(client, rows[0].id, "queued", { message: "Campaign queued." });
      return rows[0] as Job;
    });
  }
  async job(id: string) { return (await this.pool.query(`SELECT * FROM ${table}.jobs WHERE id=$1`, [id])).rows[0] as Job | undefined; }
  async jobs(projectId: string) { return (await this.pool.query(`SELECT * FROM ${table}.jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`, [projectId])).rows as Job[]; }
  async events(id: string, after = 0) {
    return (await this.pool.query(`SELECT sequence,kind,payload,created_at AS "createdAtUtc" FROM ${table}.events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 128`, [id, after])).rows;
  }
  private async event(client: Queryable, id: string, kind: string, payload: unknown) {
    const { rows } = await client.query(`UPDATE ${table}.jobs SET next_event=next_event+1,updated_at=clock_timestamp() WHERE id=$1 AND next_event<128 RETURNING next_event`, [id]);
    if (!rows.length) throw new Error("Job event limit reached.");
    await client.query(`INSERT INTO ${table}.events(job_id,sequence,kind,payload) VALUES($1,$2,$3,$4)`, [id, rows[0].next_event, kind, json(payload)]);
  }
  async cancel(id: string) {
    return this.transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM ${table}.jobs WHERE id=$1 FOR UPDATE`, [id]);
      if (!rows.length) throw new ControlError(404, "Run not found.");
      const current = rows[0] as Job;
      if (["COMPLETED", "CANCELLED"].includes(current.state) || current.cancel_requested) return current;
      const updated = await client.query(`UPDATE ${table}.jobs SET cancel_requested=TRUE,state=CASE WHEN state='QUEUED' THEN 'CANCELLED' ELSE state END,verdict=CASE WHEN state='QUEUED' THEN 'CANCELLED' ELSE verdict END WHERE id=$1 RETURNING *`, [id]);
      await this.event(client, id, "cancellation-requested", { message: "Cancellation requested; active work must stop and clean up." });
      return updated.rows[0] as Job;
    });
  }
  async claim(workerId: string, leaseMs = 15000): Promise<Claim | undefined> {
    if (!/^[a-f0-9-]{36}$/.test(workerId) || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000) throw new Error("Invalid worker lease.");
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(48372103)");
      // Exhausted and cancelled expired attempts become inspectable terminal jobs.
      const expired = await client.query(`SELECT * FROM ${table}.jobs WHERE state='RUNNING' AND lease_until<=clock_timestamp() AND (generation>=3 OR cancel_requested) FOR UPDATE SKIP LOCKED`);
      for (const job of expired.rows) {
        const verdict = job.cancel_requested ? "CANCELLED" : "RUNNER_ERROR";
        await client.query(`UPDATE ${table}.jobs SET state=$2,verdict=$3,worker_id=NULL,lease_until=NULL WHERE id=$1`, [job.id, verdict === "CANCELLED" ? "CANCELLED" : "COMPLETED", verdict]);
        await this.event(client, job.id, "finished", { verdict, message: "Worker lease expired; prior attempt evidence is retained locally." });
      }
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.jobs WHERE state='RUNNING' AND lease_until>clock_timestamp()`);
      if (count.rows[0].count >= 2) return undefined;
      const candidate = await client.query(`SELECT id FROM ${table}.jobs WHERE state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp() AND generation<3 AND NOT cancel_requested) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!candidate.rowCount) return undefined;
      const { rows } = await client.query(`UPDATE ${table}.jobs SET state='RUNNING',generation=generation+1,worker_id=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 RETURNING *`, [candidate.rows[0].id, workerId, leaseMs]);
      const job = rows[0] as Job;
      const source = (await client.query(`SELECT storage_path,lock_sha256,provenance FROM ${table}.cases WHERE id=$1`, [job.case_id])).rows[0];
      await this.event(client, job.id, "claimed", { attempt: job.generation, message: job.generation === 1 ? "Worker started a fresh attempt." : "Expired attempt replaced using fresh isolated state." });
      return { ...job, worker_id: workerId, ...source };
    });
  }
  async heartbeat(claim: Claim, leaseMs = 15000) {
    const { rows } = await this.pool.query(`UPDATE ${table}.jobs SET lease_until=clock_timestamp()+$4*interval '1 millisecond' WHERE id=$1 AND worker_id=$2 AND generation=$3 AND state='RUNNING' AND lease_until>clock_timestamp() RETURNING cancel_requested`, [claim.id, claim.worker_id, claim.generation, leaseMs]);
    return rows.length ? { owned: true, cancelled: rows[0].cancel_requested as boolean } : { owned: false, cancelled: false };
  }
  async ownedMutation(claim: Claim, action: (client: pg.PoolClient, job: Job) => Promise<void>) {
    return this.transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM ${table}.jobs WHERE id=$1 AND worker_id=$2 AND generation=$3 AND state='RUNNING' AND lease_until>clock_timestamp() FOR UPDATE`, [claim.id, claim.worker_id, claim.generation]);
      if (!rows.length) return false;
      await action(client, rows[0] as Job); return true;
    });
  }
  async progress(claim: Claim, stage: "baseline" | "faulted", verdict?: string) {
    return this.ownedMutation(claim, async client => { await this.event(client, claim.id, "progress", { stage, ...(verdict ? { verdict } : {}), message: verdict ? `${stage} finished: ${verdict}.` : `${stage} started.` }); });
  }
  async finish(claim: Claim, verdict: string, result: unknown) {
    if (!["PASS", "FAIL", "INCONCLUSIVE", "UNSUPPORTED", "RUNNER_ERROR", "CANCELLED"].includes(verdict)) throw new Error("Invalid result verdict.");
    return this.ownedMutation(claim, async (client, job) => {
      const finalVerdict = job.cancel_requested ? "CANCELLED" : verdict;
      const finalResult = result && typeof result === "object" && !Array.isArray(result) ? { ...result, verdict: finalVerdict } : result;
      await client.query(`UPDATE ${table}.jobs SET state=$2,verdict=$3,result=$4,worker_id=NULL,lease_until=NULL WHERE id=$1`, [claim.id, finalVerdict === "CANCELLED" ? "CANCELLED" : "COMPLETED", finalVerdict, json(finalResult)]);
      await this.event(client, claim.id, "finished", { verdict: finalVerdict, message: "Attempt finished; saved evidence is available." });
    });
  }
}
