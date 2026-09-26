import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactRefSchema, coverageSchema, eventIdentitySchema, tradeEventSchema, scenarioSchema, appliedFaultSchema,
  checkpointSchema, snapshotSchema, assertionSchema, runSchema, incidentSchema, reducedCaseSchema, exportManifestSchema,
  adapterRequestSchema, adapterResponseSchema, barrierSchema } from "../src/index.js";
const artifact = { path: "evidence/input.json", sha256: "a".repeat(64) };
const checkpoint = { schemaVersion: 1, runId: "run-1", supported: true, lastDurableDelivery: "10", consumerValue: artifact };
const identity = { chain: "solana-mainnet-beta", program: "a".repeat(32), signature: "b".repeat(64), instructionPath: [1, 2], ordinal: "0", projectionVersion: "pumpfun-trades-v1" };
const coverage = { status: "complete", scope: "selected-finalized-blocks", startSlot: "10", endSlot: "12", missingSlots: [], exclusions: [] };
const adapter = { schemaVersion: 1, adapterVersion: "v1", projectionContract: "pumpfun-trades-v1", acknowledgement: "receipt", supportsCheckpoints: true,
  supportsFaultBarriers: ["afterDurableEffectCommit"], deterministicDependencies: [], executionControl: { controlledBoundaries: ["commit"], uncontrolledDependencies: ["os-scheduling"] } };
const run = { schemaVersion: 1, runId: "run-1", scenario: artifact, consumerRevision: "b".repeat(40), adapter, runtime: artifact, coverage,
  requiredFaultIds: ["crash-1"], appliedFaults: [{ faultId: "crash-1", status: "applied", evidence: [artifact] }],
  results: [{ schemaVersion: 1, assertionId: "same-state", checkType: "metamorphic", verdict: "PASS", coverage: "incomplete", summary: "Synthetic example", evidenceRefs: ["evidence/diff.json"] }], verdict: "PASS", evidence: [artifact] };
test("all Phase 0 artifact contracts accept explicit versioned examples", () => {
  artifactRefSchema.parse(artifact); coverageSchema.parse(coverage); eventIdentitySchema.parse(identity); checkpointSchema.parse(checkpoint);
  tradeEventSchema.parse({ schemaVersion: 1, identity, slot: "10", mint: "c".repeat(32), trader: "d".repeat(32), side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615", provenance: artifact });
  scenarioSchema.parse({ schemaVersion: 1, scenarioId: "duplicate-1", input: artifact, initialState: artifact, order: "recorded", faults: [{ faultId: "dup", kind: "duplicate", deliveryId: "delivery-1", additionalDeliveries: 1 }], limits: { durationSeconds: 30, deliveries: 100, outputBytes: 4096 } });
  snapshotSchema.parse({ schemaVersion: 1, runId: "run-1", projectionVersion: "pumpfun-trades-v1", drainedThrough: "10", state: artifact, checkpoint, excludedFields: ["received_at"] });
  assertionSchema.parse({ schemaVersion: 1, assertionId: "same-state", lane: "metamorphic", projectionVersion: "pumpfun-trades-v1", implementation: artifact, expected: artifact, requiredFaultIds: ["crash-1"], requiresNonemptyEvents: true });
  runSchema.parse(run);
  incidentSchema.parse({ schemaVersion: 1, incidentId: "incident-1", run: artifact, assertionId: "same-state", failureIdentity: artifact.sha256, expected: artifact, actual: artifact });
  reducedCaseSchema.parse({ schemaVersion: 1, caseId: "case-1", parentIncident: artifact, failureIdentity: artifact.sha256, input: artifact, scenario: artifact, attempts: 3, reproductionRuns: [artifact], stableFaultAnchors: ["event-1"] });
  exportManifestSchema.parse({ schemaVersion: 1, exportId: "export-1", source: "synthetic", case: artifact, consumer: artifact, adapter: artifact, runtimeLock: artifact, initialState: artifact, dependencies: [], assertions: [artifact], networkPolicy: "recorded-responses-only", reproductionCommand: ["aftershock", "reproduce"], regressionCommand: ["aftershock", "regress"], uncontrolledDependencies: ["os-scheduling"] });
});
test("no applied fault evidence or an untriggered required crash can produce PASS", () => {
  assert.equal(appliedFaultSchema.safeParse({ faultId: "f", status: "applied", evidence: [] }).success, false);
  assert.equal(runSchema.safeParse({ ...run, appliedFaults: [] }).success, false);
  assert.equal(runSchema.safeParse({ ...run, appliedFaults: [{ faultId: "crash-1", status: "not-triggered", evidence: [] }] }).success, false);
  assert.equal(runSchema.safeParse({ ...run, verdict: "INCONCLUSIVE", appliedFaults: [] }).success, true);
});
test("incomplete chain coverage can coexist with a valid metamorphic result", () => {
  assert.equal(runSchema.parse({ ...run, coverage: { ...coverage, status: "incomplete", missingSlots: ["11"] } }).verdict, "PASS");
  assert.equal(coverageSchema.safeParse({ ...coverage, missingSlots: ["11"] }).success, false);
  assert.equal(coverageSchema.safeParse({ ...coverage, startSlot: "13" }).success, false);
});
test("artifact references reject path escape and credential-bearing URLs", () => {
  for (const path of ["../secret", "/tmp/input", "https://example.test?key=synthetic", "x/../y", "x\\y"]) assert.equal(artifactRefSchema.safeParse({ ...artifact, path }).success, false);
});
test("process requests distinguish receipt, drain and commit barrier", () => {
  for (const method of ["snapshot", "checkpoint", "stop"]) adapterRequestSchema.parse({ jsonrpc: "2.0", id: "request-1", method, params: { protocolVersion: 1, runId: "run-1" } });
  adapterRequestSchema.parse({ jsonrpc: "2.0", id: "r", method: "deliver", params: { protocolVersion: 1, runId: "run-1", deliveryId: "d", sequence: "9007199254740993", input: artifact } });
  const drained = { jsonrpc: "2.0", id: "r", result: { kind: "drained", runId: "run-1", throughSequence: "10", pending: 0, writeErrors: 0, skipped: 0, deadLetters: 0 } };
  adapterResponseSchema.parse(drained);
  assert.equal(adapterResponseSchema.safeParse({ ...drained, result: { ...drained.result, pending: 1 } }).success, false);
  barrierSchema.parse({ jsonrpc: "2.0", method: "barrier", params: { protocolVersion: 1, runId: "run-1", barrierId: "batch-1", boundary: "afterDurableEffectCommit", eventIds: ["event-1"], committedThrough: "10", checkpoint } });
  assert.equal(adapterRequestSchema.safeParse({ jsonrpc: "2.0", id: "r", method: "reset", params: { protocolVersion: 1, runId: "run-1" } }).success, false);
});
test("cross-run checkpoints and unsupported versions are rejected", () => {
  assert.equal(snapshotSchema.safeParse({ schemaVersion: 1, runId: "run-2", projectionVersion: "v1", drainedThrough: "10", state: artifact, checkpoint, excludedFields: [] }).success, false);
  assert.equal(checkpointSchema.safeParse({ ...checkpoint, supported: false }).success, false);
  assert.equal(runSchema.safeParse({ ...run, schemaVersion: 2 }).success, false);
});
