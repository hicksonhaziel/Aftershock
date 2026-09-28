import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { regressionCaseSchema, regressionInputSchema, regressionLockSchema, emptyTradeStateSchema, exportManifestSchema, assertionSchema, scenarioSchema, runSchema, incidentSchema, captureManifestSchema } from "@aftershock/contracts";
import type { RegressionCase, RegressionInput, RegressionLock, AdapterDescription } from "@aftershock/contracts";
import { compareTradeState, expectedTradeState, eventId } from "@aftershock/projection";
import type { Discrepancy } from "@aftershock/projection";
import { AdapterSupervisor, readArtifact, AdapterError, ObservedCrash } from "./index.js";
import { createDatabase, removeDatabase, POSTGRES_IMAGE, sql } from "./postgres.js";
export const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function writeArtifact(directory: string, path: string, value: unknown) {
  const data = json(value); writeFileSync(join(directory, path), data, { flag: "wx", mode: 0o600, flush: true });
  return { path, sha256: digest(data) };
}
export const failureFields = (discrepancies: Discrepancy[]) => discrepancies.map(d => ({ kind: d.kind, key: d.key, ...(d.field ? { field: d.field } : {}) }))
  .sort((a, b) => { const left = JSON.stringify(a), right = JSON.stringify(b); return left < right ? -1 : left > right ? 1 : 0; });
