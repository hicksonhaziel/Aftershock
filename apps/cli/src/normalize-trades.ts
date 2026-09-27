import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { verifyCapture } from "@aftershock/capture";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION, tradeAuditSchema, projectedTradeSchema, sourceTransactionSchema } from "@aftershock/contracts";
import type { SourceTransaction } from "@aftershock/contracts";
import { expectedTradeState } from "@aftershock/projection";
import { protobufMessageField } from "./protobuf-field.js";
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const root = resolve(import.meta.dirname, "../../..");

/** Parse bounded observation output and require explicit successful replay completion. */
export function normalizeAudit(stdout: string, sources: SourceTransaction[]) {
  if (Buffer.byteLength(stdout) > 16 * 1024 * 1024 || sources.length > 1000) throw new Error("Decoder evidence limit exceeded.");
  const bySignature = new Map<string, SourceTransaction>();
  for (const value of sources) {
    const source = sourceTransactionSchema.parse(value), prior = bySignature.get(source.signature);
    if (prior) throw new Error("Repeated transaction input must be normalized separately.");
    bySignature.set(source.signature, source);
  }
  const lines = stdout.trim().split("\n");
  const summaries = lines.filter(line => line.startsWith("replay finished:"));
  if (summaries.length !== 1 || summaries[0] !== `replay finished: 1 passes, ${sources.length} sent, 0 skipped`) throw new Error("Incomplete decoder replay.");
  const collected = lines.filter(line => line.startsWith("Collected "));
  const auditLines = lines.filter(line => line.startsWith("AFTERSHOCK_TRADE_AUDIT="));
  if (auditLines.length > 10000 || collected.length !== 1 || collected[0] !== `Collected ${auditLines.length} events`) throw new Error("Unsupported or incomplete decoded event family.");
  const events = auditLines.map(line => {
    const audit = tradeAuditSchema.parse(JSON.parse(line.slice("AFTERSHOCK_TRADE_AUDIT=".length)));
    const source = bySignature.get(audit.signature);
    if (!source || source.slot !== audit.slot) throw new Error("Decoder event does not match source.");
    return projectedTradeSchema.parse({ schemaVersion: 1,
      identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature: audit.signature,
        instructionPath: audit.instructionPath, ordinal: audit.ordinal, projectionVersion: TRADE_PROJECTION },
      slot: audit.slot, mint: audit.mint, trader: audit.trader, side: audit.side,
      solLamports: audit.solLamports, tokenBaseUnits: audit.tokenBaseUnits,
      provenance: { path: `raw/${source.sourceSequence}.pb`, sha256: source.rawSha256 },
    });
  });
  const expected = expectedTradeState(events);
  if (expected.events.length !== events.length) throw new Error("Duplicate decoder event identity.");
  if (!events.length) throw new Error("No supported trade events were decoded.");
  return { events, expected };
}

