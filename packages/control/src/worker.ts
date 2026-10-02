import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digest, json } from "../../runner/src/regression.js";
import { runPinned } from "../../runner/src/reduction.js";
import { type ControlStore, type Claim } from "./store.js";
import { attemptPath, copyLockedCase, publishEvidence, storageBytes, STORAGE_LIMIT } from "./artifacts.js";

export async function executeClaim(store: ControlStore, storage: string, claim: Claim, shutdown?: AbortSignal) {
  const controller = new AbortController(), deadline = Date.now() + claim.request.maxSeconds * 1000;
  let lost = false, heartbeatPending = false;
  const stop = () => controller.abort(); shutdown?.addEventListener("abort", stop, { once: true });
  if (shutdown?.aborted) stop();
  const renew = async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try { const state = await store.heartbeat(claim); if (!state.owned) { lost = true; stop(); } else if (state.cancelled) stop(); }
    catch { lost = true; stop(); } finally { heartbeatPending = false; }
  };
  await renew();
  const timer = setInterval(() => { void renew(); }, 2000), budgetTimer = setTimeout(stop, claim.request.maxSeconds * 1000);
  const outcomes: ({ lane: "baseline" | "faulted" } & Awaited<ReturnType<typeof runPinned>>)[] = [];
  let verdict = "RUNNER_ERROR", artifacts: ReturnType<typeof publishEvidence> = [];
  const path = attemptPath(storage, claim);
  try {
    if (controller.signal.aborted) throw new Error();
    if (storageBytes(storage) + 128 * 1024 * 1024 > STORAGE_LIMIT) throw new Error("Insufficient workbench storage reserve.");
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (!/^cases\/[a-f0-9-]{36}$/.test(claim.storage_path)) throw new Error();
    const source = join(storage, claim.storage_path);
    if (digest(readFileSync(join(source, "runtime-lock.json"))) !== claim.lock_sha256) throw new Error();
    const directory = copyLockedCase(source, join(path, "case"));
    for (const lane of ["baseline", "faulted"] as const) {
      await renew(); if (controller.signal.aborted) break;
      if (!await store.progress(claim, lane)) { lost = true; stop(); break; }
      const result = await runPinned(directory, claim.request.variant, Math.max(1, deadline - Date.now()), controller.signal, lane === "faulted");
      outcomes.push({ lane, ...result }); verdict = result.record.verdict;
      if (!await store.progress(claim, lane, verdict)) { lost = true; stop(); break; }
      if (lane === "baseline" && verdict !== "PASS") break;
    }
    artifacts = publishEvidence(storage, claim, outcomes);
  } catch { verdict = "RUNNER_ERROR"; }
  finally {
    clearInterval(timer); clearTimeout(budgetTimer); shutdown?.removeEventListener("abort", stop);
  }
  const state = await store.heartbeat(claim).catch(() => ({ owned: false, cancelled: false }));
  if (!state.owned) lost = true;
  if (state.cancelled || shutdown?.aborted) verdict = "CANCELLED";
  else if (controller.signal.aborted && !lost) verdict = "RUNNER_ERROR";
  const result = { schemaVersion: 1, verdict, provenance: claim.provenance,
    meaning: "Application assertion on saved inputs; intentional maintained sample defect. Coverage is separate.",
    baseline: outcomes.find(o => o.lane === "baseline")?.record ?? null,
    faulted: outcomes.find(o => o.lane === "faulted")?.record ?? null,
    discrepancies: outcomes.find(o => o.lane === "faulted")?.discrepancies ?? outcomes[0]?.discrepancies ?? [], artifacts };
  if (lost) return { published: false, verdict, result };
  if (path && outcomes.length) writeFileSync(join(path, "attempt.json"), json(result), { flag: "wx", mode: 0o600 });
  const published = await store.finish(claim, verdict, result);
  return { published, verdict, result };
}
export async function runWorker(store: ControlStore, storage: string, shutdown: AbortSignal) {
  const workerId = randomUUID();
  while (!shutdown.aborted) {
    const claim = await store.claim(workerId);
    if (claim) await executeClaim(store, storage, claim, shutdown);
    else await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); shutdown.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 500); shutdown.addEventListener("abort", done, { once: true }); if (shutdown.aborted) done();
    });
  }
}