export function schedule(input: RegressionInput, spec: RegressionCase, faulted: boolean) {
  const planned = input.deliveries.map(d => ({ inputId: d.inputId, faultId: null as string | null }));
  if (planned.length > spec.scenario.limits.deliveries) throw new Error("Delivery limit exceeded.");
  if (!faulted) return planned;
  if (spec.scenario.faults.length > 1 && spec.scenario.faults.some(f => f.kind !== "duplicate")) throw new AdapterError("UNSUPPORTED");
  for (const fault of spec.scenario.faults) {
    if (fault.kind === "disconnect" || fault.kind === "omission") {
      const index = planned.findIndex(d => d.inputId === fault.deliveryId);
      if (index < 0) throw new AdapterError("INCONCLUSIVE");
      if (fault.kind === "disconnect") planned.splice(index + 1, 0, { inputId: fault.deliveryId, faultId: fault.faultId });
      else { const [removed] = planned.splice(index, 1); if (fault.recover) planned.push({ ...removed!, faultId: fault.faultId }); }
      continue;
    }
    if (fault.kind === "crash") {
      if (spec.scenario.faults.length !== 1 || fault.occurrence !== 1) throw new AdapterError("UNSUPPORTED");
      const anchor = input.deliveries.find(d => d.events.some(e => eventId(e) === fault.anchorEventId));
      if (!anchor) throw new AdapterError("INCONCLUSIVE");
      const index = planned.findIndex(d => d.inputId === anchor.inputId);
      planned.splice(index + 1, 0, { inputId: anchor.inputId, faultId: fault.faultId });
      continue;
    }
    const index = planned.findIndex(d => d.inputId === fault.deliveryId && d.faultId === null);
    if (index < 0) throw new AdapterError("INCONCLUSIVE");
    planned.splice(index + 1, 0, ...Array.from({ length: fault.additionalDeliveries }, () => ({ inputId: fault.deliveryId, faultId: fault.faultId })));
  }
  if (planned.length > spec.scenario.limits.deliveries) throw new Error("Delivery limit exceeded.");
  return planned;
}
export function loadCase(directory: string) {
  const lockBytes = readFileSync(join(directory, "runtime-lock.json"));
  if (lockBytes.length > 1024 * 1024 || digest(lockBytes) !== readFileSync(join(directory, "runtime-lock.sha256"), "utf8").trim()) throw new Error("Runtime lock integrity failed.");
  const lock = regressionLockSchema.parse(JSON.parse(lockBytes.toString()));
  if (process.version !== lock.node || process.platform !== lock.platform || process.arch !== lock.architecture || lock.postgresImage !== POSTGRES_IMAGE) throw new AdapterError("UNSUPPORTED");
  const files = new Map(lock.files.map(ref => [ref.path, ref]));
  if (files.size !== lock.files.length) throw new Error("Duplicate lock path.");
  let totalBytes = 0;
  for (const ref of lock.files) { totalBytes += readArtifact(directory, ref, 64 * 1024 * 1024).length; if (totalBytes > 128 * 1024 * 1024) throw new Error("Case byte limit exceeded."); }
  if (lock.implementationDigest !== digest(JSON.stringify(lock.sourceFiles)) || lock.sourceFiles.some(ref => files.get(ref.path)?.sha256 !== ref.sha256)) throw new Error("Source lock mismatch.");
  for (const path of ["case.json", "input.json", "initial-state.json", "expected.json", "adapter.mjs", "regression.mjs", "schema.sql", "assertion.json"])
    if (!files.has(path)) throw new Error("Missing locked artifact.");
  const lockedJson = (path: string) => JSON.parse(readArtifact(directory, files.get(path)!).toString());
  const spec = regressionCaseSchema.parse(lockedJson("case.json"));
  for (const ref of [spec.input, spec.initialState, spec.scenario.input, spec.scenario.initialState])
    if (files.get(ref.path)?.sha256 !== ref.sha256) throw new Error("Case reference differs from lock.");
  if (!isDeepStrictEqual(spec.input, spec.scenario.input) || !isDeepStrictEqual(spec.initialState, spec.scenario.initialState)) throw new Error("Scenario reference mismatch.");
  const input = regressionInputSchema.parse(JSON.parse(readArtifact(directory, spec.input).toString()));
  emptyTradeStateSchema.parse(JSON.parse(readArtifact(directory, spec.initialState).toString()));
  const events = input.deliveries.flatMap(d => d.events);
  if (!isDeepStrictEqual(expectedTradeState(events), lockedJson("expected.json"))) throw new Error("Expected projection mismatch.");
  for (const delivery of input.deliveries) {
    if (files.get(delivery.raw.path)?.sha256 !== delivery.raw.sha256) throw new Error("Missing delivery raw evidence.");
    for (const event of delivery.events) if (event.identity.signature !== delivery.signature || event.slot !== delivery.slot || !isDeepStrictEqual(event.provenance, delivery.raw)) throw new Error("Event source mismatch.");
  }
  for (const ref of input.evidence) if (files.get(ref.path)?.sha256 !== ref.sha256) throw new Error("Missing derivation evidence.");
  for (const event of events) {
    if (files.get(event.provenance.path)?.sha256 !== event.provenance.sha256) throw new Error("Missing raw evidence.");
    readArtifact(directory, event.provenance);
  }
  if (input.parent && files.get(input.parent.manifest.path)?.sha256 !== input.parent.manifest.sha256) throw new Error("Missing parent capture.");
  if (input.parent) {
    const manifest = captureManifestSchema.parse(JSON.parse(readArtifact(directory, input.parent.manifest).toString()));
    if (manifest.captureId !== input.parent.captureId) throw new Error("Parent capture mismatch.");
    for (const d of input.deliveries) {
      const frame = manifest.frames.find(f => String(f.sequence) === d.sourceSequence);
      if (!frame || frame.kind !== "transaction" || frame.signature !== d.signature || frame.slot !== d.slot || frame.rawSha256 !== d.raw.sha256) throw new Error("Delivery differs from parent capture.");
    }
  }
  const assertion = assertionSchema.parse(lockedJson("assertion.json"));
  if (assertion.lane !== "application" || assertion.implementation.path !== "regression.mjs" || assertion.expected.path !== "expected.json" || assertion.assertionId !== spec.assertion || assertion.projectionVersion !== input.projectionVersion || !assertion.requiresNonemptyEvents
    || assertion.expected.sha256 !== files.get("expected.json")!.sha256 || assertion.implementation.sha256 !== files.get("regression.mjs")!.sha256
    || !isDeepStrictEqual(assertion.requiredFaultIds, spec.scenario.faults.map(f => f.faultId))) throw new Error("Assertion contract mismatch.");
  return { lock, spec, input, files };
}
export function exitCode(verdict: string) { return verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : ["INCONCLUSIVE", "UNSUPPORTED", "CANCELLED"].includes(verdict) ? 3 : 2; }

