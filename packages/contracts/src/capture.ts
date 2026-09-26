import { z } from "zod";

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const captureConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accountInclude: z.array(address).min(1).max(10),
  commitment: z.enum(["confirmed", "finalized"]),
  maxTransactions: z.number().int().min(1).max(1000),
  maxFrames: z.number().int().min(1).max(2000),
  maxBytes: z.number().int().min(1024).max(64 * 1024 * 1024),
  durationSeconds: z.number().int().min(1).max(60),
  fromSlot: decimal.optional(),
});
export const captureFrameSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  file: z.string().regex(/^frame-[0-9]+\.pb\.gz$/),
  rawSha256: hash,
  compressedSha256: hash,
  rawBytes: z.number().int().nonnegative(),
  compressedBytes: z.number().int().nonnegative(),
  receivedAtUtc: z.iso.datetime(),
  receivedOffsetNs: decimal,
  kind: z.enum(["unclassified", "transaction", "control"]),
  slot: decimal.optional(),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).optional(),
});
export const captureManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  captureId: z.uuid(),
  source: z.enum(["live", "provider-replay"]),
  provider: z.literal("solami"),
  transport: z.literal("yellowstone"),
  wireSchema: z.literal("@triton-one/yellowstone-grpc@7.0.1/SubscribeUpdate"),
  cluster: z.literal("mainnet-beta"),
  clusterEvidence: z.literal("separate-rpc-genesis-check"),
  startedAtUtc: z.iso.datetime(),
  endedAtUtc: z.iso.datetime(),
  config: captureConfigSchema,
  predicate: z.literal("successful-nonvote-transaction-mentions-any-accountInclude"),
  stopReason: z.enum(["transaction-limit", "frame-limit", "byte-limit", "duration", "cancelled", "stream-ended", "stream-error", "decode-error", "filter-mismatch"]),
  referenceCoverage: z.literal("not-assessed"),
  intervalCompleteness: z.literal("not-established"),
  reconnects: z.literal(0),
  discardedFrameAtByteLimit: z.boolean(),
  transactions: z.number().int().nonnegative(),
  rawBytes: z.number().int().nonnegative(),
  frames: z.array(captureFrameSchema),
});
export type CaptureConfig = z.infer<typeof captureConfigSchema>;
export type CaptureFrame = z.infer<typeof captureFrameSchema>;
export type CaptureManifest = z.infer<typeof captureManifestSchema>;
