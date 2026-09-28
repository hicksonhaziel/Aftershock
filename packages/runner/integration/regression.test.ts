import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION } from "@aftershock/contracts";
import { createCase, executeCase, sealFailure, exportCase, digest, loadCase } from "../src/regression.js";
import { docker } from "../src/postgres.js";
const root = resolve(import.meta.dirname, "../../..");
function setup(mode: Parameters<typeof createCase>[5] = "duplicate") {
  const directory = mkdtempSync(join(tmpdir(), "aftershock-regression-test-"));
  const raw = Buffer.from("SYNTHETIC trade input; not blockchain evidence"); writeFileSync(join(directory, "raw.pb"), raw);
  const ref = { path: "raw.pb", sha256: digest(raw) }, signature = "1".repeat(64);
  const event = { schemaVersion: 1, identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature,
    instructionPath: [5, 1, 6], ordinal: "0", projectionVersion: TRADE_PROJECTION }, slot: "100", mint: "1".repeat(32), trader: "2".repeat(32),
    side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615", provenance: ref };
  const input = { schemaVersion: 1, projectionVersion: TRADE_PROJECTION, source: "synthetic", parent: null, evidence: [],
    coverage: { status: "not-assessed", scope: "Synthetic multi-event regression fixture", startSlot: "100", endSlot: "100", missingSlots: [], exclusions: [] },
    deliveries: [{ inputId: "source-0", raw: ref, sourceSequence: "0", signature, slot: "100", events: [event, { ...event, identity: { ...event.identity, instructionPath: [5, 4, 6] }, mint: "3".repeat(32) }] }] };
  const path = join(directory, "case"); createCase(path, input, directory, join(root, ".aftershock/build"), "integration-test", mode);
  return { directory, path, input };
}

test("real PostgreSQL clean/faulted samples and relocated offline export have correct distinct exit meanings", { timeout: 240000 }, async () => {
  const t = setup();
  try {
    const baseline = await executeCase(t.path, "faulty", false); assert.equal(baseline.verdict, "PASS", JSON.stringify(baseline));
    const faulty = await executeCase(t.path, "faulty"); assert.equal(faulty.verdict, "FAIL", JSON.stringify(faulty));
    assert.deepEqual(faulty.appliedFaults.map(f => f.status), ["applied"]);
    assert.ok(faulty.discrepancies.every(d => d.kind === "total-field"));
    assert.equal(faulty.discrepancies.find(d => d.field === "solLamports")!.delta, "9007199254740993");
    const fixedBaseline = await executeCase(t.path, "fixed", false); assert.equal(fixedBaseline.verdict, "PASS");
    const fixed = await executeCase(t.path, "fixed"); assert.equal(fixed.verdict, "PASS", JSON.stringify(fixed));
    sealFailure(t.path, faulty.discrepancies);
    const exported = join(t.directory, "portable"); exportCase(t.path, exported);
    for (const [mode, variant, code] of [["test", "faulty", 1], ["test", "fixed", 0], ["reproduce", "faulty", 0], ["reproduce", "fixed", 1]] as const) {
      const result = spawnSync("/usr/bin/unshare", ["--user", "--map-root-user", "--net", process.execPath, join(exported, "regression.mjs"), mode, exported, variant],
        { cwd: exported, env: { PATH: "/usr/bin:/bin", LANG: "C" }, encoding: "utf8", timeout: 45000 });
      assert.equal(result.status, code, result.stdout + result.stderr);
    }
    // Missing dependencies and corrupted raw evidence fail before starting a database.
    writeFileSync(join(exported, "raw.pb"), "tampered");
    const invalid = spawnSync(process.execPath, [join(exported, "regression.mjs"), "test", exported, "fixed"], { encoding: "utf8", timeout: 5000 });
    assert.equal(invalid.status, 2);
    assert.throws(() => loadCase(exported));
    // Missing files and unrecorded network dependencies cannot be silently recovered online.
    writeFileSync(join(exported, "raw.pb"), readFileSync(join(t.directory, "raw.pb")));
    const lock = JSON.parse(readFileSync(join(exported, "runtime-lock.json"), "utf8"));
    lock.dependencies.push("live-rpc");
    const badLock = JSON.stringify(lock); writeFileSync(join(exported, "runtime-lock.json"), badLock);
    writeFileSync(join(exported, "runtime-lock.sha256"), digest(badLock));
    const networkDependency = spawnSync(process.execPath, [join(exported, "regression.mjs"), "test", exported, "fixed"], { encoding: "utf8", timeout: 5000 });
    assert.equal(networkDependency.status, 2);
  } finally { rmSync(t.directory, { recursive: true, force: true }); }
});

