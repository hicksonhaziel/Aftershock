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
export const jobStateSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "CANCELLED"]);
export const progressCursorSchema = z.coerce.number().int().min(0).max(1000);
