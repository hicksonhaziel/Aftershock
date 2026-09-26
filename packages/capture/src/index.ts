import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { captureConfigSchema, captureManifestSchema, type CaptureConfig, type CaptureFrame, type CaptureManifest } from "@aftershock/contracts";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function writeOnce(path: string, bytes: Uint8Array | string) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Initial bounded format: one independently compressed protobuf frame per chunk. */
export class CaptureWriter {
  readonly captureId = randomUUID();
  readonly directory: string;
  readonly startedAtUtc = new Date().toISOString();
  readonly config: CaptureConfig;
  private readonly startedNs = process.hrtime.bigint();
  private readonly frames: CaptureFrame[] = [];
  private sealed = false;
  private bytes = 0;

  constructor(root: string, config: CaptureConfig) {
    this.config = captureConfigSchema.parse(config);
    this.directory = join(root, "captures", this.captureId);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  append(raw: Uint8Array): number | null {
    if (this.sealed) throw new Error("Capture is sealed.");
    if (this.frames.length >= this.config.maxFrames) throw new Error("Frame limit reached.");
    if (this.bytes + raw.length > this.config.maxBytes) return null;
    const sequence = this.frames.length;
    const receivedAtUtc = new Date().toISOString();
    const receivedOffsetNs = (process.hrtime.bigint() - this.startedNs).toString();
    const compressed = gzipSync(raw);
    const file = `frame-${sequence}.pb.gz`;
    writeOnce(join(this.directory, file), compressed);
    this.frames.push({ sequence, file, rawSha256: digest(raw), compressedSha256: digest(compressed),
      rawBytes: raw.length, compressedBytes: compressed.length, receivedAtUtc, receivedOffsetNs,
      kind: "unclassified" });
    this.bytes += raw.length;
    return sequence;
  }

  classify(sequence: number, metadata: Pick<CaptureFrame, "kind" | "slot" | "signature">) {
    if (this.sealed) throw new Error("Capture is sealed.");
    const frame = this.frames[sequence];
    if (!frame) throw new Error("Unknown frame.");
    Object.assign(frame, metadata);
  }

  seal(stopReason: CaptureManifest["stopReason"], discardedFrameAtByteLimit = false) {
    if (this.sealed) throw new Error("Capture is already sealed.");
    const manifest = captureManifestSchema.parse({
      schemaVersion: 1, captureId: this.captureId, source: "live", provider: "solami", transport: "yellowstone",
      wireSchema: "@triton-one/yellowstone-grpc@7.0.1/SubscribeUpdate", cluster: "mainnet-beta",
      clusterEvidence: "separate-rpc-genesis-check", startedAtUtc: this.startedAtUtc,
      endedAtUtc: new Date().toISOString(), config: this.config,
      predicate: "successful-nonvote-transaction-mentions-any-accountInclude", stopReason,
      referenceCoverage: "not-assessed", intervalCompleteness: "not-established", reconnects: 0,
      discardedFrameAtByteLimit, transactions: this.frames.filter(f => f.kind === "transaction").length,
      rawBytes: this.bytes, frames: this.frames,
    });
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    const manifestHash = digest(Buffer.from(bytes));
    writeOnce(join(this.directory, "manifest.json"), bytes);
    writeOnce(join(this.directory, "manifest.sha256"), manifestHash + "\n");
    this.sealed = true;
    return { manifest, manifestHash };
  }
}

/** Checks byte integrity only; it does not establish chain completeness. */
export function verifyCapture(directory: string) {
  const bytes = readFileSync(join(directory, "manifest.json"));
  const expectedHash = readFileSync(join(directory, "manifest.sha256"), "utf8").trim();
  if (digest(bytes) !== expectedHash) throw new Error("Manifest hash mismatch.");
  const manifest = captureManifestSchema.parse(JSON.parse(bytes.toString()));
  let total = 0;
  for (const [index, frame] of manifest.frames.entries()) {
    if (frame.sequence !== index || frame.file !== `frame-${index}.pb.gz`) throw new Error("Frame sequence mismatch.");
    const compressed = readFileSync(join(directory, frame.file));
    if (compressed.length !== frame.compressedBytes || digest(compressed) !== frame.compressedSha256) throw new Error("Compressed frame integrity failure.");
    const raw = gunzipSync(compressed, { maxOutputLength: manifest.config.maxBytes });
    if (raw.length !== frame.rawBytes || digest(raw) !== frame.rawSha256) throw new Error("Raw frame integrity failure.");
    total += raw.length;
  }
  if (total !== manifest.rawBytes || total > manifest.config.maxBytes || manifest.frames.length > manifest.config.maxFrames) throw new Error("Capture totals mismatch.");
  if (manifest.transactions !== manifest.frames.filter(f => f.kind === "transaction").length) throw new Error("Transaction count mismatch.");
  return { manifest, manifestHash: expectedHash };
}
