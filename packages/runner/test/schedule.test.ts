import { test } from "node:test";
import assert from "node:assert/strict";
import { regressionInputSchema, regressionCaseSchema } from "@aftershock/contracts";
import { schedule, exitCode } from "../src/regression.js";
const ref = { path: "input.json", sha256: "a".repeat(64) };
const input = regressionInputSchema.parse({ schemaVersion: 1, projectionVersion: "pumpfun-trades-v1", source: "synthetic", parent: null, evidence: [],
  coverage: { status: "not-assessed", scope: "Synthetic scheduler", startSlot: "1", endSlot: "1", missingSlots: [], exclusions: [] },
  deliveries: ["a", "b"].map(inputId => ({ inputId, raw: ref, sourceSequence: "0", slot: "1", signature: "1".repeat(64), events: [] })) });
const spec = regressionCaseSchema.parse({ schemaVersion: 1, caseId: "11111111-1111-4111-8111-111111111111", seed: "test", input: ref, initialState: ref,
  assertion: "trade-state-equality-v1", requiresNonemptyEvents: true, expectedFailure: [],
  scenario: { schemaVersion: 1, scenarioId: "test", input: ref, initialState: ref, order: "recorded",
    faults: [{ kind: "duplicate", faultId: "dup", deliveryId: "a", additionalDeliveries: 2 }], limits: { durationSeconds: 5, deliveries: 10, outputBytes: 1024 } } });
test("duplicate scheduling retains stable anchors and labels only actual inserted deliveries", () => {
  assert.deepEqual(schedule(input, spec, true), [{ inputId: "a", faultId: null }, { inputId: "a", faultId: "dup" }, { inputId: "a", faultId: "dup" }, { inputId: "b", faultId: null }]);
  assert.equal(schedule(input, spec, false).length, 2);
});
test("missing anchors, missing crash anchors and delivery bounds fail explicitly", () => {
  const changed = structuredClone(spec); changed.scenario.faults = [{ kind: "duplicate", faultId: "dup", deliveryId: "missing", additionalDeliveries: 1 }];
  assert.throws(() => schedule(input, changed, true), /INCONCLUSIVE/);
  changed.scenario.faults = [{ kind: "crash", faultId: "crash", boundary: "afterDurableEffectCommit", anchorEventId: "a", occurrence: 1 }];
  assert.throws(() => schedule(input, changed, true), /INCONCLUSIVE/);
  changed.scenario.limits.deliveries = 1; assert.throws(() => schedule(input, changed, false), /limit/);
});
test("exit codes distinguish assertions, runner errors and missing required evidence", () => {
  assert.deepEqual(["PASS", "FAIL", "RUNNER_ERROR", "INCONCLUSIVE", "UNSUPPORTED", "CANCELLED"].map(exitCode), [0, 1, 2, 3, 3, 3]);
});
