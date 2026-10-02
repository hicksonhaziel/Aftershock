import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { regressionCaseSchema, regressionInputSchema, assertionSchema, reductionBudgetSchema, attemptRecordSchema, reductionProofSchema } from "@aftershock/contracts";
import type { RegressionInput, RegressionCase, AttemptRecord } from "@aftershock/contracts";
import { eventId, expectedTradeState } from "@aftershock/projection";
import { loadCase, sealLock, digest, json, writeArtifact, failureFingerprint, failureFields, exitCode } from "./regression.js";
import { readArtifact, AdapterError } from "./index.js";
type Loaded = ReturnType<typeof loadCase>;
type Ref = { path: string; sha256: string };

/** A unit is an entire transaction, including every event and repeated source delivery. */
export function reductionUnits(input: RegressionInput, spec: RegressionCase) {
  const ids = new Map(input.deliveries.map((d, i) => [d.inputId, i]));
  const required = new Map<string, string>();
  const dependencies = new Map<string, string[]>();
  for (const edge of input.prerequisites ?? []) {
    if (!ids.has(edge.inputId) || dependencies.has(edge.inputId) || edge.requires.some(id => !ids.has(id) || ids.get(id)! >= ids.get(edge.inputId)!)) throw new Error("Invalid or nonpreceding prerequisite.");
    dependencies.set(edge.inputId, edge.requires);
  }
  for (const kept of input.retainedInputs ?? []) {
    if (!ids.has(kept.inputId)) throw new Error("Missing retained input.");
    required.set(kept.inputId, kept.reason);
  }
  for (const fault of spec.scenario.faults) {
    const anchor = fault.kind === "crash" ? input.deliveries.find(d => d.events.some(e => eventId(e) === fault.anchorEventId))?.inputId : fault.deliveryId;
    if (!anchor || !ids.has(anchor)) throw new AdapterError("INCONCLUSIVE");
    required.set(anchor, `Stable anchor for ${fault.faultId}`);
  }
  const groups = [...new Set(input.deliveries.map(d => d.signature))].map(signature => input.deliveries.filter(d => d.signature === signature).map(d => d.inputId));
  function close(retained: Set<string>) {
    for (const id of required.keys()) retained.add(id);
    let changed = true;
    while (changed) {
      const before = retained.size;
      for (const group of groups) if (group.some(id => retained.has(id))) for (const id of group) retained.add(id);
      for (const id of retained) for (const dep of dependencies.get(id) ?? []) retained.add(dep);
      changed = retained.size !== before;
    }
    return retained;
  }
  const protectedIds = close(new Set<string>());
  return { groups, close, protectedIds, reasons: [...protectedIds].map(inputId => ({ inputId, reason: required.get(inputId) ?? "Transaction companion or transitive prerequisite of a required input" })) };
}