export function normalizeCapture(captureDirectory: string, binary: string, allowV1Exclusions = false) {
  const { manifest, manifestHash } = verifyCapture(captureDirectory);
  if (!["transaction-limit", "frame-limit", "byte-limit", "duration"].includes(manifest.stopReason)) throw new Error("Capture did not finish successfully.");
  const decoderLock = JSON.parse(readFileSync(join(root, "integrations/solana-realtime-indexer/trade-decoder-lock.json"), "utf8"));
  if (hash(readFileSync(binary)) !== decoderLock.binarySha256) throw new Error("Decoder binary differs from verified build.");
  const sources: SourceTransaction[] = [], exclusions = [], replay: string[] = [], rawInputs: Uint8Array[] = [];
  for (const frame of manifest.frames) {
    if (frame.kind !== "transaction") continue;
    const raw = gunzipSync(readFileSync(join(captureDirectory, frame.file)), { maxOutputLength: manifest.config.maxBytes });
    const transaction = SubscribeUpdate.decode(raw).transaction, info = transaction?.transaction;
    if (!transaction || !info?.transaction?.message || !info.meta || info.meta.err || info.isVote
      || frame.slot !== transaction.slot || frame.signature !== bs58.encode(info.signature)
      || BigInt(transaction.slot) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsupported transaction evidence.");
    if (info.transaction.message.config !== undefined) {
      if (!allowV1Exclusions) throw new Error("Pinned decoder does not support v1; explicit exclusion selection required.");
      exclusions.push({ sourceSequence: frame.sequence, signature: frame.signature, reason: "pinned-consumer-v1-unsupported" });
      continue;
    }
    // One source observation per signature, so emitted events can be linked without ambiguity.
    sources.push(sourceTransactionSchema.parse({ deliveryId: `source-${frame.sequence}`, sourceSequence: frame.sequence,
      slot: frame.slot, signature: frame.signature, file: frame.file, rawSha256: frame.rawSha256 }));
    rawInputs.push(raw);
    replay.push(JSON.stringify({ slot: Number(transaction.slot), data: Buffer.from(protobufMessageField(protobufMessageField(raw, 4), 1)).toString("base64") }));
  }
  if (!sources.length) throw new Error("No supported transactions.");
  const work = mkdtempSync(join(tmpdir(), "aftershock-decode-"));
  try {
    if (existsSync(join(tmpdir(), ".env")) || existsSync("/.env")) throw new Error("Unsafe decoder dotenv ancestor.");
    const input = join(work, "transactions.jsonl");
    writeFileSync(input, replay.join("\n") + "\n", { mode: 0o600 });
    // New user/network namespaces: no outbound access. Minimal env and /tmp cwd avoid dotenv ancestors.
    const result = spawnSync("/usr/bin/unshare", ["--user", "--map-root-user", "--net", resolve(binary), "replay", "--path", input, "--repeat", "1"],
      { cwd: work, env: { PATH: "/usr/bin:/bin", LANG: "C", AFTERSHOCK_TRADE_AUDIT: "1" }, encoding: "utf8",
        timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0 || result.stderr.trim()) throw new Error("Isolated decoder failed or produced diagnostics.");
    const { events, expected } = normalizeAudit(result.stdout, sources);
    const directory = join(process.env.AFTERSHOCK_DATA_DIR || join(root, ".aftershock"), "normalized", randomUUID());
    mkdirSync(join(directory, "raw"), { recursive: true, mode: 0o700 });
    for (let i = 0; i < sources.length; i++) writeFileSync(join(directory, `raw/${sources[i]!.sourceSequence}.pb`), rawInputs[i]!, { flag: "wx", mode: 0o600, flush: true });
    writeFileSync(join(directory, "capture-manifest.json"), readFileSync(join(captureDirectory, "manifest.json")), { flag: "wx", mode: 0o600, flush: true });
    const files: Record<string, string> = { "events.json": JSON.stringify(events, null, 2) + "\n", "expected.json": JSON.stringify(expected, null, 2) + "\n" };
    const report = { schemaVersion: 1, source: "live-derived", captureSource: manifest.source,
      parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash,
      projectionVersion: TRADE_PROJECTION, decoder: decoderLock, network: "disabled-user-network-namespace",
      coverage: "not-assessed", exclusions, sources, eventCount: events.length,
      artifacts: Object.entries(files).map(([path, data]) => ({ path, sha256: hash(data) })) };
    files["normalization.json"] = JSON.stringify(report, null, 2) + "\n";
    files["normalization.sha256"] = hash(files["normalization.json"]) + "\n";
    for (const [name, data] of Object.entries(files)) writeFileSync(join(directory, name), data, { flag: "wx", mode: 0o600, flush: true });
    return { directory, transactions: sources.length, events: events.length, exclusions: exclusions.length };
  } finally { rmSync(work, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2] || !process.argv[3] || (process.argv[4] && process.argv[4] !== "--legacy-v0-only") || process.argv[5]) throw new Error("Invalid arguments.");
    const result = normalizeCapture(resolve(process.argv[2]), resolve(process.argv[3]), process.argv[4] === "--legacy-v0-only");
    console.log(`Normalized trades: ${result.directory}\n${result.events} events from ${result.transactions} transactions; ${result.exclusions} explicit v1 exclusions. Coverage remains unassessed.`);
  } catch { console.error("Trade normalization failed: check capture integrity, decoder build, supported inputs and Linux namespace support. No consumer campaign was run."); process.exitCode = 2; }
}
