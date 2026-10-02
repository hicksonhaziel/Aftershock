import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyCapture } from "@aftershock/capture";
import { type ControlStore } from "./store.js";
import { storageBytes, STORAGE_LIMIT } from "./artifacts.js";

/** Operator-only import; no browser endpoint accepts filesystem paths. */
export async function importSavedCapture(store: ControlStore, storage: string, projectId: string, source: string) {
  const { manifest, manifestHash } = verifyCapture(source);
  if (storageBytes(storage) + manifest.rawBytes + 1024 * 1024 > STORAGE_LIMIT) throw new Error("Storage limit.");
  const path = `captures/${randomUUID()}`, target = join(storage, path); mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const name of ["manifest.json", "manifest.sha256", ...manifest.frames.map(f => f.file)]) copyFileSync(join(source, name), join(target, name));
  if (verifyCapture(target).manifestHash !== manifestHash) throw new Error("Imported capture changed.");
  const summary = { ...manifest, sourceMode: "saved-mainnet-replay", capturedAtUtc: manifest.startedAtUtc };
  return store.transaction(client => store.publishCapture(client, { project_id: projectId }, path, manifestHash, summary));
}
