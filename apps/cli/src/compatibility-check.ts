import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { verifyCapture } from "@aftershock/capture";
import { compareStreamTransaction } from "./stream-compatibility.js";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function readBounded(file: string, maxBytes: number) {
  if (statSync(file).size > maxBytes) throw new Error("Evidence exceeds audit bound.");
  return readFileSync(file);
}
try {
  const captureDirectory = process.argv[2], referenceDirectory = process.argv[3];
  if (!captureDirectory || !referenceDirectory || process.argv[4]) throw new Error("Provide capture and reference directories.");
  const { manifest, manifestHash } = verifyCapture(captureDirectory);
  const reportBytes = readBounded(join(referenceDirectory, "reference.json"), 2 * 1024 * 1024);
  const referenceHash = hash(reportBytes);
  if (referenceHash !== readBounded(join(referenceDirectory, "reference.sha256"), 100).toString().trim()) throw new Error("Reference hash mismatch.");
  const reference = JSON.parse(reportBytes.toString());
  if (reference.schemaVersion !== 1 || reference.parentCaptureId !== manifest.captureId || reference.parentManifestSha256 !== manifestHash
    || reference.reconstruction?.scope !== "full-filtered-finalized-blocks" || !Array.isArray(reference.requests)) throw new Error("Incompatible reference evidence.");
  const transactions = new Map<string, unknown>();
  let bytesRead = 0;
  for (const request of reference.requests) {
    if (request.status !== "received") continue;
    if (typeof request.file !== "string" || !/^response-[0-9]+\.json$/.test(request.file)) throw new Error("Invalid response path.");
    const bytes = readBounded(join(referenceDirectory, request.file), 16 * 1024 * 1024);
    bytesRead += bytes.length;
    if (bytesRead > 64 * 1024 * 1024 || hash(bytes) !== request.sha256 || bytes.length !== request.bytes) throw new Error("Response integrity failure.");
    if (request.method !== "getBlock") continue;
    if (!Array.isArray(request.params) || !Number.isSafeInteger(request.params[0]) || request.params[0] < 0
      || request.params[1]?.commitment !== "finalized" || request.params[1]?.transactionDetails !== "full" || request.params[1]?.encoding !== "json") throw new Error("Incompatible block request.");
    const block = JSON.parse(bytes.toString()).result;
    if (!block || !Array.isArray(block.transactions)) continue;
    for (const entry of block.transactions) {
      const signature = entry?.transaction?.signatures?.[0];
      if (typeof signature !== "string") throw new Error("Missing reference signature.");
      const key = `${request.params[0]}:${signature}`;
      if (transactions.has(key) && JSON.stringify(transactions.get(key)) !== JSON.stringify(entry)) throw new Error("Conflicting reference transactions.");
      transactions.set(key, entry);
    }
  }
  const results = manifest.frames.filter(frame => frame.kind === "transaction").map(frame => {
    const base = { sequence: frame.sequence, slot: frame.slot, signature: frame.signature };
    const entry = transactions.get(`${frame.slot}:${frame.signature}`);
    if (!entry) return { ...base, verdict: "INCONCLUSIVE" as const, reason: "missing-reference" };
    try {
      const raw = gunzipSync(readBounded(join(captureDirectory, frame.file), manifest.config.maxBytes), { maxOutputLength: manifest.config.maxBytes });
      const result = compareStreamTransaction(raw, entry);
      if (result.slot !== frame.slot || result.signature !== frame.signature) return { ...base, verdict: "FAIL" as const, reason: "manifest-identity-mismatch" };
      return { sequence: frame.sequence, ...result };
    } catch { return { ...base, verdict: "INCONCLUSIVE" as const, reason: "unsupported-or-incomplete-evidence" }; }
  });
  const verdict = results.some(item => item.verdict === "FAIL") ? "FAIL"
    : !results.length || results.some(item => item.verdict !== "PASS") ? "INCONCLUSIVE" : "PASS";
  const auditId = randomUUID();
  const directory = join(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", "compatibility", auditId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const report = { schemaVersion: 1, auditId, createdAtUtc: new Date().toISOString(), verdict,
    scope: "recorded-transaction-message-fields-only", excludes: ["balances", "logs", "inner-instructions", "business-events", "future-wire-fields", "capture-completeness"],
    parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash, parentReferenceSha256: referenceHash,
    wireSchema: manifest.wireSchema, results };
  const bytes = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(join(directory, "compatibility.json"), bytes, { flag: "wx", mode: 0o600, flush: true });
  writeFileSync(join(directory, "compatibility.sha256"), hash(bytes) + "\n", { flag: "wx", mode: 0o600, flush: true });
  console.log(`Streaming field compatibility: ${verdict}`);
  for (const status of ["PASS", "FAIL", "INCONCLUSIVE"]) console.log(`${status}: ${results.filter(item => item.verdict === status).length}`);
  const versions = [...new Set(results.flatMap(item => "referenceVersion" in item ? [String(item.referenceVersion)] : []))];
  console.log(`Reference versions exercised: ${versions.join(", ") || "none"}. This is a scoped audit, not full decoding certification.`);
  console.log(`Local evidence: ${directory}`);
  process.exitCode = verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 3;
} catch {
  console.error("Compatibility audit could not complete. Supply an intact capture and its full-filter reference; upstream data withheld.");
  process.exitCode = 2;
}
