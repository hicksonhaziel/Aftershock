import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { verifyCapture } from "@aftershock/capture";
import { protobufMessageField } from "./protobuf-field.js";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
try {
  if (!process.argv[2] || (process.argv[3] && process.argv[3] !== "--legacy-v0-only") || process.argv[4]) throw new Error("Provide one capture directory and optional compatibility selection.");
  const allowExclusions = process.argv[3] === "--legacy-v0-only";
  const { manifest, manifestHash } = verifyCapture(process.argv[2]);
  const lines: string[] = [], mapping = [], exclusions = [];
  for (const frame of manifest.frames) {
    if (frame.kind !== "transaction") continue;
    const raw = gunzipSync(readFileSync(join(process.argv[2], frame.file)), { maxOutputLength: manifest.config.maxBytes });
    const update = SubscribeUpdate.decode(raw), transaction = update.transaction, info = transaction?.transaction;
    if (!transaction || !info || !info.transaction?.message || !info.meta || transaction.slot !== frame.slot || bs58.encode(info.signature) !== frame.signature
      || BigInt(transaction.slot) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsupported transaction evidence.");
    if (info.transaction.message.config !== undefined) {
      if (!allowExclusions) throw new Error("Version 1 is unsupported by the pinned consumer.");
      exclusions.push({ sourceSequence: frame.sequence, slot: frame.slot, signature: frame.signature, reason: "pinned-consumer-v1-unsupported" });
      continue;
    }
    const embedded = protobufMessageField(protobufMessageField(raw, 4), 1);
    lines.push(JSON.stringify({ slot: Number(transaction.slot), signature: frame.signature, data: Buffer.from(embedded).toString("base64") }));
    mapping.push({ line: lines.length, sourceSequence: frame.sequence, slot: frame.slot, signature: frame.signature, rawSha256: frame.rawSha256,
      embeddedSha256: hash(embedded), observedVersion: info.transaction.message.config !== undefined ? 1 : info.transaction.message.versioned ? 0 : "legacy" });
  }
  if (!lines.length) throw new Error("Empty replay input.");
  const directory = join(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", "replay-inputs", randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const data = lines.join("\n") + "\n";
  const evidence = JSON.stringify({ schemaVersion: 1, source: "live-derived", captureSource: manifest.source, controlFramesExcluded: manifest.frames.length - manifest.transactions, parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash,
    consumer: "solana-realtime-indexer", input: { file: "transactions.jsonl", sha256: hash(data), bytes: Buffer.byteLength(data) },
    framing: "slot-and-original-SubscribeUpdateTransactionInfo", decoderCompatibility: "legacy-v0-selected-business-decoding-not-assessed", exclusions, mapping }, null, 2) + "\n";
  for (const [name, bytes] of [["transactions.jsonl", data], ["replay-input.json", evidence], ["replay-input.sha256", hash(evidence) + "\n"]] as const)
    writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600, flush: true });
  console.log(`Replay input: ${directory}`);
  console.log(`Preserved ${lines.length} transaction-info messages without re-encoding. Excluded ${exclusions.length} explicitly unsupported v1 transactions; consumer business decoding is not yet assessed.`);
} catch { console.error("Replay export failed; check capture integrity, supported framing and slot precision. The pinned consumer requires legacy/v0; use --legacy-v0-only to record explicit v1 exclusions."); process.exitCode = 2; }
