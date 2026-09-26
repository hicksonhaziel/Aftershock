import assert from "node:assert/strict";
import { test } from "node:test";
import { adapterDescriptionSchema, captureEnvelopeSchema, checkResultSchema } from "../src/index.js";

const envelope = {
  schemaVersion: 1,
  captureId: "synthetic-contract-fixture",
  deliveryId: "observation-1",
  sourceSequence: "9007199254740993",
  receivedAtUtc: "2026-09-26T12:00:00.000Z",
  receivedOffsetNs: "9007199254740994",
  transport: "yellowstone",
  kind: "transaction",
  slot: "9007199254740995",
  rawPayloadRef: "fixtures/synthetic/frame-1",
  rawPayloadSha256: "a".repeat(64),
};

test("preserves integers above JavaScript's safe integer range", () => {
  const parsed = captureEnvelopeSchema.parse(envelope);
  assert.equal(parsed.slot, "9007199254740995");
  assert.equal(parsed.sourceSequence, "9007199254740993");
});

test("rejects lossy numeric values and noncanonical integer strings", () => {
  for (const slot of [9007199254740995, "-1", "1.2", "01", "1e5"]) {
    assert.equal(captureEnvelopeSchema.safeParse({ ...envelope, slot }).success, false);
  }
});

test("rejects unknown schema versions and accidental extra metadata", () => {
  assert.equal(captureEnvelopeSchema.safeParse({ ...envelope, schemaVersion: 2 }).success, false);
  assert.equal(captureEnvelopeSchema.safeParse({ ...envelope, authorization: "synthetic" }).success, false);
});

test("requires explicit acknowledgement semantics before an adapter is accepted", () => {
  const adapter = {
    schemaVersion: 1,
    adapterVersion: "sample-v1",
    projectionContract: "ledger-v1",
    supportsCheckpoints: true,
    supportsFaultBarriers: ["afterDurableEffectCommit"],
    deterministicDependencies: [],
    executionControl: { controlledBoundaries: ["delivery"], uncontrolledDependencies: ["os-scheduling"] },
  };
  assert.equal(adapterDescriptionSchema.safeParse(adapter).success, false);
  assert.equal(adapterDescriptionSchema.parse({ ...adapter, acknowledgement: "receipt" }).acknowledgement, "receipt");
});

test("keeps resilience verdict separate from chain coverage", () => {
  const result = checkResultSchema.parse({
    schemaVersion: 1,
    assertionId: "aggregate-equals-clean-run",
    checkType: "metamorphic",
    verdict: "FAIL",
    coverage: "incomplete",
    summary: "Synthetic fixture: replay changes the aggregate.",
    evidenceRefs: ["fixture/diff"],
  });
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.coverage, "incomplete");
});