test("tampered case, empty inputs and baseline failures remain separate from injected faults", { timeout: 45000 }, async () => {
  const t = setup();
  try {
    const spec = JSON.parse(readFileSync(join(t.path, "case.json"), "utf8"));
    // A changed case without resealing its lock is a runner integrity failure, not a consumer failure.
    spec.scenario.faults[0].deliveryId = "missing-source"; writeFileSync(join(t.path, "case.json"), JSON.stringify(spec));
    assert.equal((await executeCase(t.path, "fixed")).verdict, "RUNNER_ERROR");
    const empty = { ...t.input, deliveries: t.input.deliveries.map(d => ({ ...d, events: [] })) };
    assert.throws(() => createCase(join(t.directory, "empty"), empty, t.directory, join(root, ".aftershock/build"), "empty"), /INCONCLUSIVE/);
    const repeated = { ...t.input, deliveries: [...t.input.deliveries, { ...t.input.deliveries[0]!, inputId: "source-1", sourceSequence: "1" }] };
    const preexisting = join(t.directory, "preexisting"); createCase(preexisting, repeated, t.directory, join(root, ".aftershock/build"), "baseline");
    const baseline = await executeCase(preexisting, "faulty", false);
    assert.equal(baseline.verdict, "FAIL"); assert.deepEqual(baseline.appliedFaults, []); assert.deepEqual(baseline.configuredFaults, []);
  } finally { rmSync(t.directory, { recursive: true, force: true }); }
});


test("real post-commit kill preserves rows, exposes stale checkpoint and verifies atomic fix with overlap", { timeout: 180000 }, async () => {
  const t = setup("crash");
  try {
    for (const variant of ["faulty", "fixed"] as const) {
      const run = await executeCase(t.path, variant);
      assert.equal(run.verdict, variant === "faulty" ? "FAIL" : "PASS", JSON.stringify(run));
      assert.equal(run.resetVerified, true); assert.equal(run.cleanup, "removed");
      assert.equal(run.initialStateDigest, digest(JSON.stringify({ schemaVersion: 1, events: [], totals: [], checkpoint: null }, null, 2) + "\n"));
      assert.deepEqual(run.appliedFaults.map(f => f.status), ["applied"]);
      const trace = JSON.parse(readFileSync(join(run.output, "recovery-trace.json"), "utf8"));
      const kill = trace.find((e: any) => e.kind === "crash");
      assert.equal(kill.termination, "SIGKILL"); assert.equal(kill.exitObserved, true);
      assert.equal(kill.durableCheckpoint, variant === "faulty" ? null : "0");
      assert.equal(kill.committedEventIds.length, 2); // Two events in one transaction commit together.
      assert.equal(kill.barrier.eventIds.length, 2);
      const snapshot = JSON.parse(readFileSync(join(run.output, "snapshot.json"), "utf8"));
      const state = JSON.parse(readFileSync(join(run.output, snapshot.state.path), "utf8"));
      assert.equal(state.events.length, 2); assert.equal(snapshot.checkpoint.lastDurableDelivery, "1");
      if (variant === "faulty") {
        sealFailure(t.path, run.discrepancies);
        exportCase(t.path, join(t.directory, "crash-export"));
        assert.equal(run.discrepancies.filter(d => d.field === "solLamports").length, 2);
        assert.ok(run.discrepancies.every(d => d.kind === "total-field"));
      }
    }
    const exported = join(t.directory, "crash-export");
    for (const [variant, exit] of [["faulty", 1], ["fixed", 0]] as const) {
      const result = spawnSync(process.execPath, [join(exported, "regression.mjs"), "test", exported, variant],
        { cwd: exported, env: { PATH: "/usr/bin:/bin", LANG: "C" }, encoding: "utf8", timeout: 45000 });
      assert.equal(result.status, exit, result.stdout + result.stderr);
    }
  } finally { rmSync(t.directory, { recursive: true, force: true }); }
});

test("reconnect overlap, recovered omission and permanent incompleteness have distinct outcomes", { timeout: 180000 }, async () => {
  for (const mode of ["disconnect", "temporary-omission", "permanent-omission"] as const) {
    const t = setup(mode);
    try {
      // Keep one other transaction so permanent withholding can still drain the delivered work.
      if (mode === "permanent-omission") {
        const input = structuredClone(t.input);
        input.deliveries.push({ ...input.deliveries[0]!, inputId: "source-1", sourceSequence: "1", signature: "2".repeat(64), events: input.deliveries[0]!.events.map(e => ({ ...e, identity: { ...e.identity, signature: "2".repeat(64) } })) });
        rmSync(t.path, { recursive: true }); createCase(t.path, input, t.directory, join(root, ".aftershock/build"), "integration-test", mode);
      }
      const run = await executeCase(t.path, "fixed");
      assert.equal(run.verdict, mode === "permanent-omission" ? "INCONCLUSIVE" : "PASS", JSON.stringify(run));
      assert.deepEqual(run.appliedFaults.map(f => f.status), ["applied"]);
      assert.equal(run.cleanup, "removed");
      if (mode === "permanent-omission") assert.ok(run.discrepancies.some(d => d.kind === "missing-event"));
    } finally { rmSync(t.directory, { recursive: true, force: true }); }
  }
});
