import { z } from "zod";

export const projectRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  adapter: z.literal("maintained-trade-ledger-v1"),
});
export const campaignRequestSchema = z.strictObject({
  projectId: z.uuid(),
  caseId: z.uuid(),
  variant: z.enum(["faulty", "fixed"]),
  maxSeconds: z.number().int().min(10).max(360).default(360),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
});
export type CampaignRequest = z.infer<typeof campaignRequestSchema>;
const common = {
  projectId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  maxSeconds: z.number().int().min(10).max(1200).default(360),
};
export const scenarioPresetSchema = z.enum(["duplicate", "crash", "disconnect", "temporary-omission", "permanent-omission"]);
export const operationRequestSchema = z.union([
  campaignRequestSchema.extend({ kind: z.literal("campaign").default("campaign") }),
  z.strictObject({ ...common, kind: z.literal("capture"), durationSeconds: z.number().int().min(1).max(30).default(10), maxTransactions: z.number().int().min(1).max(100).default(25), maxBytes: z.number().int().min(1024).max(4194304).default(2097152), commitment: z.enum(["confirmed", "finalized"]).default("confirmed") }),
  z.strictObject({ ...common, kind: z.literal("normalize"), captureId: z.uuid(), allowV1Exclusions: z.boolean(), seed: z.string().min(1).max(80).default("workbench"), preset: scenarioPresetSchema.default("crash") }),
  z.strictObject({ ...common, kind: z.literal("reference"), captureId: z.uuid() }),
  z.strictObject({ ...common, kind: z.literal("scenario"), caseId: z.uuid(), seed: z.string().min(1).max(80), preset: scenarioPresetSchema }),
  z.strictObject({ ...common, kind: z.literal("reduce"), caseId: z.uuid(), maxAttempts: z.number().int().min(2).max(20).default(10) }),
  z.strictObject({ ...common, kind: z.literal("compare"), caseId: z.uuid(), repeats: z.number().int().min(1).max(5).default(5) }),
  z.strictObject({ ...common, kind: z.literal("export"), caseId: z.uuid() }),
]);
export type OperationRequest = z.infer<typeof operationRequestSchema>;
export const jobStateSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "CANCELLED"]);
export const progressCursorSchema = z.coerce.number().int().min(0).max(1000);
