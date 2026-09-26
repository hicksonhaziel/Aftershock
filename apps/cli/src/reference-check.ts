import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { verifyCapture } from "@aftershock/capture";
import { capturedTransactionSchema } from "@aftershock/contracts";
import { checkFinalizedMembership } from "@aftershock/reference";
import { MAINNET_GENESIS, readRpc, RpcFailure, type ReadMethod } from "@aftershock/solami";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
let directory: string | undefined;
const timer = setTimeout(() => {
  console.error("Reference check reached its 120-second safety timeout. Any partial evidence remains unsealed.");
  process.exit(2);
}, 120_000);
try {
  if (existsSync(".env")) loadEnvFile(".env");
  if (!process.argv[2]) throw new Error("Provide a capture directory.");
  const { manifest, manifestHash } = verifyCapture(process.argv[2]);
  const observations = manifest.frames.filter(frame => frame.kind === "transaction")
    .map(frame => capturedTransactionSchema.parse({ slot: frame.slot, signature: frame.signature }));
  if (!observations.length) throw new Error("Empty transaction capture.");
  const slots = observations.map(item => BigInt(item.slot));
  const low = slots.reduce((a, b) => a < b ? a : b), high = slots.reduce((a, b) => a > b ? a : b);
  if (high - low >= 16n || high > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Use a capture spanning at most 16 safe slots.");
  const referenceId = randomUUID();
  directory = join(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", "references", referenceId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const requests: { method: ReadMethod; params: unknown[]; status: string; file?: string; sha256?: string; bytes?: number; errorKind?: string; errorCode?: number }[] = [];
  let receivedBytes = 0;
  let storageFailed = false;
  const rpc = async (method: ReadMethod, params: unknown[] = []) => {
    const remaining = 16 * 1024 * 1024 - receivedBytes;
    if (remaining < 1) throw new RpcFailure("size");
    let response;
    try { response = await readRpc(process.env.SOLAMI_RPC_URL ?? "", method, params, fetch, Math.min(2 * 1024 * 1024, remaining)); }
    catch (error) {
      requests.push({ method, params, status: "error", errorKind: error instanceof RpcFailure ? error.kind : "unknown",
        ...(error instanceof RpcFailure && error.code !== undefined ? { errorCode: error.code } : {}) });
      throw error;
    }
    receivedBytes += response.raw.length;
    const file = `response-${requests.length}.json`;
    try { writeFileSync(join(directory!, file), response.raw, { flag: "wx", mode: 0o600, flush: true }); }
    catch { storageFailed = true; throw new Error("Evidence storage failed."); }
    requests.push({ method, params, status: "received", file, sha256: hash(response.raw), bytes: response.raw.length });
    return response.result;
  };
  if (await rpc("getGenesisHash") !== MAINNET_GENESIS) throw new Error("Not mainnet.");
  const tip = await rpc("getSlot", [{ commitment: "finalized" }]);
  if (typeof tip !== "number" || !Number.isSafeInteger(tip) || tip < 0) throw new Error("Invalid finalized tip.");
  const result = await checkFinalizedMembership(observations, String(tip), rpc);
  if (storageFailed) throw new Error("Evidence storage failed.");
  const evidence = { schemaVersion: 1, referenceId, createdAtUtc: new Date().toISOString(), provider: "solami",
    parentCaptureId: manifest.captureId, parentManifestSha256: manifestHash, receivedBytes, requests, result };
  const bytes = JSON.stringify(evidence, null, 2) + "\n";
  writeFileSync(join(directory, "reference.json"), bytes, { flag: "wx", mode: 0o600, flush: true });
  writeFileSync(join(directory, "reference.sha256"), hash(bytes) + "\n", { flag: "wx", mode: 0o600, flush: true });
  const count = (status: string) => result.transactions.filter(item => item.status === status).length;
  console.log(`Finalized membership: ${result.verdict}`);
  console.log(`Present: ${count("present")}; absent: ${count("absent")}; unresolved: ${count("unresolved")}.`);
  console.log(`Reference coverage: ${result.referenceCoverage}; capture completeness: not assessed.`);
  console.log(`Reference evidence: ${directory}`);
  process.exitCode = result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 3;
} catch {
  console.error("Reference check could not complete. Check capture integrity, its 16-slot limit, RPC access, and local storage; credentials withheld.");
  if (directory) console.error(`Unsealed evidence: ${directory}`);
  process.exitCode = 2;
} finally { clearTimeout(timer); }
