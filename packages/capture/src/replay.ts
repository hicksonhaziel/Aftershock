import { captureManifestSchema, type CaptureManifest } from "@aftershock/contracts";

/** Observational overlap check, not a proof of recovery completeness. */
export function compareReplay(before: CaptureManifest, after: CaptureManifest) {
  captureManifestSchema.parse(before); captureManifestSchema.parse(after);
  const fromSlot = after.config.fromSlot;
  if (before.source !== "live" || after.source !== "provider-replay" || fromSlot === undefined) throw new Error("Expected live and provider-replay sessions.");
  if (before.config.commitment !== after.config.commitment || JSON.stringify([...before.config.accountInclude].sort()) !== JSON.stringify([...after.config.accountInclude].sort())) throw new Error("Replay filter must match the original capture.");
  const transactions = (capture: CaptureManifest) => capture.frames.filter(frame => frame.kind === "transaction").map(frame => {
    if (!frame.slot || !frame.signature) throw new Error("Transaction metadata is incomplete.");
    return { slot: frame.slot, signature: frame.signature };
  });
  const baseline = transactions(before).filter(item => BigInt(item.slot) >= BigInt(fromSlot));
  const replay = transactions(after);
  const key = (item: { slot: string; signature: string }) => `${item.slot}:${item.signature}`;
  const known = new Map(baseline.map(item => [key(item), item]));
  const received = new Set(replay.map(key));
  const reobserved = [...known.values()].filter(item => received.has(key(item)));
  const notReobserved = [...known.values()].filter(item => !received.has(key(item)));
  const normalStop = (capture: CaptureManifest) => ["transaction-limit", "frame-limit", "byte-limit", "duration"].includes(capture.stopReason);
  return {
    schemaVersion: 1 as const, scope: "observed-provider-replay-overlap" as const,
    fromSlot, overlapObserved: reobserved.length > 0,
    sessionsHealthy: normalStop(before) && normalStop(after),
    knownTransactionCount: known.size, replayDeliveries: replay.length,
    duplicatesWithinReplay: replay.length - received.size,
    reobserved, notReobserved,
    firstReplaySlot: replay[0]?.slot ?? null,
    advancedBeyondRequestedSlot: replay.some(item => BigInt(item.slot) > BigInt(fromSlot)),
    captureCompleteness: "not-assessed" as const,
  };
}
