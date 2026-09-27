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
  coverage: coverageSchema, evidence: z.array(artifactRefSchema).max(20),
  deliveries: z.array(z.strictObject({ inputId: id, raw: artifactRefSchema, sourceSequence: unsignedInteger, slot: unsignedInteger, signature: eventIdentitySchema.shape.signature, events: z.array(projectedTradeSchema).max(1000) })).min(1).max(1000),
}).refine(v => new Set(v.deliveries.map(d => d.inputId)).size === v.deliveries.length, "Duplicate input IDs")
  .refine(v => v.deliveries.reduce((n, d) => n + d.events.length, 0) <= 10000, "Too many events")
  .refine(v => v.source !== "live-derived" || v.parent !== null, "Live input needs capture provenance");
export const regressionCaseSchema = z.strictObject({
  schemaVersion: z.literal(1), caseId: z.uuid(), seed: z.string().min(1).max(100),
  input: artifactRefSchema, initialState: artifactRefSchema, scenario: scenarioSchema,
  assertion: z.literal("trade-state-equality-v1"), requiresNonemptyEvents: z.literal(true),
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
