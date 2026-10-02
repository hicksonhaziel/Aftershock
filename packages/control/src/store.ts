import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { operationRequestSchema, projectRequestSchema } from "@aftershock/contracts";
import { digest, json } from "../../runner/src/regression.js";

export class ControlError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export type Job = {
  id: string; project_id: string; case_id: string | null;
  request: ReturnType<typeof operationRequestSchema.parse>;
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
    kind: job.request.kind ?? "campaign", variant: "variant" in job.request ? job.request.variant : null, maxSeconds: job.request.maxSeconds,
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
      for (const migration of ["003_workbench_control.sql", "004_workbench_operations.sql"]) await client.query(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
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
  async case(id: string) { return (await this.pool.query(`SELECT * FROM ${table}.cases WHERE id=$1`, [id])).rows[0]; }
  async capture(id: string) { return (await this.pool.query(`SELECT * FROM ${table}.captures WHERE id=$1`, [id])).rows[0]; }
  async captures(projectId: string) { return (await this.pool.query(`SELECT id,summary,manifest_sha256 AS "manifestSha256",reference FROM ${table}.captures WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`, [projectId])).rows; }
  async publishCase(client: pg.PoolClient, claim: Claim, path: string, hash: string, provenance: unknown) {
    await client.query("SELECT pg_advisory_xact_lock(48372101)");
    if ((await client.query(`SELECT count(*)::int AS n FROM ${table}.cases`)).rows[0].n >= 200) throw new ControlError(429, "Case limit reached.");
    const { rows } = await client.query(`INSERT INTO ${table}.cases(id,project_id,storage_path,lock_sha256,provenance) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,lock_sha256) DO UPDATE SET lock_sha256=EXCLUDED.lock_sha256 RETURNING id`, [randomUUID(), claim.project_id, path, hash, json(provenance)]);
    return { caseId: rows[0].id };
  }
  async publishCapture(client: pg.PoolClient, claim: Pick<Claim, "project_id">, path: string, manifestHash: string, summary: any) {
    await client.query("SELECT pg_advisory_xact_lock(48372101)");
    if ((await client.query(`SELECT count(*)::int AS n FROM ${table}.captures`)).rows[0].n >= 100) throw new ControlError(429, "Capture limit reached.");
    const { rows } = await client.query(`INSERT INTO ${table}.captures(id,project_id,capture_id,storage_path,manifest_sha256,summary) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,manifest_sha256) DO UPDATE SET manifest_sha256=EXCLUDED.manifest_sha256 RETURNING id`, [randomUUID(), claim.project_id, summary.captureId, path, manifestHash, json(summary)]);
    return { captureId: rows[0].id };
  }
  async enqueue(value: unknown) {
    const body = operationRequestSchema.parse(value), hash = digest(json(body));
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(48372102)");
      const previous = await client.query(`SELECT * FROM ${table}.jobs WHERE project_id=$1 AND idempotency_key=$2`, [body.projectId, body.idempotencyKey]);
      if (previous.rowCount) {
        if (digest(json(operationRequestSchema.parse(previous.rows[0].request))) !== hash) throw new ControlError(409, "This request key already belongs to different settings.");
        return previous.rows[0] as Job;
      }
      if (!(await client.query(`SELECT id FROM ${table}.projects WHERE id=$1`, [body.projectId])).rowCount) throw new ControlError(404, "Project not found.");
      if ("caseId" in body && !(await client.query(`SELECT id FROM ${table}.cases WHERE id=$1 AND project_id=$2`, [body.caseId, body.projectId])).rowCount) throw new ControlError(404, "Case not found in this project.");
      if ("captureId" in body && !(await client.query(`SELECT id FROM ${table}.captures WHERE id=$1 AND project_id=$2`, [body.captureId, body.projectId])).rowCount) throw new ControlError(404, "Capture not found in this project.");
      if ((await client.query(`SELECT count(*)::int AS n FROM ${table}.jobs`)).rows[0].n >= 2000) throw new ControlError(429, "Saved job limit reached; operator retention is required.");
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.jobs WHERE state IN ('QUEUED','RUNNING')`);
      if (count.rows[0].count >= 20) throw new ControlError(429, "The job queue is full.");
      const { rows } = await client.query(`INSERT INTO ${table}.jobs(id,project_id,case_id,request,request_sha256,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(), body.projectId, "caseId" in body ? body.caseId : null, json(body), hash, body.idempotencyKey]);
      await this.event(client, rows[0].id, "queued", { message: `${body.kind} queued.` });
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
      const expired = await client.query(`SELECT * FROM ${table}.jobs WHERE state='RUNNING' AND lease_until<=clock_timestamp() AND (generation>=3 OR cancel_requested OR request->>'kind'='capture') FOR UPDATE SKIP LOCKED`);
      for (const job of expired.rows) {
        const verdict = job.cancel_requested ? "CANCELLED" : job.request.kind === "capture" ? "INCONCLUSIVE" : "RUNNER_ERROR";
        await client.query(`UPDATE ${table}.jobs SET state=$2,verdict=$3,worker_id=NULL,lease_until=NULL WHERE id=$1`, [job.id, verdict === "CANCELLED" ? "CANCELLED" : "COMPLETED", verdict]);
        await this.event(client, job.id, "finished", { verdict, message: "Worker lease expired; prior attempt evidence is retained locally." });
      }
      const count = await client.query(`SELECT count(*)::int AS count FROM ${table}.jobs WHERE state='RUNNING' AND lease_until>clock_timestamp()`);
      if (count.rows[0].count >= 2) return undefined;
      const candidate = await client.query(`SELECT id FROM ${table}.jobs WHERE state='QUEUED' OR (state='RUNNING' AND lease_until<=clock_timestamp() AND generation<3 AND NOT cancel_requested) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!candidate.rowCount) return undefined;
      const { rows } = await client.query(`UPDATE ${table}.jobs SET state='RUNNING',generation=generation+1,worker_id=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 RETURNING *`, [candidate.rows[0].id, workerId, leaseMs]);
      const job = rows[0] as Job; job.request = operationRequestSchema.parse(job.request);
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
  async progress(claim: Claim, stage: string, verdict?: string, details: Record<string, unknown> = {}) {
    return this.ownedMutation(claim, async client => { await this.event(client, claim.id, "progress", { stage, ...details, ...(verdict ? { verdict } : {}), message: typeof details.transactions === "number" ? `Recorded ${details.transactions} transactions / ${details.frames} frames; ${details.rawBytes} raw bytes.` : verdict ? `${stage} finished: ${verdict}.` : stage.endsWith("-finished") ? `${stage.replace("-finished", "")} finished.` : `${stage} started.` }); });
  }
  async finish(claim: Claim, verdict: string, result: unknown, publish?: (client: pg.PoolClient) => Promise<Record<string, unknown>>) {
    if (!["PASS", "FAIL", "INCONCLUSIVE", "UNSUPPORTED", "RUNNER_ERROR", "CANCELLED"].includes(verdict)) throw new Error("Invalid result verdict.");
    return this.ownedMutation(claim, async (client, job) => {
      const finalVerdict = job.cancel_requested ? "CANCELLED" : verdict;
      const links = publish && !["CANCELLED", "RUNNER_ERROR", "UNSUPPORTED"].includes(finalVerdict) ? await publish(client) : {};
      const finalResult = result && typeof result === "object" && !Array.isArray(result) ? { ...result, ...links, verdict: finalVerdict } : result;
      await client.query(`UPDATE ${table}.jobs SET state=$2,verdict=$3,result=$4,worker_id=NULL,lease_until=NULL WHERE id=$1`, [claim.id, finalVerdict === "CANCELLED" ? "CANCELLED" : "COMPLETED", finalVerdict, json(finalResult)]);
      await this.event(client, claim.id, "finished", { verdict: finalVerdict, message: "Attempt finished; saved evidence is available." });
    });
  }
}
