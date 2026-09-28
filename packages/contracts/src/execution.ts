import { z } from "zod";
import { unsignedInteger, sha256, verdictSchema, checkResultSchema, adapterDescriptionSchema } from "./core.js";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const version = z.literal(1);
export const artifactRefSchema = z.strictObject({
  path: z.string().min(1).max(500).refine(p => !p.startsWith("/") && !p.includes("\\") && !p.includes(":") && p.split("/").every(part => part !== ".." && part !== "." && part !== "")),
  sha256,
});
export const coverageSchema = z.strictObject({
  status: z.enum(["complete", "incomplete", "not-assessed"]),
  scope: z.string().min(1), startSlot: unsignedInteger, endSlot: unsignedInteger,
  missingSlots: z.array(unsignedInteger), exclusions: z.array(z.string().min(1)),
}).refine(c => BigInt(c.startSlot) <= BigInt(c.endSlot), "Reversed interval")
  .refine(c => c.status !== "complete" || c.missingSlots.length === 0, "Missing slots prevent complete coverage");
export const eventIdentitySchema = z.strictObject({
  chain: z.literal("solana-mainnet-beta"), program: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
  instructionPath: z.array(z.number().int().min(0).max(255)).min(1).max(64),
  ordinal: unsignedInteger, projectionVersion: id,
});
export const tradeEventSchema = z.strictObject({
  schemaVersion: version, identity: eventIdentitySchema, slot: unsignedInteger,
  mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), trader: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  side: z.enum(["buy", "sell"]), solLamports: unsignedInteger, tokenBaseUnits: unsignedInteger,
  provenance: artifactRefSchema,
});
export const faultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ faultId: id, kind: z.literal("disconnect"), deliveryId: id, overlap: z.literal(1) }),
  z.strictObject({ faultId: id, kind: z.literal("omission"), deliveryId: id, recover: z.boolean() }),
  z.strictObject({ faultId: id, kind: z.literal("duplicate"), deliveryId: id, additionalDeliveries: z.number().int().min(1).max(10) }),
  z.strictObject({ faultId: id, kind: z.literal("crash"), boundary: z.literal("afterDurableEffectCommit"), anchorEventId: id, occurrence: z.number().int().min(1).max(1000) }),
]);
export const scenarioSchema = z.strictObject({
  schemaVersion: version, scenarioId: id, input: artifactRefSchema, initialState: artifactRefSchema,
  order: z.literal("recorded"), faults: z.array(faultSchema).max(32),
  limits: z.strictObject({ durationSeconds: z.number().int().min(1).max(300), deliveries: z.number().int().min(1).max(10000), outputBytes: z.number().int().min(1024).max(64 * 1024 * 1024) }),
}).refine(s => new Set(s.faults.map(f => f.faultId)).size === s.faults.length, "Duplicate fault IDs");
export const appliedFaultSchema = z.strictObject({
  faultId: id, status: z.enum(["applied", "not-triggered", "unsupported"]),
  evidence: z.array(artifactRefSchema),
}).refine(f => f.status !== "applied" || f.evidence.length > 0, "Applied faults require evidence");
export const checkpointSchema = z.strictObject({
  schemaVersion: version, runId: id, supported: z.boolean(),
  lastDurableDelivery: unsignedInteger.nullable(), consumerValue: artifactRefSchema.nullable(),
}).refine(c => c.supported || (c.lastDurableDelivery === null && c.consumerValue === null), "Unsupported checkpoint cannot claim progress");
export const snapshotSchema = z.strictObject({
  schemaVersion: version, runId: id, projectionVersion: id, drainedThrough: unsignedInteger,
  state: artifactRefSchema, checkpoint: checkpointSchema,
  excludedFields: z.array(z.string().min(1)),
}).refine(s => s.checkpoint.runId === s.runId, "Checkpoint belongs to another run");
export const assertionSchema = z.strictObject({
  schemaVersion: version, assertionId: id, lane: z.enum(["reference", "metamorphic", "application"]),
  projectionVersion: id, implementation: artifactRefSchema, expected: artifactRefSchema,
  requiredFaultIds: z.array(id), requiresNonemptyEvents: z.boolean(),
});
export const runSchema = z.strictObject({
  schemaVersion: version, runId: id, scenario: artifactRefSchema, consumerRevision: z.string().regex(/^[a-f0-9]{40}$/),
  adapter: adapterDescriptionSchema, runtime: artifactRefSchema, coverage: coverageSchema,
  requiredFaultIds: z.array(id), appliedFaults: z.array(appliedFaultSchema), results: z.array(checkResultSchema).min(1),
  verdict: verdictSchema, evidence: z.array(artifactRefSchema),
}).superRefine((r, ctx) => {
  if (new Set(r.appliedFaults.map(f => f.faultId)).size !== r.appliedFaults.length) ctx.addIssue({ code: "custom", message: "Duplicate fault outcomes" });
  if (r.verdict === "PASS" && (r.results.some(x => x.verdict !== "PASS") || r.requiredFaultIds.some(id => !r.appliedFaults.some(f => f.faultId === id && f.status === "applied"))))
    ctx.addIssue({ code: "custom", message: "PASS requires passing assertions and evidence for every required fault" });
});
export const incidentSchema = z.strictObject({
  schemaVersion: version, incidentId: id, run: artifactRefSchema, assertionId: id,
  failureIdentity: sha256, expected: artifactRefSchema, actual: artifactRefSchema,
});
export const reducedCaseSchema = z.strictObject({
  schemaVersion: version, caseId: id, parentIncident: artifactRefSchema, failureIdentity: sha256,
  input: artifactRefSchema, scenario: artifactRefSchema, attempts: z.number().int().min(1).max(1000),
  reproductionRuns: z.array(artifactRefSchema).min(1), stableFaultAnchors: z.array(id),
});
export const exportManifestSchema = z.strictObject({
  schemaVersion: version, exportId: id, source: z.enum(["live-derived", "synthetic", "external-fixture"]),
  case: artifactRefSchema, consumer: artifactRefSchema, adapter: artifactRefSchema, runtimeLock: artifactRefSchema,
  initialState: artifactRefSchema, dependencies: z.array(artifactRefSchema), assertions: z.array(artifactRefSchema).min(1),
  networkPolicy: z.literal("recorded-responses-only"), reproductionCommand: z.array(z.string().min(1)).min(1),
  regressionCommand: z.array(z.string().min(1)).min(1), uncontrolledDependencies: z.array(z.string().min(1)),
});
const request = <M extends string, S extends z.ZodType>(method: M, params: S) => z.strictObject({ jsonrpc: z.literal("2.0"), id, method: z.literal(method), params });
const runParams = z.strictObject({ protocolVersion: version, runId: id });
export const adapterRequestSchema = z.discriminatedUnion("method", [
  request("describe", z.strictObject({ protocolVersion: version })),
  request("start", z.strictObject({ protocolVersion: version, runId: id, initialState: artifactRefSchema })),
  request("resume", z.strictObject({ protocolVersion: version, runId: id, throughSequence: unsignedInteger })),
  request("deliver", z.strictObject({ protocolVersion: version, runId: id, deliveryId: id, sequence: unsignedInteger, input: artifactRefSchema })),
  request("drain", z.strictObject({ protocolVersion: version, runId: id, throughSequence: unsignedInteger })),
  request("snapshot", runParams), request("checkpoint", runParams), request("stop", runParams),
  request("reset", z.strictObject({ protocolVersion: version, runId: id, ownershipToken: z.uuid() })),
  request("releaseBarrier", z.strictObject({ protocolVersion: version, runId: id, barrierId: id })),
]);
export const barrierSchema = z.strictObject({
  jsonrpc: z.literal("2.0"), method: z.literal("barrier"), params: z.strictObject({
    protocolVersion: version, runId: id, barrierId: id, boundary: z.literal("afterDurableEffectCommit"),
    eventIds: z.array(id).min(1), committedThrough: unsignedInteger, checkpoint: checkpointSchema,
  }),
}).refine(b => b.params.runId === b.params.checkpoint.runId, "Barrier checkpoint belongs to another run");
export const adapterResponseSchema = z.union([
  z.strictObject({ jsonrpc: z.literal("2.0"), id, result: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("description"), description: adapterDescriptionSchema }),
    z.strictObject({ kind: z.literal("ack"), runId: id, deliveryId: id, acknowledgement: z.enum(["receipt", "processed", "durable-commit"]) }),
    z.strictObject({ kind: z.literal("drained"), runId: id, throughSequence: unsignedInteger, pending: z.literal(0), writeErrors: z.literal(0), skipped: z.literal(0), deadLetters: z.literal(0) }),
    z.strictObject({ kind: z.literal("snapshot"), snapshot: snapshotSchema }),
    z.strictObject({ kind: z.literal("checkpoint"), checkpoint: checkpointSchema }),
    z.strictObject({ kind: z.literal("lifecycle"), runId: id, state: z.enum(["started", "stopped", "reset", "released"]) }),
  ]) }),
  z.strictObject({ jsonrpc: z.literal("2.0"), id, error: z.strictObject({ code: z.number().int(), message: z.string().min(1).max(500), verdict: z.enum(["UNSUPPORTED", "RUNNER_ERROR", "INCONCLUSIVE"]) }) }),
]);
