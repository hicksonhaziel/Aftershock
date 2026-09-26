import assert from "node:assert/strict";
import { test } from "node:test";
import { type CaptureManifest } from "@aftershock/contracts";
import { compareReplay } from "../src/replay.js";

function manifest(source: "live" | "provider-replay", entries: [string, string][]): CaptureManifest {
  return {
    schemaVersion: 1, captureId: "cc1356c0-42ed-4bc0-91e3-4881c8affbb2", source, provider: "solami", transport: "yellowstone",
    wireSchema: "@triton-one/yellowstone-grpc@7.0.1/SubscribeUpdate", cluster: "mainnet-beta", clusterEvidence: "separate-rpc-genesis-check",
    startedAtUtc: "2026-09-26T00:00:00.000Z", endedAtUtc: "2026-09-26T00:00:01.000Z",
    config: { schemaVersion: 1, accountInclude: ["11111111111111111111111111111111"], commitment: "confirmed",
      maxTransactions: 25, maxFrames: 100, maxBytes: 1024, durationSeconds: 1, ...(source === "provider-replay" ? { fromSlot: "10" } : {}) },
    predicate: "successful-nonvote-transaction-mentions-any-accountInclude", stopReason: "transaction-limit",
    referenceCoverage: "not-assessed", intervalCompleteness: "not-established", reconnects: 0,
    discardedFrameAtByteLimit: false, transactions: entries.length, rawBytes: entries.length,
    frames: entries.map(([slot, signature], index) => ({ sequence: index, file: `frame-${index}.pb.gz`, rawSha256: "a".repeat(64), compressedSha256: "b".repeat(64),
      rawBytes: 1, compressedBytes: 1, receivedAtUtc: "2026-09-26T00:00:00.000Z", receivedOffsetNs: String(index), kind: "transaction", slot, signature })),
  };
}
const a = "a".repeat(64), b = "b".repeat(64);

test("counts unique cross-session overlap separately from replay duplicates", () => {
  const result = compareReplay(manifest("live", [["10", a], ["10", a]]), manifest("provider-replay", [["10", a], ["10", a], ["11", b]]));
  assert.equal(result.knownTransactionCount, 1);
  assert.equal(result.reobserved.length, 1);
  assert.equal(result.duplicatesWithinReplay, 1);
  assert.equal(result.advancedBeyondRequestedSlot, true);
  assert.equal(result.captureCompleteness, "not-assessed");
});

test("slot changes do not masquerade as matching replay observations", () => {
  const result = compareReplay(manifest("live", [["10", a]]), manifest("provider-replay", [["11", a]]));
  assert.equal(result.overlapObserved, false);
  assert.equal(result.notReobserved.length, 1);
});

test("observations before the requested slot are not expected in replay", () => {
  const result = compareReplay(manifest("live", [["9", b], ["10", a]]), manifest("provider-replay", [["10", a]]));
  assert.equal(result.knownTransactionCount, 1);
  assert.equal(result.notReobserved.length, 0);
});

test("filter changes invalidate a replay comparison", () => {
  const after = manifest("provider-replay", [["10", a]]); after.config.commitment = "finalized";
  assert.throws(() => compareReplay(manifest("live", [["10", a]]), after), /filter/);
});

test("partial replay remains qualified even when overlap is observed", () => {
  const after = manifest("provider-replay", [["10", a]]); after.stopReason = "stream-error";
  const result = compareReplay(manifest("live", [["10", a], ["10", b]]), after);
  assert.equal(result.overlapObserved, true);
  assert.equal(result.sessionsHealthy, false);
  assert.equal(result.notReobserved.length, 1);
});