/** Copy an immutable case while changing only retained transactions and their derived expectations. */
export function subsetCase(source: string, destination: string, selected: string[]) {
  const { lock, spec, input } = loadCase(source), policy = reductionUnits(input, spec);
  const selectedSet = new Set(selected);
  if (selectedSet.size !== selected.length || selected.some(id => !input.deliveries.some(d => d.inputId === id))
    || !isDeepStrictEqual([...policy.close(new Set(selected))].sort(), [...selected].sort())) throw new Error("Candidate violates prerequisites or stable anchors.");
  const deliveries = input.deliveries.filter(d => selectedSet.has(d.inputId));
  if (!deliveries.some(d => d.events.length)) throw new AdapterError("INCONCLUSIVE");
  const reduced = regressionInputSchema.parse({ ...input, deliveries,
    ...(input.prerequisites ? { prerequisites: input.prerequisites.filter(e => selectedSet.has(e.inputId)) } : {}),
    coverage: deliveries.length === input.deliveries.length ? input.coverage : { ...input.coverage, status: "not-assessed", scope: "Reduced recorded transaction subset; original bounds and exclusions retained, no full-interval assertion" } });
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const raw = new Set(input.deliveries.map(d => d.raw.path)), retainedRaw = new Set(deliveries.map(d => d.raw.path));
  const replace = new Set(["case.json", "input.json", "expected.json", "assertion.json"]);
  const refs: Ref[] = [];
  for (const ref of lock.files) {
    if (replace.has(ref.path) || (raw.has(ref.path) && !retainedRaw.has(ref.path) && !input.evidence.some(r => r.path === ref.path))) continue;
    const bytes = readArtifact(source, ref, 64 * 1024 * 1024);
    mkdirSync(dirname(join(destination, ref.path)), { recursive: true, mode: 0o700 });
    writeFileSync(join(destination, ref.path), bytes, { flag: "wx", mode: 0o600 }); refs.push(ref);
  }
  const inputRef = writeArtifact(destination, "input.json", reduced);
  const expectedRef = writeArtifact(destination, "expected.json", expectedTradeState(deliveries.flatMap(d => d.events)));
  const next = regressionCaseSchema.parse({ ...spec, caseId: deliveries.length === input.deliveries.length ? spec.caseId : randomUUID(), input: inputRef, scenario: { ...spec.scenario, input: inputRef } });
  const priorAssertion = assertionSchema.parse(JSON.parse(readArtifact(source, lock.files.find(r => r.path === "assertion.json")!).toString()));
  refs.push(inputRef, expectedRef, writeArtifact(destination, "case.json", next), writeArtifact(destination, "assertion.json", { ...priorAssertion, expected: expectedRef }));
  sealLock(destination, { ...lock, files: refs }); loadCase(destination);
  return next;
}

function size(directory: string): number {
  let bytes = 0;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name), info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error("Unexpected symlink in owned operation.");
    bytes += info.isDirectory() ? size(path) : info.size;
  }
  return bytes;
}

