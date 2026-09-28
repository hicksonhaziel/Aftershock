import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { readNormalized } from "./campaign.js";
import { protobufMessageField } from "./protobuf-field.js";
import { readArtifact } from "@aftershock/runner";
import { digest, writeArtifact } from "../../../packages/runner/src/regression.js";
import { createDatabase, removeDatabase, sql, docker } from "../../../packages/runner/src/postgres.js";
import { ExternalStateAdapter } from "../../../integrations/solana-realtime-indexer/state-adapter.js";
const root = resolve(import.meta.dirname, "../../..");
const output = join(root, ".aftershock/external-state", randomUUID());
mkdirSync(output, { recursive: true, mode: 0o700 });
const work = mkdtempSync("/tmp/aftershock-external-"), token = randomUUID(), runId = randomUUID();
let container: string | undefined;
let result: Record<string, unknown> = { verdict: "RUNNER_ERROR" };
try {
  if (!process.argv[2] || !process.argv[3] || process.argv[4] || existsSync("/tmp/.env") || existsSync("/.env")) throw new Error();
  const normalized = resolve(process.argv[2]), source = resolve(process.argv[3]);
  const input = readNormalized(normalized);
  const lock = JSON.parse(readFileSync(join(root, "integrations/solana-realtime-indexer/state-lock.json"), "utf8"));
  const binary = join(source, "target/debug/solana-realtime-indexer");
  const binaryHash = digest(readFileSync(binary));
  if (binaryHash !== JSON.parse(readFileSync(join(root, "integrations/solana-realtime-indexer/trade-decoder-lock.json"), "utf8")).binarySha256) throw new Error();
  const migration = lock.migrations.map((ref: { path: string; sha256: string }) => readArtifact(source, ref).toString()).join("\n");
  const socket = join(work, "socket"); mkdirSync(socket, { mode: 0o777 }); chmodSync(socket, 0o777);
  container = await createDatabase(token, runId, readFileSync(join(root, "migrations/001_consumer_state.sql"), "utf8"), socket);
  sql(container, migration);
  const adapter = new ExternalStateAdapter(container, token, runId), initial = adapter.reset();
  const replay = input.deliveries.map(d => {
    const raw = readArtifact(normalized, d.raw);
    if (BigInt(d.slot) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
    return JSON.stringify({ slot: Number(d.slot), data: Buffer.from(protobufMessageField(protobufMessageField(raw, 4), 1)).toString("base64") });
  }).join("\n") + "\n";
  const path = join(work, "input.jsonl"); writeFileSync(path, replay, { mode: 0o600 });
  const runs = [];
  for (let pass = 0; pass < 2; pass++) {
    const child = spawnSync("/usr/bin/unshare", ["--user", "--map-root-user", "--net", binary, "replay", "--path", path, "--repeat", "1"],
      { cwd: work, env: { PATH: "/usr/bin:/bin", LANG: "C", DATABASE_URL: `postgresql://aftershock@localhost/aftershock_run?host=${socket}` },
        timeout: 60000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
    if (child.error || child.status !== 0 || child.stderr.trim()
      || !child.stdout.split("\n").includes(`replay finished: 1 passes, ${input.deliveries.length} sent, 0 skipped`)
      || !child.stdout.split("\n").includes(`Collected ${input.deliveries.flatMap(d => d.events).length} events`)) throw new Error("External replay failed.");
    const state = adapter.snapshot();
    if (state.deadLetters !== "0" || !state.trades.length || state.events.length !== input.deliveries.flatMap(d => d.events).length) throw new Error("Incomplete external state.");
    writeArtifact(output, `state-${pass}.json`, state);
    runs.push({ pass, state, recovery: adapter.recovery() });
  }
  if (!isDeepStrictEqual(runs[0]!.state.events, runs[1]!.state.events) || !isDeepStrictEqual(runs[0]!.state.trades, runs[1]!.state.trades)) throw new Error("External overlap changed state.");
  const reset = adapter.reset();
  if (!isDeepStrictEqual(initial, reset)) throw new Error("Reset changed initial state.");
  result = { schemaVersion: 1, verdict: "PASS", scope: "External finite replay, durable state inspection, restart with full recorded overlap and owned reset",
    parent: input.parent, exclusions: input.coverage.exclusions, sourceRevision: lock.revision, binaryHash,
    initialStateDigest: digest(JSON.stringify(initial)), runs, resetVerified: true, supportsFaultBarriers: [],
    limitation: "No external crash barrier; this state-control check does not complete the full external adapter acceptance." };
} catch { result = { ...result, reason: "External state check could not complete; inspect pinned build, input, migrations and local isolated database support." }; }
finally {
  try { if (container) { docker(["exec", container, "chmod", "777", "/var/run/postgresql"]); removeDatabase(container, token); } }
  catch { result.verdict = "RUNNER_ERROR"; result.cleanup = "failed"; }
  try { rmSync(work, { recursive: true, force: true }); } catch { result.verdict = "RUNNER_ERROR"; result.cleanup = "failed"; }
}
writeArtifact(output, "result.json", result);
console.log(`External state controls: ${result.verdict}\nEvidence: ${output}`);
process.exitCode = result.verdict === "PASS" ? 0 : 2;
