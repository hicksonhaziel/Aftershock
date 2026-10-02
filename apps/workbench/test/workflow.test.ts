import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "../src/model";
import { latestCaseOutcome, relatedCaseRuns } from "../src/workflow";

function run(id: string, overrides: Partial<Run> = {}): Run {
  return { id, projectId: "project", caseId: "registered-case", kind: "campaign", variant: "fixed", state: "COMPLETED", verdict: "PASS", attempt: 1, cancelRequested: false, createdAtUtc: "2026-10-02T12:00:00.000Z", result: null, maxSeconds: 360, ...overrides };
}
const comparison = run("comparison", { kind: "compare", variant: null, result: { comparison: { cases: [{ caseId: "locked-case", repeats: 5, faultyConfirmed: 5, fixedPassed: 5, verdict: "PASS" }] } } });

test("a later campaign failure remains visible after an earlier passing comparison", () => {
  const failure = run("later-failure", { verdict: "FAIL", createdAtUtc: "2026-10-02T13:00:00.000Z" });
  const outcome = latestCaseOutcome([comparison, failure], "registered-case", "fixed");
  assert.equal(outcome?.run.id, "later-failure");
  assert.equal(outcome?.verdict, "FAIL");
  assert.equal(outcome?.detail, "");
});

test("a single-case comparison uses its report even when the registry and locked IDs differ", () => {
  assert.equal(latestCaseOutcome([comparison], "registered-case", "faulty")?.verdict, "FAIL");
  assert.equal(latestCaseOutcome([comparison], "registered-case", "faulty")?.detail, "5/5 reproduced");
  assert.equal(latestCaseOutcome([comparison], "registered-case", "fixed")?.detail, "5/5 passed");
});

test("active executions and incomplete comparison evidence do not inherit an old PASS", () => {
  const active = run("active", { state: "RUNNING", verdict: null, createdAtUtc: "2026-10-02T13:00:00.000Z" });
  assert.equal(latestCaseOutcome([comparison, active], "registered-case", "fixed")?.verdict, "RUNNING");
  const incomplete = run("incomplete", { kind: "compare", variant: null, verdict: "INCONCLUSIVE", result: { comparison: { cases: [{ repeats: 5, faultyConfirmed: 4, fixedPassed: 3, verdict: "INCONCLUSIVE" }] } } });
  assert.equal(latestCaseOutcome([incomplete], "registered-case", "faulty")?.verdict, "INCONCLUSIVE");
  assert.equal(latestCaseOutcome([incomplete], "registered-case", "fixed")?.verdict, "INCONCLUSIVE");
  assert.equal(latestCaseOutcome([comparison], "other-case", "fixed"), null);
});

test("incident links follow nested reductions and exclude unrelated cases", () => {
  const first = run("first-reduction", { kind: "reduce", result: { caseId: "reduced" } });
  const second = run("second-reduction", { caseId: "reduced", kind: "reduce", result: { caseId: "smallest" } });
  const exported = run("export", { caseId: "smallest", kind: "export", createdAtUtc: "2026-10-02T14:00:00.000Z" });
  const unrelated = run("unrelated", { caseId: "another-case", kind: "compare" });
  const chain = relatedCaseRuns([exported, unrelated, second, first], "registered-case");
  assert.deepEqual(new Set(chain.map(r => r.id)), new Set(["first-reduction", "second-reduction", "export"]));
  assert.equal(chain[0]?.id, "export");
  assert.deepEqual(relatedCaseRuns([exported], null), []);
});
