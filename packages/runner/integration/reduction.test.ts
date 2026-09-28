import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION } from "@aftershock/contracts";
import { createCase, executeCase, sealFailure, loadCase, exportCase, digest } from "../src/regression.js";
import { reduceCase, compareCases, runPinned, subsetCase } from "../src/reduction.js";
const root = resolve(import.meta.dirname, "../../..");
test("reduction preserves multi-event transactions, same crash failure, portable history and fixed comparison", { timeout: 240000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "aftershock-reducer-test-"));
  try {
    const raw = Buffer.from("synthetic multi-event reduction fixture"); writeFileSync(join(work, "raw.pb"), raw);
    const ref = { path: "raw.pb", sha256: digest(raw) };
    const deliveries = [1, 2, 3].map(n => {
      const signature = String(n).repeat(64);
      return { inputId: `source-${n}`, sourceSequence: String(n), slot: "100", signature, raw: ref,
        events: [0, 1].map(ordinal => ({ schemaVersion: 1, identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature, instructionPath: [5, ordinal, 6], ordinal: "0", projectionVersion: TRADE_PROJECTION },
          slot: "100", mint: "1".repeat(32), trader: "2".repeat(32), side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615", provenance: ref })) };
    });
    const input = { schemaVersion: 1, projectionVersion: TRADE_PROJECTION, source: "synthetic", parent: null, evidence: [],
      coverage: { status: "not-assessed", scope: "Synthetic transaction-preserving reduction", startSlot: "100", endSlot: "100", missingSlots: [], exclusions: [] }, deliveries };
    const full = join(work, "full"); createCase(full, input, work, join(root, ".aftershock/build"), "phase3-test", "crash");
    const failing = await executeCase(full, "faulty"); assert.equal(failing.verdict, "FAIL"); sealFailure(full, failing.discrepancies);
    const originalBytes = readFileSync(join(full, "runtime-lock.json"));
    const result = await reduceCase(full, join(work, "reduction"), { maxAttempts: 6, maxSeconds: 120, maxBytes: 536870912 });
    assert.equal(result.verdict, "PASS", JSON.stringify(result)); assert.equal(result.retainedInputs.length, 1);
    assert.equal(result.minimality, "1-minimal-under-declared-transaction-units");
    const reduced = loadCase(result.directory), original = loadCase(full);
    assert.equal(reduced.input.deliveries[0]!.events.length, 2);
    assert.deepEqual(reduced.spec.scenario.faults, original.spec.scenario.faults);
    assert.equal(reduced.spec.failureFingerprint, original.spec.failureFingerprint);
    assert.deepEqual(readFileSync(join(full, "runtime-lock.json")), originalBytes);
    assert.ok(reduced.spec.history!.length >= 3);
    const expected = JSON.parse(readFileSync(join(result.directory, "expected.json"), "utf8"));
    assert.equal(expected.events.length, 2); assert.equal(expected.totals[0].count, "2");
    assert.throws(() => subsetCase(full, join(work, "invalid"), []), /prerequisites/);
    const compared = await compareCases([result.directory], join(work, "comparison"), 1);
    assert.equal(compared.verdict, "PASS", JSON.stringify(compared));
    const exported = join(work, "portable"); exportCase(compared.cases[0]!.directory, exported);
    const healthy = await runPinned(exported, "fixed", 45000); assert.equal(healthy.record.verdict, "PASS");
    assert.equal(healthy.record.requiredFaultsApplied, true);
    const liveAbort = new AbortController();
    const poll = setInterval(() => {
      const results = join(exported, "results");
      if (existsSync(results) && readdirSync(results).some(id => existsSync(join(results, id, "sample-config.json")) && !existsSync(join(results, id, "result.json")))) liveAbort.abort();
    }, 50);
    try {
      const interrupted = await runPinned(exported, "fixed", 45000, liveAbort.signal);
      assert.equal(interrupted.record.verdict, "CANCELLED"); assert.equal(interrupted.record.cleanup, "removed");
    } finally { clearInterval(poll); }

    writeFileSync(join(exported, "export-manifest.json"), "{}"); assert.throws(() => loadCase(exported), /Export manifest integrity/);
    const limited = await reduceCase(full, join(work, "limited"), { maxAttempts: 2, maxSeconds: 120, maxBytes: 536870912 });
    assert.equal(limited.verdict, "PASS"); assert.equal(limited.retainedInputs.length, 3);
    assert.equal(limited.minimality, "budget-limited-or-unresolved");
    const abort = new AbortController(); abort.abort();
    const cancelled = await reduceCase(full, join(work, "cancelled"), { maxAttempts: 2, maxSeconds: 120, maxBytes: 536870912 }, abort.signal);
    assert.equal(cancelled.verdict, "CANCELLED"); assert.equal(cancelled.retainedInputs.length, 3);
    const tiny = await reduceCase(full, join(work, "tiny"), { maxAttempts: 2, maxSeconds: 120, maxBytes: 1048576 });
    assert.equal(tiny.verdict, "INCONCLUSIVE"); assert.equal(tiny.directory, full);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
