import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readArtifact } from "@aftershock/runner";
import { loadCase, digest, json } from "../../runner/src/regression.js";
import { ControlError, type Claim, type ControlStore, type Job } from "./store.js";

export const STORAGE_LIMIT = 1024 * 1024 * 1024;
export function storageBytes(directory: string): number {
  let total = 0, entries = 0;
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      if (++entries > 100000) throw new ControlError(429, "Storage entry limit reached.");
      const child = join(path, name), stat = lstatSync(child);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Unsupported storage entry.");
      if (stat.isDirectory()) walk(child); else total += stat.size;
      if (total > STORAGE_LIMIT) throw new ControlError(429, "Workbench storage limit reached.");
    }
  };
  walk(directory); return total;
}
export function caseProvenance(directory: string) {
  const loaded = loadCase(directory);
  return { sourceMode: loaded.input.source === "live-derived" ? "saved-mainnet-replay" : loaded.input.source,
    consumer: "Maintained trade sample with an intentional faulty variant",
    capture: loaded.input.parent, coverage: loaded.input.coverage,
    inputSha256: loaded.spec.input.sha256, caseId: loaded.spec.caseId,
    assertion: loaded.spec.assertion, scenario: loaded.spec.scenario,
    inputs: loaded.input.deliveries.length, events: loaded.input.deliveries.reduce((sum, d) => sum + d.events.length, 0),
    sourceRevision: loaded.lock.sourceRevision, implementationDigest: loaded.lock.implementationDigest };
}
export function copyLockedCase(source: string, destination: string) {
  const loaded = loadCase(source);
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const ref of loaded.lock.files) {
    const bytes = readArtifact(source, ref, 64 * 1024 * 1024);
    mkdirSync(dirname(join(destination, ref.path)), { recursive: true, mode: 0o700 });
    writeFileSync(join(destination, ref.path), bytes, { flag: "wx", mode: 0o600 });
  }
  for (const name of ["runtime-lock.json", "runtime-lock.sha256", "export-manifest.json", "export-manifest.sha256"])
    if (existsSync(join(source, name))) writeFileSync(join(destination, name), readFileSync(join(source, name)), { flag: "wx", mode: 0o600 });
  loadCase(destination); return destination;
}
export async function registerTrustedCase(store: ControlStore, storage: string, projectId: string, source: string, buildRoot: string) {
  const loaded = loadCase(source), build = JSON.parse(readFileSync(join(buildRoot, "build-lock.json"), "utf8"));
  // Only operator-imported code matching the local maintained sample build is runnable.
  for (const name of ["adapter.mjs", "regression.mjs", "schema.sql"])
    if (loaded.files.get(name)?.sha256 !== build.files.find((ref: any) => ref.path === name)?.sha256) throw new ControlError(400, "Case must use the current maintained sample build.");
  const bytes = loaded.lock.files.reduce((sum, ref) => sum + readArtifact(source, ref, 64 * 1024 * 1024).length, 0);
  if (bytes > 32 * 1024 * 1024 || storageBytes(storage) + bytes + 1024 * 1024 > STORAGE_LIMIT) throw new ControlError(429, "Case or storage limit reached.");
  const lockSha256 = digest(readFileSync(join(source, "runtime-lock.json")));
  const existing = (await store.cases(projectId)).find(c => c.lockSha256 === lockSha256);
  if (existing) return { id: existing.id };
  const storagePath = `cases/${randomUUID()}`;
  mkdirSync(join(storage, "cases"), { recursive: true, mode: 0o700 });
  copyLockedCase(source, join(storage, storagePath));
  return store.registerCase(projectId, storagePath, lockSha256, caseProvenance(source));
}
export function attemptPath(storage: string, job: Pick<Job, "id" | "generation">) {
  if (!/^[a-f0-9-]{36}$/.test(job.id) || !Number.isInteger(job.generation) || job.generation < 1 || job.generation > 3) throw new Error("Invalid attempt identity.");
  return join(storage, "attempts", job.id, String(job.generation));
}
export type Artifact = { id: string; name: string; sha256: string; bytes: number };
export function publishEvidence(storage: string, claim: Claim, outcomes: { lane: "baseline" | "faulted"; output?: string | undefined }[]) {
  const target = join(attemptPath(storage, claim), "published"); mkdirSync(target, { mode: 0o700 });
  const artifacts: Artifact[] = [];
  const save = (name: string, bytes: Buffer) => {
    if (bytes.length > 16 * 1024 * 1024) throw new Error("Evidence byte limit exceeded.");
    const id = randomUUID(); writeFileSync(join(target, `${id}.json`), bytes, { flag: "wx", mode: 0o600 });
    artifacts.push({ id, name, sha256: digest(bytes), bytes: bytes.length });
  };
  const directory = join(attemptPath(storage, claim), "case"), loaded = loadCase(directory);
  for (const name of ["case.json", "input.json", "expected.json", "capture-manifest.json"])
    if (loaded.files.has(name)) save(name, readArtifact(directory, loaded.files.get(name)!, 16 * 1024 * 1024));
  for (const { lane, output } of outcomes) if (output) {
    for (const name of ["delivery-trace.json", "recovery-trace.json", "discrepancies.json", "run.json", "incident.json", "snapshot.json"]) {
      if (!existsSync(join(output, name))) continue;
      const bytes = readFileSync(join(output, name)); save(`${lane}/${name}`, bytes);
      if (name === "snapshot.json") {
        const snapshot = JSON.parse(bytes.toString());
        save(`${lane}/state.json`, readArtifact(output, snapshot.state, 16 * 1024 * 1024));
      }
    }
  }
  writeFileSync(join(target, "index.json"), json(artifacts), { flag: "wx", mode: 0o600 });
  return artifacts;
}
export function readPublishedArtifact(storage: string, job: Job, artifactId: string) {
  const ref = (job.result?.artifacts as Artifact[] | undefined)?.find(a => a.id === artifactId);
  if (!ref || !/^[a-f0-9-]{36}$/.test(ref.id)) throw new ControlError(404, "Evidence not found.");
  const directory = join(attemptPath(storage, job), "published");
  const bytes = readArtifact(directory, { path: `${ref.id}.json`, sha256: ref.sha256 }, 16 * 1024 * 1024);
  if (bytes.length !== ref.bytes) throw new Error("Evidence size mismatch.");
  return { ref, bytes };
}
