import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { captureManifestSchema } from "@aftershock/contracts";
import { checkFinalizedMembership, filterFinalizedBlock } from "../../reference/src/index.js";
import { readArtifact } from "./index.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Rebuild the reference result from checksummed recorded RPC responses, without network access. */
export async function inspectReference(directory: string, manifestValue: unknown, manifestHash: string) {
  const manifest = captureManifestSchema.parse(manifestValue);
  const bytes = readFileSync(join(directory, "reference.json"));
  if (bytes.length > 1024 * 1024 || hash(bytes) !== readFileSync(join(directory, "reference.sha256"), "utf8").trim()) throw new Error("Reference integrity failed.");
  const report = JSON.parse(bytes.toString());
  if (report.schemaVersion !== 1 || report.parentCaptureId !== manifest.captureId || report.parentManifestSha256 !== manifestHash
    || !Array.isArray(report.requests) || report.requests.length > 40 || !report.reconstruction
    || !isDeepStrictEqual(report.reconstruction.predicate, manifest.predicate)) throw new Error("Reference parent or predicate mismatch.");
  let total = 0;
  const requests = report.requests.map((r: any) => {
    if (!Array.isArray(r.params) || !["received", "error"].includes(r.status)) throw new Error("Invalid reference request.");
    if (r.status === "error") return { ...r, value: null };
    const raw = readArtifact(directory, { path: r.file, sha256: r.sha256 }, 16 * 1024 * 1024);
    total += raw.length; if (total > 64 * 1024 * 1024 || raw.length !== r.bytes) throw new Error("Reference size mismatch.");
    const response = JSON.parse(raw.toString());
    if (response.error || !("result" in response)) throw new Error("Invalid recorded RPC result.");
    return { ...r, value: response.result };
  });
  const tip = requests.find((r: any) => r.method === "getSlot" && r.status === "received" && r.params[0]?.commitment === "finalized")?.value;
  if (!Number.isSafeInteger(tip) || tip < 0) throw new Error("Missing finalized tip.");
  const queue = requests.filter((r: any) => r.method === "getBlocks" || r.method === "getBlock");
  const matching: { slot: string; signature: string }[] = [];
  const result = await checkFinalizedMembership(manifest.frames.filter(f => f.kind === "transaction").map(f => ({ slot: f.slot!, signature: f.signature! })), String(tip), async (method, params) => {
    const r = queue.shift();
    if (!r || r.method !== method || r.params[0] !== params[0]) throw new Error("Unrecorded reference request.");
    if (r.status !== "received") throw new Error("Recorded RPC failure.");
    if (method === "getBlocks") {
      if (!isDeepStrictEqual(r.params, params)) throw new Error("Enumeration predicate mismatch.");
      return r.value;
    }
    if (!isDeepStrictEqual(r.params[1], { commitment: "finalized", encoding: "json", transactionDetails: "full", maxSupportedTransactionVersion: 1, rewards: false })) throw new Error("Block predicate mismatch.");
    const block = filterFinalizedBlock(r.value, manifest.config.accountInclude);
    matching.push(...block.signatures.map(signature => ({ slot: String(params[0]), signature })));
    return block;
  });
  if (!isDeepStrictEqual(result, report.result) || !isDeepStrictEqual(matching, report.reconstruction.matchingTransactions)) throw new Error("Recorded reference conclusion differs from reconstruction.");
  const observed = new Set(manifest.frames.filter(f => f.kind === "transaction").map(f => `${f.slot}:${f.signature}`));
  const notObserved = matching.filter(t => !observed.has(`${t.slot}:${t.signature}`));
  if (!isDeepStrictEqual(notObserved, report.reconstruction.notObservedInCapture)) throw new Error("Reference boundary difference mismatch.");
  return { schemaVersion: 1, assertionId: result.assertionId, checkType: "reference" as const, verdict: result.verdict,
    coverage: result.referenceCoverage, scope: "Captured transaction membership under equivalent full-block filter; not independent trade decoding or capture completeness",
    parentCaptureId: manifest.captureId, referenceSha256: hash(bytes), ledger: result.ledger,
    transactions: result.transactions, boundaryUnobserved: notObserved.length };
}