export async function executeCase(directory: string, variant: "faulty" | "fixed", faulted = true, outputRoot = join(directory, "results")) {
  const runId = randomUUID(), output = join(outputRoot, runId); mkdirSync(output, { recursive: true, mode: 0o700 });
  let container: string | undefined, supervisor: AdapterSupervisor | undefined;
  let cancelled = false;
  const cancel = () => { cancelled = true; void supervisor?.dispose().catch(() => {}); };
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  const token = randomUUID(), trace: { sequence: string; deliveryId: string; inputId: string; faultId: string | null; status: "planned" | "durable-commit" }[] = [];
  let verdict = "RUNNER_ERROR", discrepancies: Discrepancy[] = [], reason: string | undefined;
  let description: AdapterDescription | undefined;
  let loaded: ReturnType<typeof loadCase> | undefined;
  const applied: { faultId: string; status: "applied" | "not-triggered" | "unsupported"; evidence: { path: string; sha256: string }[] }[] = [];
  const recovery: unknown[] = [];
  let crashApplied = false, disconnectApplied = false;
  let initialStateDigest: string | undefined;
  let resetVerified = false, cleanup = "not-created-or-setup-cleaned";
  let snapshotRef: { path: string; sha256: string } | undefined;
  try {
    loaded = loadCase(directory);
    if (variant !== "faulty" && variant !== "fixed") throw new AdapterError("UNSUPPORTED");
    const { input, spec } = loaded;
    const plan = schedule(input, spec, faulted);
    if (!plan.length) {
      for (const fault of spec.scenario.faults) if (faulted && fault.kind === "omission") recovery.push({ kind: "omission", faultId: fault.faultId, inputId: fault.deliveryId, recover: fault.recover });
      throw new AdapterError("INCONCLUSIVE");
    }
    if (!input.deliveries.some(d => d.events.length)) throw new AdapterError("INCONCLUSIVE");
    for (const ref of loaded.lock.files) {
      mkdirSync(resolve(output, ref.path, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(join(output, ref.path), readArtifact(directory, ref, 64 * 1024 * 1024), { flag: "wx", mode: 0o600 });
    }
    const initial = spec.initialState;
    const refs = new Map(input.deliveries.map((d, i) => [d.inputId, writeArtifact(output, `input-${i}.json`, d.events)]));
    // All database state is new, bounded, local, and without a network interface.
    container = await createDatabase(token, runId, readFileSync(join(directory, "schema.sql"), "utf8"));
    if (cancelled) throw new AdapterError("INCONCLUSIVE");
    const configPath = join(output, "sample-config.json");
    writeFileSync(configPath, json({ container, token, runId, variant, barriers: true }), { mode: 0o600, flag: "wx" });
    const deadline = Date.now() + spec.scenario.limits.durationSeconds * 1000;
    let previousOutputBytes = 0;
    const launch = () => new AdapterSupervisor({ executable: process.execPath, args: [resolve(directory, "adapter.mjs"), configPath],
      directory: output, runId, ownershipToken: token, network: "disabled", requestTimeoutMs: 15000,
      durationMs: Math.max(1, deadline - Date.now()), maxOutputBytes: spec.scenario.limits.outputBytes - previousOutputBytes });
    supervisor = launch(); description = await supervisor.describe();
    const disconnect = faulted ? spec.scenario.faults.find(f => f.kind === "disconnect") : undefined;
    const omission = faulted ? spec.scenario.faults.find(f => f.kind === "omission") : undefined;
    if (omission) recovery.push({ kind: "omission", faultId: omission.faultId, inputId: omission.deliveryId, recover: omission.recover });
    const crash = faulted ? spec.scenario.faults.find(f => f.kind === "crash") : undefined;
    if (description.projectionContract !== input.projectionVersion || description.acknowledgement !== "durable-commit"
      || (crash && !description.supportsFaultBarriers.includes(crash.boundary))) throw new AdapterError("UNSUPPORTED");
    await supervisor.start(initial);
    const initialCounts = sql(container, "SELECT (SELECT count(*) FROM consumer_events)::text || ':' || (SELECT count(*) FROM consumer_totals)::text || ':' || (SELECT count(*) FROM consumer_checkpoints)::text;");
    if (initialCounts !== "0:0:0") throw new Error("Dirty initial state.");
    initialStateDigest = digest(json({ schemaVersion: 1, events: [], totals: [], checkpoint: null }));
    recovery.push({ kind: "initial-state", observedCounts: initialCounts, digest: initialStateDigest });
    for (const [i, delivery] of plan.entries()) {
      const entry = { sequence: String(i), deliveryId: `delivery-${i}`, ...delivery, status: "planned" as const };
      trace.push(entry);
      const eventIds = [...new Set(input.deliveries.find(d => d.inputId === entry.inputId)!.events.map(eventId))];
      const shouldCrash = !!crash && !crashApplied && eventIds.includes(crash.anchorEventId);
      try {
        await supervisor.deliver(entry.deliveryId, entry.sequence, refs.get(entry.inputId)!, { eventIds, crash: shouldCrash });
        trace[i] = { ...entry, status: "durable-commit" };
        if (disconnect && !disconnectApplied && entry.inputId === disconnect.deliveryId) {
          await supervisor.drain(); const checkpoint = await supervisor.checkpoint();
          recovery.push({ kind: "disconnect", faultId: disconnect.faultId, inputId: entry.inputId, checkpoint, barriers: supervisor.barriers });
          await supervisor.stop(); previousOutputBytes += supervisor.observedOutputBytes; await supervisor.dispose(); supervisor = launch();
          if (!isDeepStrictEqual(await supervisor.describe(), description)) throw new Error("Restart capability mismatch.");
          await supervisor.resume(entry.sequence); disconnectApplied = true;
          recovery.push({ kind: "restart", throughSequence: entry.sequence, policy: "explicit-one-input-overlap", nextInputId: plan[i + 1]?.inputId });
        }
      } catch (error) {
        if (!(error instanceof ObservedCrash) || !shouldCrash) throw error;
        const durableCheckpoint = sql(container, "SELECT last_delivery::text FROM consumer_checkpoints WHERE consumer_id='sample';") || null;
        if (durableCheckpoint !== error.barrier.checkpoint.lastDurableDelivery) throw new Error("Barrier checkpoint differs from durable state.");
        const committedEvents = JSON.parse(sql(container, "SELECT COALESCE(jsonb_agg(event_id),'[]'::jsonb) FROM consumer_events;")) as string[];
        if (!eventIds.every(id => committedEvents.includes(id))) throw new Error("Barrier effects were not durable.");
        recovery.push({ kind: "crash", faultId: crash!.faultId, inputId: entry.inputId, barrier: error.barrier,
          termination: "SIGKILL", exitObserved: true, durableCheckpoint, committedEventIds: committedEvents, priorBarriers: supervisor.barriers });
        trace[i] = { ...entry, status: "durable-commit" }; crashApplied = true;
        previousOutputBytes += supervisor.observedOutputBytes; await supervisor.dispose(); supervisor = launch();
        const restarted = await supervisor.describe();
        if (!isDeepStrictEqual(restarted, description)) throw new Error("Restart capability mismatch.");
        await supervisor.resume(entry.sequence);
        recovery.push({ kind: "restart", throughSequence: entry.sequence, checkpoint: durableCheckpoint,
          nextInputId: plan[i + 1]?.inputId, policy: "explicit-one-input-overlap-even-if-checkpoint-advanced" });
      }
    }
    recovery.push({ kind: "observed-commit-barriers", barriers: supervisor.barriers });
    await supervisor.drain(); const snapshot = await supervisor.snapshot(); await supervisor.checkpoint();
    snapshotRef = writeArtifact(output, "snapshot.json", snapshot);
    const comparison = compareTradeState(input.deliveries.flatMap(d => d.events), JSON.parse(readArtifact(output, snapshot.state).toString()));
    verdict = comparison.verdict; discrepancies = comparison.discrepancies;
    await supervisor.stop();
    await supervisor.reset(token); await supervisor.start(initial); await supervisor.stop(); resetVerified = true;
  } catch (error) {
    verdict = cancelled ? "CANCELLED" : error instanceof AdapterError ? error.verdict : "RUNNER_ERROR";
    reason = error instanceof AdapterError ? error.message : "Case validation, isolated execution or persistence failed.";
  } finally {
    try { await supervisor?.dispose(); } catch { verdict = "RUNNER_ERROR"; reason = "Process cleanup failed."; }
    try { if (container) { removeDatabase(container, token); cleanup = "removed"; } } catch { cleanup = "failed"; verdict = "RUNNER_ERROR"; reason = "Owned database cleanup failed."; }
  }
  process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
  const traceRef = writeArtifact(output, "delivery-trace.json", trace);
  const recoveryRef = writeArtifact(output, "recovery-trace.json", recovery);
  if (faulted && loaded) for (const fault of loaded.spec.scenario.faults) {
    const count = trace.filter(t => t.faultId === fault.faultId && t.status === "durable-commit").length;
    applied.push({ faultId: fault.faultId, status: verdict === "UNSUPPORTED" ? "unsupported" : (fault.kind === "crash" ? crashApplied && count === 1 : fault.kind === "disconnect" ? disconnectApplied && count === 1
        : fault.kind === "omission" ? recovery.some((r: any) => r.kind === "omission" && r.faultId === fault.faultId) && (!fault.recover || count === 1)
        : count === fault.additionalDeliveries) ? "applied" : "not-triggered", evidence: [recoveryRef, traceRef] });
  }
  if (faulted && loaded?.spec.scenario.faults.some(f => f.kind === "omission" && !f.recover) && ["PASS", "FAIL"].includes(verdict)) {
    verdict = "INCONCLUSIVE"; reason = "Declared input was permanently withheld; recovery correctness cannot be established.";
  }
  if (verdict === "PASS" && applied.some(f => f.status !== "applied")) verdict = "INCONCLUSIVE";
  const discrepancyRef = writeArtifact(output, "discrepancies.json", discrepancies);
  const summary = { schemaVersion: 1, runId, variant, faulted, verdict, ...(reason ? { reason } : {}),
    configuredFaults: faulted ? loaded?.spec.scenario.faults ?? [] : [], appliedFaults: applied, discrepancies,
    cleanup, resetVerified, initialStateDigest, output };
  if (loaded && description) {
    const scenarioRef = writeArtifact(output, "scenario.json", faulted ? loaded.spec.scenario : { ...loaded.spec.scenario, faults: [] });
    const runtimeRef = writeArtifact(output, "runtime.json", loaded.lock);
    const result = { schemaVersion: 1, assertionId: loaded.spec.assertion, checkType: "application", verdict,
      coverage: loaded.input.coverage.status, summary: reason ?? `Maintained ${variant} trade-state comparison.`, evidenceRefs: [discrepancyRef.path] };
    const run = runSchema.parse({ schemaVersion: 1, runId, scenario: scenarioRef, consumerRevision: loaded.lock.sourceRevision,
      adapter: description, runtime: runtimeRef, coverage: loaded.input.coverage, requiredFaultIds: faulted ? loaded.spec.scenario.faults.map(f => f.faultId) : [],
      appliedFaults: applied, results: [result], verdict, evidence: [traceRef, recoveryRef, discrepancyRef, ...(snapshotRef ? [snapshotRef] : [])] });
    const runRef = writeArtifact(output, "run.json", run);
    if (verdict === "FAIL" && snapshotRef) {
      const expectedRef = loaded.files.get("expected.json")!;
      writeArtifact(output, "incident.json", incidentSchema.parse({ schemaVersion: 1, incidentId: randomUUID(), run: runRef,
        assertionId: loaded.spec.assertion, failureIdentity: digest(json(failureFields(discrepancies))), expected: expectedRef, actual: snapshotRef }));
    }
  }
  writeArtifact(output, "result.json", summary);
  return summary;
}

/** Build an initial offline case from validated inputs. No executable path is accepted from its data. */
export function createCase(directory: string, inputValue: unknown, rawRoot: string, buildRoot: string, seed: string, mode: "duplicate" | "crash" | "disconnect" | "temporary-omission" | "permanent-omission" = "duplicate") {
  const input = regressionInputSchema.parse(inputValue), candidates = input.deliveries.filter(d => d.events.length);
  if (!candidates.length) throw new AdapterError("INCONCLUSIVE");
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const buildLock = JSON.parse(readFileSync(join(buildRoot, "build-lock.json"), "utf8"));
  const refs: { path: string; sha256: string }[] = [];
  for (const ref of buildLock.files) {
    const data = readArtifact(buildRoot, ref, 64 * 1024 * 1024); mkdirSync(resolve(directory, ref.path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, ref.path), data, { flag: "wx", mode: 0o600 }); refs.push(ref);
  }
  const raw = new Map([...input.deliveries.map(d => [d.raw.path, d.raw] as const), ...input.evidence.map(ref => [ref.path, ref] as const)]);
  if (input.parent) raw.set(input.parent.manifest.path, input.parent.manifest);
  for (const ref of raw.values()) {
    const data = readArtifact(rawRoot, ref, 64 * 1024 * 1024); mkdirSync(resolve(directory, ref.path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, ref.path), data, { flag: "wx", mode: 0o600 }); refs.push(ref);
  }
  const inputRef = writeArtifact(directory, "input.json", input), initialRef = writeArtifact(directory, "initial-state.json", { schemaVersion: 1, events: [], totals: [], checkpoint: null });
  const expectedRef = writeArtifact(directory, "expected.json", expectedTradeState(input.deliveries.flatMap(d => d.events)));
  const eligible = mode === "temporary-omission" && candidates.length > 1 ? candidates.slice(0, -1) : candidates;
  const anchor = eligible[Number(BigInt("0x" + digest(seed).slice(0, 12)) % BigInt(eligible.length))]!;
  const scenario = scenarioSchema.parse({ schemaVersion: 1, scenarioId: `seeded-${mode}-v1`, input: inputRef, initialState: initialRef, order: "recorded",
    faults: mode === "duplicate" ? [{ faultId: "duplicate-1", kind: "duplicate", deliveryId: anchor.inputId, additionalDeliveries: 1 }]
      : mode === "crash" ? [{ faultId: "crash-1", kind: "crash", boundary: "afterDurableEffectCommit", anchorEventId: eventId(anchor.events[0]!), occurrence: 1 }]
      : mode === "disconnect" ? [{ faultId: "disconnect-1", kind: "disconnect", deliveryId: anchor.inputId, overlap: 1 }]
      : [{ faultId: "omission-1", kind: "omission", deliveryId: anchor.inputId, recover: mode === "temporary-omission" }],
    limits: { durationSeconds: 120, deliveries: 2000, outputBytes: 16 * 1024 * 1024 } });
  const spec = regressionCaseSchema.parse({ schemaVersion: 1, caseId: randomUUID(), seed, input: inputRef, initialState: initialRef, scenario,
    assertion: "trade-state-equality-v1", requiresNonemptyEvents: true, expectedFailure: [] });
  refs.push(inputRef, initialRef, expectedRef, writeArtifact(directory, "case.json", spec));
  refs.push(writeArtifact(directory, "assertion.json", assertionSchema.parse({ schemaVersion: 1, assertionId: spec.assertion, lane: "application",
    projectionVersion: input.projectionVersion, implementation: refs.find(r => r.path === "regression.mjs"), expected: expectedRef,
    requiredFaultIds: scenario.faults.map(f => f.faultId), requiresNonemptyEvents: true })));
  const lock = regressionLockSchema.parse({ schemaVersion: 1, node: process.version, platform: process.platform, architecture: process.arch,
    postgresImage: POSTGRES_IMAGE, sourceRevision: buildLock.sourceRevision, sourceFiles: buildLock.sourceFiles, implementationDigest: buildLock.implementationDigest,
    files: refs, network: "disabled", dependencies: ["local-docker-daemon", "cached-postgres-image", "linux-user-network-namespaces"], consumerVariants: ["faulty", "fixed"] });
  sealLock(directory, lock);
  return spec;
}
function sealLock(directory: string, lock: RegressionLock) {
  const bytes = json(lock); writeFileSync(join(directory, "runtime-lock.json"), bytes, { mode: 0o600, flush: true });
  writeFileSync(join(directory, "runtime-lock.sha256"), digest(bytes) + "\n", { mode: 0o600, flush: true });
}
export function sealFailure(directory: string, discrepancies: Discrepancy[]) {
  const { spec, lock } = loadCase(directory);
  const failure = failureFields(discrepancies);
  if (!failure.length || failure.some(d => d.kind !== "total-field")) throw new Error("Unexpected failure identity.");
  const updated = regressionCaseSchema.parse({ ...spec, expectedFailure: failure });
  writeFileSync(join(directory, "case.json"), json(updated), { mode: 0o600, flush: true });
  lock.files = lock.files.map(ref => ref.path === "case.json" ? { ...ref, sha256: digest(json(updated)) } : ref);
  sealLock(directory, lock);
}
export function exportCase(source: string, destination: string) {
  const { lock, spec, input } = loadCase(source);
  if (!spec.expectedFailure.length) throw new Error("No confirmed failure to export.");
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  for (const ref of lock.files) {
    mkdirSync(resolve(destination, ref.path, ".."), { recursive: true, mode: 0o700 });
    copyFileSync(join(source, ref.path), join(destination, ref.path));
  }
  for (const path of ["runtime-lock.json", "runtime-lock.sha256"]) copyFileSync(join(source, path), join(destination, path));
  const find = (path: string) => lock.files.find(ref => ref.path === path)!;
  writeArtifact(destination, "export-manifest.json", exportManifestSchema.parse({ schemaVersion: 1, exportId: randomUUID(), source: input.source,
    case: find("case.json"), consumer: find("adapter.mjs"), adapter: find("adapter.mjs"),
    runtimeLock: { path: "runtime-lock.json", sha256: digest(readFileSync(join(source, "runtime-lock.json"))) }, initialState: spec.initialState,
    dependencies: [find("schema.sql")], assertions: [find("assertion.json")], networkPolicy: "recorded-responses-only",
    reproductionCommand: ["node", "regression.mjs", "reproduce", ".", "faulty"], regressionCommand: ["node", "regression.mjs", "test", ".", "fixed"],
    uncontrolledDependencies: ["host-scheduling", "local-docker-daemon"] }));
  writeFileSync(join(destination, "README.txt"), `Aftershock offline regression (intentional sample defect)\nRequires Linux, Node ${lock.node}, local Docker and cached image ${POSTGRES_IMAGE}.\nNo package installation or provider keys are needed. No images are pulled.\nRun: node regression.mjs test . faulty (exit 1), test . fixed (exit 0), or reproduce . faulty (exit 0 for the recorded defect).\nEach run creates and removes one bounded, network-disabled PostgreSQL container.\nThe adapter also has no network. Docker's local Unix socket is an explicit trusted dependency.\nThis tests already-decoded recorded events, not the external decoder or chain completeness.\n`, { flag: "wx", mode: 0o600 });
  return destination;
}
