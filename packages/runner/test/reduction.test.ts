import { test } from "node:test";
import assert from "node:assert/strict";
import { regressionInputSchema, regressionCaseSchema, PUMPFUN_PROGRAM, TRADE_PROJECTION } from "@aftershock/contracts";
import { eventId } from "@aftershock/projection";
import { reductionUnits } from "../src/reduction.js";
import { failureFingerprint } from "../src/regression.js";
const ref = { path: "raw.pb", sha256: "a".repeat(64) };
const event = { schemaVersion: 1, identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature: "1".repeat(64), instructionPath: [1], ordinal: "0", projectionVersion: TRADE_PROJECTION },
  slot: "10", mint: "1".repeat(32), trader: "2".repeat(32), side: "buy", solLamports: "10", tokenBaseUnits: "20", provenance: ref };
const input = regressionInputSchema.parse({ schemaVersion: 1, projectionVersion: TRADE_PROJECTION, source: "synthetic", parent: null, evidence: [],
  coverage: { status: "not-assessed", scope: "Synthetic dependency fixture", startSlot: "10", endSlot: "10", missingSlots: [], exclusions: [] },
  deliveries: ["setup", "anchor", "companion", "independent"].map((inputId, i) => ({ inputId, raw: ref, sourceSequence: String(i), slot: "10", signature: (i === 2 ? "2" : String(i + 1)).repeat(64), events: [{ ...event, identity: { ...event.identity, signature: (i === 2 ? "2" : String(i + 1)).repeat(64) } }] })),
  prerequisites: [{ inputId: "anchor", requires: ["setup"], reason: "Explicit initialization fixture" }] });
const spec = regressionCaseSchema.parse({ schemaVersion: 1, caseId: "11111111-1111-4111-8111-111111111111", seed: "test", input: ref, initialState: ref, assertion: "trade-state-equality-v1", requiresNonemptyEvents: true, expectedFailure: [],
  scenario: { schemaVersion: 1, scenarioId: "test", input: ref, initialState: ref, order: "recorded", faults: [{ kind: "crash", faultId: "crash", boundary: "afterDurableEffectCommit", anchorEventId: eventId(input.deliveries[1]!.events[0]!), occurrence: 1 }], limits: { durationSeconds: 120, deliveries: 20, outputBytes: 1048576 } } });
test("stable anchors retain transaction companions and transitive prerequisites", () => {
  const policy = reductionUnits(input, spec);
  assert.deepEqual([...policy.protectedIds].sort(), ["anchor", "companion", "setup"]);
  assert.deepEqual([...policy.close(new Set(["independent"]))].sort(), ["anchor", "companion", "independent", "setup"]);
});
test("missing anchors, unknown dependencies and forward or cyclic prerequisites are rejected", () => {
  const missing = structuredClone(spec); missing.scenario.faults = [{ kind: "crash", faultId: "c", boundary: "afterDurableEffectCommit", anchorEventId: "missing", occurrence: 1 }];
  assert.throws(() => reductionUnits(input, missing), /INCONCLUSIVE/);
  for (const dependency of ["unknown", "independent", "anchor"]) {
    const changed = structuredClone(input); changed.prerequisites![0]!.requires = [dependency];
    assert.throws(() => reductionUnits(changed, spec), /prerequisite/);
  }
});
test("failure identity retains assertion, anchor, group, field and direction but not changed expected totals", () => {
  const discrepancy = { kind: "total-field" as const, key: "mint-group", field: "solLamports", expected: "30", actual: "40", delta: "10" };
  const fingerprint = failureFingerprint(spec, TRADE_PROJECTION, [discrepancy]);
  assert.equal(fingerprint, failureFingerprint(spec, TRADE_PROJECTION, [{ ...discrepancy, expected: "10", actual: "20" }]));
  assert.notEqual(fingerprint, failureFingerprint(spec, TRADE_PROJECTION, [{ ...discrepancy, delta: "-10" }]));
  assert.notEqual(fingerprint, failureFingerprint(spec, TRADE_PROJECTION, [{ ...discrepancy, field: "count" }]));
  assert.notEqual(fingerprint, failureFingerprint({ ...spec, scenario: { ...spec.scenario, faults: [] } }, TRADE_PROJECTION, [discrepancy]));
});
