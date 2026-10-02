import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PUMPFUN_PROGRAM } from "@aftershock/contracts";
import { verifyCapture } from "@aftershock/capture";
import { readArtifact } from "@aftershock/runner";
import { createCase, digest, exportCase, json, loadCase } from "../../runner/src/regression.js";
import { compareCases, reduceCase } from "../../runner/src/reduction.js";
import { readNormalized } from "../../../apps/cli/src/campaign.js";
import { repositoryRoot } from "./config.js";
import { attemptPath, caseProvenance, copyLockedCase, type Artifact } from "./artifacts.js";
import { ControlError, type Claim, type ControlStore } from "./store.js";
import type pg from "pg";

export type Publication = (client: pg.PoolClient) => Promise<Record<string, unknown>>;
// Only internal, constant CLI entrypoints are executable. Browser requests contain IDs, never paths.
async function cli(script: string, args: string[], directory: string, signal: AbortSignal, onProgress?: (value: Record<string, unknown>) => Promise<unknown>) {
  return new Promise<{ code: number; text: string }>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(repositoryRoot, "apps/cli/src", script), ...args], {
      cwd: repositoryRoot, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", AFTERSHOCK_DATA_DIR: directory, AFTERSHOCK_PROGRESS: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    let text = "", bytes = 0, pending = ""; const progress: Promise<unknown>[] = [];
    const kill = (name: NodeJS.Signals) => { try { process.kill(-child.pid!, name); } catch { /* already exited */ } };
    let force: NodeJS.Timeout | undefined;
    const stop = () => { kill("SIGTERM"); force ??= setTimeout(() => kill("SIGKILL"), 5000); };
    signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) stop(); else {
      text += chunk.toString(); pending += chunk.toString();
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const line of lines) if (onProgress && line.startsWith("AFTERSHOCK_PROGRESS=") && progress.length < 40) {
        try { const value = JSON.parse(line.slice(20)); if (Number.isInteger(value.frames) && Number.isInteger(value.transactions) && Number.isInteger(value.rawBytes) && typeof value.receivedAtUtc === "string") progress.push(onProgress(value).catch(() => {})); } catch { /* malformed progress is ignored */ }
      }
    } });
    // Upstream stderr is deliberately not retained or published.
    child.stderr.on("data", () => {});
    child.once("error", () => reject(new Error("Local operation could not start.")));
    child.once("close", (code, termination) => { try { writeFileSync(join(directory, `process-${script}.json`), json({ script, exitCode: code, termination, outputBytes: bytes, aborted: signal.aborted }), { mode: 0o600 }); } catch { reject(new Error("Local process receipt could not be saved.")); } clearTimeout(force); signal.removeEventListener("abort", stop); void Promise.all(progress).then(() => done({ code: code ?? 2, text })); });
  });
}
function privatePath(storage: string, path: string) {
  const target = resolve(storage, path);
  if (!target.startsWith(resolve(storage) + "/") || path.includes("..")) throw new Error("Invalid registry path.");
  return target;
}
function casePublication(store: ControlStore, storage: string, claim: Claim, source: string): Publication {
  const loaded = loadCase(source);
  if (loaded.lock.files.reduce((n, ref) => n + readArtifact(source, ref, 64 * 1024 * 1024).length, 0) > 32 * 1024 * 1024) throw new ControlError(429, "Case exceeds the maintained workbench byte limit.");
  const path = `cases/${randomUUID()}`; mkdirSync(join(storage, "cases"), { recursive: true, mode: 0o700 });
  copyLockedCase(source, join(storage, path));
  const hash = digest(readFileSync(join(source, "runtime-lock.json"))), provenance = caseProvenance(source);
  return client => store.publishCase(client, claim, path, hash, provenance);
}
export { casePublication };
export function publishJson(storage: string, claim: Claim, values: Record<string, unknown>): Artifact[] {
  const path = join(attemptPath(storage, claim), "published"); mkdirSync(path, { recursive: true, mode: 0o700 });
  return Object.entries(values).map(([name, value]) => {
    const bytes = Buffer.from(json(value)); if (bytes.length > 16 * 1024 * 1024) throw new Error("Evidence limit.");
    const id = randomUUID(); writeFileSync(join(path, `${id}.json`), bytes, { flag: "wx", mode: 0o600 });
    return { id, name, bytes: bytes.length, sha256: digest(bytes) };
  });
}
export async function executeOperation(store: ControlStore, storage: string, claim: Claim, signal: AbortSignal) {
  const request = claim.request, path = attemptPath(storage, claim);
  if (request.kind === "campaign") throw new Error("Campaign uses its own lanes.");
  const progress = async (stage: string) => { if (!await store.progress(claim, stage) || signal.aborted) throw new Error("Ownership lost or cancelled."); };
  await progress(request.kind);
  let result: any = { schemaVersion: 1, provenance: claim.provenance ?? null }, publication: Publication | undefined;
  let verdict = "PASS";
  if (request.kind === "capture") {
    const config = { schemaVersion: 1, accountInclude: [PUMPFUN_PROGRAM], commitment: request.commitment,
      durationSeconds: request.durationSeconds, maxTransactions: request.maxTransactions, maxFrames: 200, maxBytes: request.maxBytes };
    const configPath = join(path, "capture-config.json"); writeFileSync(configPath, json(config), { mode: 0o600 });
    const outcome = await cli("capture.ts", [configPath], path, signal, value => store.progress(claim, "recording", undefined, value));
    const root = join(path, "captures"), names = existsSync(root) ? readdirSync(root) : [];
    const directory = names.length === 1 ? join(root, names[0]!) : "";
    if (!directory || !existsSync(join(directory, "manifest.json"))) return { verdict: signal.aborted ? "CANCELLED" : "RUNNER_ERROR", result: { ...result, explanation: "Live capture could not seal. Check provider access and local setup. Partial files remain local; no automatic live retry." } };
    const { manifest, manifestHash } = verifyCapture(directory);
    const summary = { ...manifest, sourceMode: "live-mainnet", capturedAtUtc: manifest.startedAtUtc };
    result = { ...result, capture: summary, manifestSha256: manifestHash, explanation: "Raw messages saved and checksummed. Finalized membership and decoding are separate steps." };
    verdict = outcome.code === 0 ? "PASS" : outcome.code === 3 ? "INCONCLUSIVE" : "RUNNER_ERROR";
    publication = client => store.publishCapture(client, claim, relative(storage, directory), manifestHash, summary);
  } else if (request.kind === "reference" || request.kind === "normalize") {
    const capture = await store.capture(request.captureId);
    if (!capture || capture.project_id !== claim.project_id) throw new Error("Capture unavailable.");
    const directory = privatePath(storage, capture.storage_path);
    const verified = verifyCapture(directory); if (verified.manifestHash !== capture.manifest_sha256) throw new Error("Capture integrity failed.");
    result.provenance = { capture: { captureId: verified.manifest.captureId, manifest: { sha256: verified.manifestHash } }, sourceMode: "saved-mainnet-replay" };
    if (request.kind === "normalize") {
      const binary = process.env.AFTERSHOCK_DECODER_BINARY || join(repositoryRoot, ".aftershock/external/fdcb07381ec5c2a971f3107a7f9ec53542c1fb60/target/debug/solana-realtime-indexer");
      const outcome = await cli("normalize-trades.ts", [directory, binary, ...(request.allowV1Exclusions ? ["--legacy-v0-only"] : [])], path, signal);
      if (outcome.code !== 0) return { verdict: outcome.code === 3 ? "UNSUPPORTED" : "RUNNER_ERROR", result: { ...result, explanation: "Normalization failed. Check the pinned decoder, namespace support and explicit v1 exclusion selection. No campaign ran." } };
      const names = readdirSync(join(path, "normalized")); if (names.length !== 1) throw new Error();
      const normalized = join(path, "normalized", names[0]!), input = readNormalized(normalized), target = join(path, "case");
      if (capture.reference_path) {
        const referenceDirectory = privatePath(storage, capture.reference_path), referenceBytes = readFileSync(join(referenceDirectory, "reference.json"));
        if (digest(referenceBytes) !== readFileSync(join(referenceDirectory, "reference.sha256"), "utf8").trim()) throw new Error("Reference changed.");
        const reference = JSON.parse(referenceBytes.toString());
        if (reference.parentCaptureId !== verified.manifest.captureId || reference.parentManifestSha256 !== verified.manifestHash) throw new Error("Reference belongs to different inputs.");
        const refs = [{ path: "reference.json", sha256: digest(referenceBytes) }, ...reference.requests.filter((r: any) => r.status === "received").map((r: any) => ({ path: r.file, sha256: r.sha256 }))];
        mkdirSync(join(normalized, "finalized-reference"), { mode: 0o700 });
        for (const ref of refs) {
          const bytes = readArtifact(referenceDirectory, ref, 16 * 1024 * 1024), path = `finalized-reference/${ref.path}`;
          writeFileSync(join(normalized, path), bytes, { mode: 0o600, flag: "wx" }); input.evidence.push({ path, sha256: ref.sha256 });
        }
      }
      createCase(target, input, normalized, join(repositoryRoot, ".aftershock/build"), request.seed, request.preset);
      publication = casePublication(store, storage, claim, target); result.provenance = caseProvenance(target);
      result.artifacts = publishJson(storage, claim, { "normalization.json": JSON.parse(readFileSync(join(normalized, "normalization.json"), "utf8")) });
    } else {
      const slots = verified.manifest.frames.filter(f => f.slot !== undefined).map(f => BigInt(f.slot!));
      const low = slots.reduce((a, b) => a < b ? a : b), high = slots.reduce((a, b) => a > b ? a : b);
      const outcome = await cli("reference-check.ts", [directory, ...(high - low < 4n ? ["--full-filter"] : [])], path, signal);
      const root = join(path, "references"), names = existsSync(root) ? readdirSync(root) : [];
      const file = names.length === 1 ? join(root, names[0]!, "reference.json") : "";
      if (!file || !existsSync(file)) return { verdict: "INCONCLUSIVE", result: { ...result, explanation: "Finalized reference unavailable. Recording integrity remains separate; partial reference files remain local." } };
      const bytes = readFileSync(file), reference = JSON.parse(bytes.toString());
      if (bytes.length > 1024 * 1024 || digest(bytes) !== readFileSync(file.replace(".json", ".sha256"), "utf8").trim() || reference.parentManifestSha256 !== verified.manifestHash || reference.parentCaptureId !== verified.manifest.captureId) throw new Error("Reference integrity failed.");
      const summary = { referenceId: reference.referenceId, createdAtUtc: reference.createdAtUtc, parentManifestSha256: reference.parentManifestSha256,
        result: reference.result, reconstruction: reference.reconstruction, evidenceSha256: digest(bytes) };
      verdict = outcome.code === 0 ? "PASS" : outcome.code === 1 ? "FAIL" : "INCONCLUSIVE";
      result.reference = summary; result.artifacts = publishJson(storage, claim, { "reference-summary.json": summary });
      publication = async client => { await client.query("UPDATE aftershock_workbench.captures SET reference=$2,reference_path=$3 WHERE id=$1", [capture.id, json(summary), relative(storage, join(file, ".."))]); return { captureId: capture.id }; };
    }
  } else {
    const source = privatePath(storage, claim.storage_path);
    if (digest(readFileSync(join(source, "runtime-lock.json"))) !== claim.lock_sha256) throw new Error("Case registry integrity failed.");
    const directory = copyLockedCase(source, join(path, "case"));
    const loaded = loadCase(directory);
    if (request.kind === "scenario") {
      const target = join(path, "configured");
      createCase(target, loaded.input, directory, join(repositoryRoot, ".aftershock/build"), request.seed, request.preset);
      publication = casePublication(store, storage, claim, target); result.provenance = caseProvenance(target);
    } else if (request.kind === "reduce") {
      const report = await reduceCase(directory, join(path, "reduction"), { maxAttempts: request.maxAttempts, maxSeconds: request.maxSeconds, maxBytes: 256 * 1024 * 1024 }, signal, record => store.progress(claim, "reproduction-attempt", record.verdict, { variant: record.variant, runId: record.runId }));
      const { directory: reduced, ...proof } = report; result.reduction = proof; verdict = report.verdict;
      result.artifacts = publishJson(storage, claim, { "reduction.json": proof });
      if (verdict === "PASS") { publication = casePublication(store, storage, claim, reduced); result.provenance = caseProvenance(reduced); }
    } else if (request.kind === "compare") {
      const report = await compareCases([directory], join(path, "comparison"), request.repeats, signal, record => store.progress(claim, "comparison-attempt", record.verdict, { variant: record.variant, runId: record.runId }));
      result.comparison = { ...report, cases: report.cases.map(({ directory: _private, ...row }) => row) }; verdict = report.verdict;
      result.artifacts = publishJson(storage, claim, { "comparison.json": result.comparison });
      if (verdict === "PASS") publication = casePublication(store, storage, claim, report.cases[0]!.directory);
    } else if (request.kind === "export") {
      const target = exportCase(directory, join(path, "export")); loadCase(target);
      const archivePath = join(path, "case.tar.gz");
      await new Promise<void>((done, reject) => {
        const child = spawn("tar", ["-czf", archivePath, "-C", target, "."], { stdio: "ignore", signal });
        child.once("error", () => reject(new Error("Export failed."))); child.once("close", code => code === 0 ? done() : reject(new Error("Export failed.")));
      });
      const bytes = readFileSync(archivePath); if (bytes.length > 32 * 1024 * 1024) throw new Error("Export size exceeded.");
      result.download = { name: "aftershock-case.tar.gz", sha256: digest(bytes), bytes: bytes.length };
      result.commands = ["node regression.mjs reproduce . faulty", "node regression.mjs test . fixed"];
      result.artifacts = publishJson(storage, claim, { "export-manifest.json": JSON.parse(readFileSync(join(target, "export-manifest.json"), "utf8")) });
    }
  }
  if (!signal.aborted) await progress(`${request.kind}-finished`);
  return { verdict, result: { ...result, verdict }, ...(publication ? { publication } : {}) };
}
export function readCaseSource(storage: string, source: any, inputId: string) {
  const directory = privatePath(storage, source.storage_path), loaded = loadCase(directory);
  if (digest(readFileSync(join(directory, "runtime-lock.json"))) !== source.lock_sha256) throw new Error("Case integrity failed.");
  const input = loaded.input.deliveries.find(d => d.inputId === inputId);
  if (!input) throw new ControlError(404, "Source input not found.");
  const bytes = readArtifact(directory, input.raw, 2 * 1024 * 1024);
  return { inputId, signature: input.signature, slot: input.slot, sourceSequence: input.sourceSequence,
    sha256: input.raw.sha256, bytes: bytes.length, encoding: loaded.input.source === "synthetic" ? "synthetic/base64" : "protobuf/base64", payload: bytes.toString("base64"), events: input.events };
}
