import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { adapterRequestSchema, adapterResponseSchema, emptyTradeStateSchema, projectedTradeSchema, TRADE_PROJECTION } from "@aftershock/contracts";
import { eventId } from "@aftershock/projection";
import { readArtifact } from "@aftershock/runner";
import { sql, sqlString as q, verifyContainer } from "../../../packages/runner/src/postgres.js";
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (!/^aftershock-case-[a-f0-9]{32}$/.test(config.container) || !["faulty", "fixed"].includes(config.variant)
  || !/^[a-f0-9-]{36}$/.test(config.token)) throw new Error("Invalid sample configuration.");
let state: "new" | "started" | "drained" | "stopped" = "new";
let last: string | null = null, snapshotNumber = 0;
function owned() {
  verifyContainer(config.container, config.token);
  if (sql(config.container, "SELECT ownership_token::text || ':' || run_id FROM aftershock_owner WHERE singleton;") !== `${config.token}:${config.runId}`) throw new Error("State ownership mismatch.");
}
function checkpoint() { return { schemaVersion: 1, runId: config.runId, supported: true,
  lastDurableDelivery: sql(config.container, "SELECT last_delivery::text FROM consumer_checkpoints WHERE consumer_id='sample';") || null, consumerValue: null }; }
async function handle(value: unknown) {
  const req = adapterRequestSchema.parse(value), p = req.params;
  if ("runId" in p && p.runId !== config.runId) throw new Error("Wrong run.");
  let result: unknown;
  if (req.method === "describe") result = { kind: "description", description: {
    schemaVersion: 1, adapterVersion: `maintained-trade-ledger-${config.variant}-v1`, projectionContract: TRADE_PROJECTION,
    acknowledgement: "durable-commit", supportsCheckpoints: true, supportsFaultBarriers: [],
    deterministicDependencies: ["empty-owned-postgresql", "recorded-trade-events"],
    executionControl: { controlledBoundaries: ["delivery", "durable-commit", "drain"], uncontrolledDependencies: ["host-scheduling", "local-docker-daemon"] },
  } };
  else if (req.method === "start") {
    if (state !== "new") throw new Error("Invalid lifecycle.");
    emptyTradeStateSchema.parse(JSON.parse(readArtifact(process.cwd(), req.params.initialState).toString())); owned();
    if (sql(config.container, "SELECT (SELECT count(*) FROM consumer_events)+(SELECT count(*) FROM consumer_totals)+(SELECT count(*) FROM consumer_checkpoints);") !== "0") throw new Error("Initial state is not empty.");
    state = "started"; result = { kind: "lifecycle", runId: config.runId, state: "started" };
  } else if (req.method === "deliver") {
    if (!["started", "drained"].includes(state) || (last !== null && BigInt(req.params.sequence) !== BigInt(last) + 1n)) throw new Error("Invalid delivery.");
    const values: unknown = JSON.parse(readArtifact(process.cwd(), req.params.input).toString());
    if (!Array.isArray(values) || values.length > 1000) throw new Error("Invalid input.");
    const events = values.map(v => projectedTradeSchema.parse(v)); owned();
    const statements = ["BEGIN; SET LOCAL statement_timeout='5s';"];
    for (const e of events) {
      const identity = e.identity, key = eventId(e);
      const insert = `INSERT INTO consumer_events(event_id,program,signature,instruction_path,event_ordinal,projection_version,slot,mint,side,sol_lamports,token_base_units,event) VALUES (${q(key)},${q(identity.program)},${q(identity.signature)},ARRAY[${identity.instructionPath.join(",")}],${identity.ordinal},${q(identity.projectionVersion)},${e.slot},${q(e.mint)},${q(e.side)},${e.solLamports},${e.tokenBaseUnits},${q(JSON.stringify(e))}::jsonb) ON CONFLICT DO NOTHING`;
      // Intentional defect: faulty totals include every delivery even when the event already exists.
      const contribution = config.variant === "fixed"
        ? `WITH accepted AS (${insert} RETURNING program,mint,side,sol_lamports,token_base_units) INSERT INTO consumer_totals SELECT program,mint,side,1,sol_lamports,token_base_units FROM accepted`
        : `${insert}; INSERT INTO consumer_totals VALUES (${q(identity.program)},${q(e.mint)},${q(e.side)},1,${e.solLamports},${e.tokenBaseUnits})`;
      statements.push(`${contribution} ON CONFLICT (program,mint,side) DO UPDATE SET event_count=consumer_totals.event_count+EXCLUDED.event_count, sol_lamports=consumer_totals.sol_lamports+EXCLUDED.sol_lamports, token_base_units=consumer_totals.token_base_units+EXCLUDED.token_base_units;`);
    }
    statements.push(`INSERT INTO consumer_checkpoints VALUES ('sample',${req.params.sequence},NULL) ON CONFLICT (consumer_id) DO UPDATE SET last_delivery=EXCLUDED.last_delivery; COMMIT;`);
    sql(config.container, statements.join("\n")); last = req.params.sequence; state = "started";
    result = { kind: "ack", runId: config.runId, deliveryId: req.params.deliveryId, acknowledgement: "durable-commit" };
  } else if (req.method === "drain") {
    if (state !== "started" || req.params.throughSequence !== last) throw new Error("Invalid drain.");
    owned(); if (checkpoint().lastDurableDelivery !== last) throw new Error("Durable boundary mismatch.");
    state = "drained"; result = { kind: "drained", runId: config.runId, throughSequence: last, pending: 0, writeErrors: 0, skipped: 0, deadLetters: 0 };
  } else if (req.method === "snapshot" || req.method === "checkpoint") {
    if (state !== "drained") throw new Error("Not drained."); owned();
    if (req.method === "checkpoint") result = { kind: "checkpoint", checkpoint: checkpoint() };
    else {
      const events = JSON.parse(sql(config.container, "SELECT COALESCE(jsonb_agg(event ORDER BY event_id),'[]'::jsonb) FROM consumer_events;"));
      const totals = JSON.parse(sql(config.container, `SELECT COALESCE(jsonb_agg(jsonb_build_object('program',program,'mint',mint,'side',side,'count',event_count::text,'solLamports',sol_lamports::text,'tokenBaseUnits',token_base_units::text) ORDER BY program,mint,side),'[]'::jsonb) FROM consumer_totals;`));
      const data = JSON.stringify({ schemaVersion: 1, projectionVersion: TRADE_PROJECTION, events, totals }) + "\n";
      const path = `snapshot-${++snapshotNumber}.json`; writeFileSync(join(process.cwd(), path), data, { flag: "wx", mode: 0o600, flush: true });
      result = { kind: "snapshot", snapshot: { schemaVersion: 1, runId: config.runId, projectionVersion: TRADE_PROJECTION,
        drainedThrough: last, state: { path, sha256: createHash("sha256").update(data).digest("hex") }, checkpoint: checkpoint(), excludedFields: [] } };
    }
  } else if (req.method === "stop") {
    if (!["started", "drained"].includes(state)) throw new Error("Invalid stop.");
    state = "stopped"; result = { kind: "lifecycle", runId: config.runId, state: "stopped" };
  } else if (req.method === "reset") {
    if (state !== "stopped" || req.params.ownershipToken !== config.token) throw new Error("Invalid reset."); owned();
    sql(config.container, "TRUNCATE consumer_events,consumer_totals,consumer_checkpoints;");
    state = "new"; last = null; result = { kind: "lifecycle", runId: config.runId, state: "reset" };
  } else throw new Error("Unsupported barrier.");
  return adapterResponseSchema.parse({ jsonrpc: "2.0", id: req.id, result });
}
async function main() {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("Request too large.");
    let id = "invalid";
    try { const value = JSON.parse(line); id = adapterRequestSchema.parse(value).id; process.stdout.write(JSON.stringify(await handle(value)) + "\n"); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "Maintained sample execution failed.", verdict: "RUNNER_ERROR" } }) + "\n"); }
  }
}
main().catch(() => { process.exitCode = 2; });
