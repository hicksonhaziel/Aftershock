import { z } from "zod";
import { unsignedInteger, sha256 } from "./core.js";
import { artifactRefSchema, scenarioSchema, coverageSchema, eventIdentitySchema } from "./execution.js";
import { projectedTradeSchema, TRADE_PROJECTION } from "./projection.js";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
export const emptyTradeStateSchema = z.strictObject({ schemaVersion: z.literal(1), events: z.tuple([]), totals: z.tuple([]), checkpoint: z.null() });
export const regressionInputSchema = z.strictObject({
  schemaVersion: z.literal(1), projectionVersion: z.literal(TRADE_PROJECTION),
  source: z.enum(["live-derived", "synthetic", "external-fixture"]),
  parent: z.strictObject({ captureId: z.uuid(), manifest: artifactRefSchema }).nullable(),
  prerequisites: z.array(z.strictObject({ inputId: id, requires: z.array(id).max(1000), reason: z.string().min(1).max(500) })).max(1000).optional(),
  retainedInputs: z.array(z.strictObject({ inputId: id, reason: z.string().min(1).max(500) })).max(1000).optional(),
  coverage: coverageSchema, evidence: z.array(artifactRefSchema).max(24),
  deliveries: z.array(z.strictObject({ inputId: id, raw: artifactRefSchema, sourceSequence: unsignedInteger, slot: unsignedInteger, signature: eventIdentitySchema.shape.signature, events: z.array(projectedTradeSchema).max(1000) })).min(1).max(1000),
}).refine(v => new Set(v.deliveries.map(d => d.inputId)).size === v.deliveries.length, "Duplicate input IDs")
  .refine(v => v.deliveries.reduce((n, d) => n + d.events.length, 0) <= 10000, "Too many events")
  .refine(v => v.source !== "live-derived" || v.parent !== null, "Live input needs capture provenance");
export const regressionCaseSchema = z.strictObject({
  schemaVersion: z.literal(1), caseId: z.uuid(), seed: z.string().min(1).max(100),
  input: artifactRefSchema, initialState: artifactRefSchema, scenario: scenarioSchema,
  assertion: z.literal("trade-state-equality-v1"), requiresNonemptyEvents: z.literal(true),
  failureFingerprint: sha256.optional(),
  history: z.array(artifactRefSchema).max(1000).optional(),
  reduction: artifactRefSchema.optional(),
  expectedFailure: z.array(z.strictObject({ kind: z.literal("total-field"), key: z.string().max(500),
    field: z.enum(["count", "solLamports", "tokenBaseUnits"]) })).max(30000),
});
export const regressionLockSchema = z.strictObject({
  schemaVersion: z.literal(1), node: z.string().regex(/^v22\.[0-9]+\.[0-9]+$/),
  platform: z.literal("linux"), architecture: z.enum(["x64", "arm64"]),
  postgresImage: z.string().regex(/^postgres:15-alpine@sha256:[a-f0-9]{64}$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.array(artifactRefSchema).min(5).max(5000),
  sourceFiles: z.array(artifactRefSchema).min(1).max(100),
  network: z.literal("disabled"), dependencies: z.tuple([z.literal("local-docker-daemon"), z.literal("cached-postgres-image"), z.literal("linux-user-network-namespaces")]),
  consumerVariants: z.tuple([z.literal("faulty"), z.literal("fixed")]),
  implementationDigest: sha256,
});
export type RegressionInput = z.infer<typeof regressionInputSchema>;
export type RegressionCase = z.infer<typeof regressionCaseSchema>;
export type RegressionLock = z.infer<typeof regressionLockSchema>;

export const reductionBudgetSchema = z.strictObject({
  maxAttempts: z.number().int().min(2).max(64),
  maxSeconds: z.number().int().min(1).max(3600),
  maxBytes: z.number().int().min(1048576).max(1073741824),
});
export const attemptRecordSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.uuid(), variant: z.enum(["faulty", "fixed"]), verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE", "UNSUPPORTED", "RUNNER_ERROR", "CANCELLED"]),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), implementationDigest: sha256, consumerBuildDigest: sha256,
  runtimeDigest: sha256, inputDigest: sha256, scenarioDigest: sha256, initialStateDigest: sha256.nullable(),
  failureFingerprint: sha256.nullable(), requiredFaultsApplied: z.boolean(), resetVerified: z.boolean(), cleanup: z.string(),
  startedAtUtc: z.iso.datetime(), durationMs: z.number().nonnegative(),
  evidence: z.array(artifactRefSchema),
});
export type AttemptRecord = z.infer<typeof attemptRecordSchema>;
export const reductionProofSchema = z.strictObject({
  schemaVersion: z.literal(1), verdict: z.enum(["PASS", "INCONCLUSIVE", "UNSUPPORTED", "RUNNER_ERROR", "CANCELLED"]),
  minimality: z.enum(["not-established", "1-minimal-under-declared-transaction-units", "budget-limited-or-unresolved"]),
  failureFingerprint: sha256, parentCase: z.uuid(), parentInputSha256: sha256,
  parentCapture: regressionInputSchema.shape.parent,
  originalInputs: z.number().int().min(1).max(1000), retainedInputs: z.array(id).min(1).max(1000), removedInputs: z.array(id).max(1000),
  originalRawBytes: z.number().int().nonnegative(), retainedRawBytes: z.number().int().nonnegative(),
  preserved: z.strictObject({ initialState: artifactRefSchema, supportingEvidence: z.array(artifactRefSchema),
    controlPolicy: z.string().min(1), prerequisites: z.array(z.strictObject({ inputId: id, reason: z.string().min(1) })), faults: scenarioSchema.shape.faults }),
  budget: reductionBudgetSchema, durationMs: z.number().nonnegative(), attempts: z.array(attemptRecordSchema).max(64),
  candidates: z.array(z.strictObject({ candidate: id, retainedInputs: z.array(id), removedInputs: z.array(id),
    verdict: attemptRecordSchema.shape.verdict, failureFingerprint: sha256.nullable(), accepted: z.boolean(), runId: z.uuid() })).max(64),
  finalRunId: z.uuid().nullable(), originalPreserved: z.literal(true),
});
