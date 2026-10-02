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