/** Always execute the runner locked inside this case, never the caller's current implementation. */
export async function runPinned(directory: string, variant: "faulty" | "fixed", timeoutMs: number, signal?: AbortSignal, faulted = true) {
  directory = resolve(directory);
  const loaded = loadCase(directory), started = Date.now();
  let text = "", overflow = false, cancelled = false;
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const child = spawn(process.execPath, [join(directory, "regression.mjs"), faulted ? "test" : "baseline", directory, variant], {
      cwd: directory, env: { PATH: "/usr/bin:/bin", LANG: "C" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    let hardStop: NodeJS.Timeout | undefined;
    const cancel = () => { if (cancelled) return; cancelled = true; child.kill("SIGTERM"); hardStop = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
    }, 90000); };
    const timer = setTimeout(cancel, Math.max(1, timeoutMs));
    signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    const receive = (chunk: Buffer) => { if (Buffer.byteLength(text) + chunk.length > 2 * 1024 * 1024) { overflow = true; cancel(); } else text += chunk.toString(); };
    child.stdout.on("data", receive); child.stderr.on("data", receive);
    child.once("error", reject);
    child.once("close", code => { clearTimeout(timer); clearTimeout(hardStop); signal?.removeEventListener("abort", cancel); resolveExit(code); });
  });
  const paths = [...text.matchAll(/^Evidence: (.+)$/gm)].map(m => m[1]!);
  let result: any, evidence: Ref[] = [], output: string | undefined;
  try {
    if (overflow || paths.length !== 1) throw new Error();
    output = resolve(paths[0]!);
    if (dirname(output) !== join(directory, "results") || !/^[a-f0-9-]{36}$/.test(output.slice(output.lastIndexOf("/") + 1))) throw new Error();
    const bytes = readFileSync(join(output, "result.json")); if (bytes.length > 16 * 1024 * 1024) throw new Error();
    result = JSON.parse(bytes.toString());
    if (code !== exitCode(result.verdict) || result.variant !== variant || result.faulted !== faulted || !isDeepStrictEqual(result.configuredFaults, faulted ? loaded.spec.scenario.faults : [])) throw new Error();
    for (const name of ["delivery-trace.json", "recovery-trace.json", "discrepancies.json"]) {
      const bytes = readFileSync(join(output, name)); evidence.push({ path: name, sha256: digest(bytes) });
    }
    if (existsSync(join(output, "snapshot.json"))) {
      const bytes = readFileSync(join(output, "snapshot.json")), snapshot = JSON.parse(bytes.toString());
      readArtifact(output, snapshot.state); evidence.push({ path: "snapshot.json", sha256: digest(bytes) }, snapshot.state);
    }
  } catch { result = { runId: randomUUID(), verdict: cancelled ? "CANCELLED" : "RUNNER_ERROR", appliedFaults: [], discrepancies: [], resetVerified: false, cleanup: "not-verified" }; output = undefined; evidence = []; }
  const requiredFaultsApplied = !faulted || loaded.spec.scenario.faults.every(f => result.appliedFaults?.some((a: any) => a.faultId === f.faultId && a.status === "applied"));
  const record = attemptRecordSchema.parse({ schemaVersion: 1, runId: result.runId, variant, verdict: cancelled ? "CANCELLED" : result.verdict,
    sourceRevision: loaded.lock.sourceRevision, implementationDigest: loaded.lock.implementationDigest,
    consumerBuildDigest: digest(json({ adapter: loaded.files.get("adapter.mjs")!.sha256, variant })),
    runtimeDigest: digest(json(loaded.lock)), inputDigest: loaded.spec.input.sha256, scenarioDigest: digest(json(faulted ? loaded.spec.scenario : { ...loaded.spec.scenario, faults: [] })),
    initialStateDigest: result.initialStateDigest ?? null,
    failureFingerprint: result.verdict === "FAIL" ? failureFingerprint(loaded.spec, loaded.input.projectionVersion, result.discrepancies) : null,
    requiredFaultsApplied, resetVerified: result.resetVerified ?? false, cleanup: result.cleanup ?? "not-verified",
    startedAtUtc: new Date(started).toISOString(), durationMs: Date.now() - started, evidence });
  return { record, output, discrepancies: result.discrepancies as any[] };
}
async function recordedAttempt(directory: string, loaded: Loaded, variant: "faulty" | "fixed", timeout: number, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof runPinned>>> {
  const started = Date.now();
  try { return await runPinned(directory, variant, timeout, signal); }
  catch (error) {
    return { output: undefined, discrepancies: [], record: attemptRecordSchema.parse({ schemaVersion: 1, runId: randomUUID(), variant,
      verdict: signal?.aborted ? "CANCELLED" : error instanceof AdapterError ? error.verdict : "RUNNER_ERROR",
      sourceRevision: loaded.lock.sourceRevision, implementationDigest: loaded.lock.implementationDigest,
      consumerBuildDigest: digest(json({ adapter: loaded.files.get("adapter.mjs")!.sha256, variant })), runtimeDigest: digest(json(loaded.lock)),
      inputDigest: loaded.spec.input.sha256, scenarioDigest: digest(json(loaded.spec.scenario)), initialStateDigest: null,
      failureFingerprint: null, requiredFaultsApplied: false, resetVerified: false, cleanup: "not-started-or-not-verified",
      startedAtUtc: new Date(started).toISOString(), durationMs: Date.now() - started, evidence: [] }) };
  }
}
export function sameFailure(loaded: Loaded, attempt: Awaited<ReturnType<typeof runPinned>>) {
  const a = attempt.record;
  return a.verdict === "FAIL" && a.failureFingerprint === loaded.spec.failureFingerprint && a.requiredFaultsApplied
    && a.resetVerified && a.cleanup === "removed" && a.initialStateDigest === loaded.spec.initialState.sha256
    && isDeepStrictEqual(failureFields(attempt.discrepancies), loaded.spec.expectedFailure);
}

/** Portable proof whitelist: excludes sample config/ownership tokens, logs and absolute local paths. */
export function attachHistory(directory: string, attempts: Awaited<ReturnType<typeof runPinned>>[], proof?: unknown) {
  const { lock, spec } = loadCase(directory), history = [...(spec.history ?? [])];
  for (const attempt of attempts) {
    const prefix = `history/${attempt.record.runId}`;
    if (history.some(r => r.path === `${prefix}/attempt.json`)) continue;
    mkdirSync(join(directory, prefix), { recursive: true, mode: 0o700 });
    const evidence: Ref[] = [];
    if (attempt.output) for (const ref of attempt.record.evidence) {
      const path = `${prefix}/${ref.path}`, bytes = readArtifact(attempt.output, ref, 64 * 1024 * 1024);
      writeFileSync(join(directory, path), bytes, { flag: "wx", mode: 0o600 }); evidence.push({ path, sha256: ref.sha256 });
    }
    const ref = writeArtifact(directory, `${prefix}/attempt.json`, { ...attempt.record, evidence });
    history.push(ref); lock.files.push(...evidence, ref);
  }
  const reduction = proof ? writeArtifact(directory, `reduction-${randomUUID()}.json`, proof) : spec.reduction;
  if (proof && reduction) lock.files.push(reduction);
  const updated = regressionCaseSchema.parse({ ...spec, history, ...(reduction ? { reduction } : {}) });
  const bytes = json(updated); writeFileSync(join(directory, "case.json"), bytes, { mode: 0o600, flush: true });
  lock.files = lock.files.map(ref => ref.path === "case.json" ? { ...ref, sha256: digest(bytes) } : ref);
  sealLock(directory, lock); loadCase(directory);
}

export async function reduceCase(source: string, destination: string, budgetValue: unknown, signal?: AbortSignal) {
  const budget = reductionBudgetSchema.parse(budgetValue), original = loadCase(source);
  if (!original.spec.failureFingerprint || !original.spec.expectedFailure.length) throw new AdapterError("UNSUPPORTED");
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const started = Date.now(), deadline = started + budget.maxSeconds * 1000;
  let best = source, retained = original.input.deliveries.map(d => d.inputId), inconclusive = false;
  let status = "RUNNER_ERROR", minimality = "not-established", historyBytes = 0;
  const attempts: Awaited<ReturnType<typeof runPinned>>[] = [], candidates: unknown[] = [];
  const copyBytes = (directory: string) => loadCase(directory).lock.files.reduce((n, ref) => n + readArtifact(directory, ref, 64 * 1024 * 1024).length, 0);
  // Reserve a complete copied run and bounded snapshots/proof before starting work.
  const fits = (directory: string) => size(destination) + copyBytes(directory) * 4 + historyBytes + 128 * 1024 * 1024 <= budget.maxBytes;
  const withinBudget = () => !signal?.aborted && Date.now() < deadline && attempts.length < budget.maxAttempts && size(destination) < budget.maxBytes;
  const attempt = async (directory: string) => {
    const result = await recordedAttempt(directory, original, "faulty", Math.min(360000, Math.max(1, deadline - Date.now())), signal);
    historyBytes += result.output ? result.record.evidence.reduce((n, ref) => n + readArtifact(result.output!, ref, 64 * 1024 * 1024).length, 0) : 0;
    attempts.push(result); writeArtifact(destination, `attempt-${attempts.length}.json`, result.record); return result;
  };
  let final: Awaited<ReturnType<typeof runPinned>> | undefined;
  try {
    if (!withinBudget() || !fits(source)) throw new AdapterError("INCONCLUSIVE");
    const baselineDirectory = join(destination, "original");
    subsetCase(source, baselineDirectory, retained); best = baselineDirectory;
    const baseline = await attempt(baselineDirectory);
    if (!sameFailure(original, baseline)) { status = baseline.record.verdict === "RUNNER_ERROR" ? "RUNNER_ERROR" : "INCONCLUSIVE"; }
    else {
      let chunk = Math.max(1, reductionUnits(original.input, original.spec).groups.length);
      while (withinBudget() && attempts.length < budget.maxAttempts - 1) {
        const current = loadCase(best), policy = reductionUnits(current.input, current.spec);
        const removable = policy.groups.filter(g => !g.some(id => policy.protectedIds.has(id)));
        if (!removable.length) { minimality = "1-minimal-under-declared-transaction-units"; break; }
        let accepted = false, exhausted = false;
        chunk = Math.min(chunk, removable.length);
        for (let i = 0; i < removable.length; i += chunk) {
          if (!withinBudget() || !fits(best) || attempts.length >= budget.maxAttempts - 1) { exhausted = true; break; }
          const removed = new Set(removable.slice(i, i + chunk).flat());
          const selected = [...policy.close(new Set(retained.filter(id => !removed.has(id))))];
          if (selected.length === retained.length) continue;
          const path = join(destination, `candidate-${candidates.length + 1}`);
          subsetCase(best, path, selected);
          if (size(destination) >= budget.maxBytes) { exhausted = true; break; }
          const outcome = await attempt(path), matches = sameFailure(original, outcome);
          candidates.push({ candidate: path.slice(destination.length + 1), retainedInputs: selected, removedInputs: retained.filter(id => !selected.includes(id)),
            verdict: outcome.record.verdict, failureFingerprint: outcome.record.failureFingerprint, accepted: matches, runId: outcome.record.runId });
          if (!["PASS", "FAIL"].includes(outcome.record.verdict)) inconclusive = true;
          if (matches) { retained = current.input.deliveries.filter(d => selected.includes(d.inputId)).map(d => d.inputId); best = path; accepted = true; break; }
        }
        if (exhausted) break;
        if (accepted) continue;
        if (chunk === 1) { if (!inconclusive) minimality = "1-minimal-under-declared-transaction-units"; break; }
        chunk = Math.max(1, Math.floor(chunk / 2));
      }
      if (withinBudget() && fits(best)) { final = await attempt(best); status = sameFailure(original, final) ? "PASS" : final.record.verdict === "RUNNER_ERROR" ? "RUNNER_ERROR" : "INCONCLUSIVE"; }
      else status = signal?.aborted ? "CANCELLED" : "INCONCLUSIVE";
      if (minimality === "not-established") minimality = "budget-limited-or-unresolved";
    }
  } catch (error) { status = signal?.aborted ? "CANCELLED" : error instanceof AdapterError ? error.verdict : "RUNNER_ERROR"; }
  if (signal?.aborted) status = "CANCELLED";
  // Never replace the caller's original; an unsuccessful final check falls back to it.
  const selectedSource = status === "PASS" ? best : source;
  let selectedIds = status === "PASS" ? retained : original.input.deliveries.map(d => d.inputId);
  let output = join(destination, "case");
  if (fits(selectedSource)) subsetCase(selectedSource, output, selectedIds);
  else { output = source; selectedIds = original.input.deliveries.map(d => d.inputId); status = signal?.aborted ? "CANCELLED" : "INCONCLUSIVE"; }
  const rawBytes = (input: RegressionInput, directory: string) => [...new Map(input.deliveries.map(d => [d.raw.path, d.raw])).values()].reduce((n, ref) => n + readArtifact(directory, ref).length, 0);
  const selected = loadCase(output);
  const report = reductionProofSchema.parse({ schemaVersion: 1, verdict: status, minimality: status === "PASS" ? minimality : "not-established", failureFingerprint: original.spec.failureFingerprint,
    parentCase: original.spec.caseId, parentInputSha256: original.spec.input.sha256, parentCapture: original.input.parent,
    originalInputs: original.input.deliveries.length, retainedInputs: selectedIds, removedInputs: original.input.deliveries.map(d => d.inputId).filter(id => !selectedIds.includes(id)),
    originalRawBytes: rawBytes(original.input, source), retainedRawBytes: rawBytes(selected.input, output),
    preserved: { initialState: original.spec.initialState, supportingEvidence: original.input.evidence,
      controlPolicy: "Normalized trade adapter has no executable stream-control frames; parent capture manifest retained as context", prerequisites: reductionUnits(selected.input, selected.spec).reasons,
      faults: original.spec.scenario.faults },
    budget, durationMs: Date.now() - started, attempts: attempts.map(a => ({ ...a.record, evidence: a.record.evidence.map(ref => ({ ...ref, path: `history/${a.record.runId}/${ref.path}` })) })), candidates,
    finalRunId: final?.record.runId ?? null, originalPreserved: true });
  if (output !== source) attachHistory(output, attempts, report); writeArtifact(destination, "reduction.json", report);
  return { ...report, directory: output };
}

export async function compareCases(cases: string[], destination: string, repeats = 5, signal?: AbortSignal) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || cases.length < 1 || cases.length > 4) throw new Error("Invalid comparison limits.");
  const inputs = cases.map(source => loadCase(source));
  if (new Set(inputs.map(c => c.spec.failureFingerprint)).size !== 1
    || new Set(inputs.map(c => c.lock.implementationDigest)).size !== 1
    || new Set(inputs.map(c => c.spec.initialState.sha256)).size !== 1) throw new Error("Comparison cases have different failure, implementation or initial state.");
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const reports = [], deadline = Date.now() + 3600000;
  for (const [index, source] of cases.entries()) {
    const loaded = loadCase(source);
    const working = join(destination, `working-${index}`); subsetCase(source, working, loaded.input.deliveries.map(d => d.inputId));
    if (!loaded.spec.failureFingerprint) throw new AdapterError("UNSUPPORTED");
    const attempts: Awaited<ReturnType<typeof runPinned>>[] = [];
    let historyBytes = 0;
    for (let i = 0; i < repeats; i++) for (const variant of ["faulty", "fixed"] as const) {
      if (signal?.aborted || Date.now() >= deadline || size(destination) + historyBytes + loaded.lock.files.reduce((n, r) => n + readArtifact(source, r, 64 * 1024 * 1024).length, 0) * 4 + 128 * 1024 * 1024 >= 1024 * 1024 * 1024) break;
      const outcome = await recordedAttempt(working, loaded, variant, Math.min(360000, deadline - Date.now()), signal);
      historyBytes += outcome.output ? outcome.record.evidence.reduce((n, ref) => n + readArtifact(outcome.output!, ref, 64 * 1024 * 1024).length, 0) : 0;
      attempts.push(outcome); writeArtifact(destination, `case-${index}-attempt-${attempts.length}.json`, outcome.record);
    }
    const faulty = attempts.filter(a => a.record.variant === "faulty"), fixed = attempts.filter(a => a.record.variant === "fixed");
    const faultyConfirmed = faulty.filter(a => sameFailure(loaded, a)).length;
    const fixedPassed = fixed.filter(a => a.record.verdict === "PASS" && a.record.requiredFaultsApplied && a.record.resetVerified
      && a.record.cleanup === "removed" && a.record.initialStateDigest === loaded.spec.initialState.sha256).length;
    const directory = join(destination, `case-${index}`); subsetCase(source, directory, loaded.input.deliveries.map(d => d.inputId)); attachHistory(directory, attempts);
    reports.push({ caseId: loaded.spec.caseId, inputSha256: loaded.spec.input.sha256, failureFingerprint: loaded.spec.failureFingerprint,
      repeats, faultyConfirmed, fixedPassed, verdict: faultyConfirmed === repeats && fixedPassed === repeats ? "PASS" : fixed.some(a => a.record.verdict === "FAIL" && a.record.requiredFaultsApplied) ? "FAIL" : "INCONCLUSIVE",
      attempts: attempts.map(a => a.record), directory });
  }
  const report = { schemaVersion: 1, verdict: signal?.aborted ? "CANCELLED" : reports.every(r => r.verdict === "PASS") ? "PASS" : reports.some(r => r.verdict === "FAIL") ? "FAIL" : "INCONCLUSIVE",
    meaning: "Finite fresh-state comparison of pinned faulty/fixed sample variants, not universal determinism", cases: reports };
  writeArtifact(destination, "comparison.json", report); return report;
}
