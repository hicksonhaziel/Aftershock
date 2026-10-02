import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { campaignRequestSchema, projectRequestSchema, progressCursorSchema } from "@aftershock/contracts";

test("browser job requests reject code paths, arbitrary adapters, excessive budgets and ambiguous settings", () => {
  const value = { projectId: randomUUID(), caseId: randomUUID(), variant: "fixed", idempotencyKey: "request-key" };
  assert.equal(campaignRequestSchema.parse(value).maxSeconds, 360);
  for (const invalid of [{ ...value, executable: "/private/consumer" }, { ...value, maxSeconds: 361 },
    { ...value, maxSeconds: 0 }, { ...value, variant: "external" }, { ...value, caseId: "../../.env" },
    { ...value, idempotencyKey: "bad key" }]) assert.equal(campaignRequestSchema.safeParse(invalid).success, false);
  assert.equal(projectRequestSchema.safeParse({ name: "private", adapter: "upload" }).success, false);
  assert.equal(progressCursorSchema.safeParse("-1").success, false);
  assert.equal(progressCursorSchema.parse("4"), 4);
});

test("operation requests require typed IDs, bounded capture and reduction settings, and explicit decoder exclusions", async () => {
  const { operationRequestSchema } = await import("@aftershock/contracts");
  const base = { projectId: randomUUID(), idempotencyKey: "operation-key" };
  const capture = operationRequestSchema.parse({ ...base, kind: "capture" });
  assert.ok(capture.kind === "capture"); assert.equal(capture.maxTransactions, 25);
  for (const invalid of [{ ...base, kind: "capture", maxBytes: 4194305 }, { ...base, kind: "capture", durationSeconds: 31 },
    { ...base, kind: "capture", accountInclude: ["arbitrary"] }, { ...base, kind: "normalize", captureId: randomUUID() },
    { ...base, kind: "normalize", captureId: randomUUID(), allowV1Exclusions: true, binary: "/private/code" },
    { ...base, kind: "reduce", caseId: randomUUID(), maxAttempts: 21 }, { ...base, kind: "compare", caseId: randomUUID(), repeats: 6 }])
    assert.equal(operationRequestSchema.safeParse(invalid).success, false);
});
