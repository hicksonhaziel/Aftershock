import { z } from "zod";
const slot = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const capturedTransactionSchema = z.strictObject({
  slot, signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
});
export const membershipReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assertionId: z.literal("captured-signatures-in-finalized-blocks"),
  checkType: z.literal("reference"),
  scope: z.literal("captured-transaction-membership-only"),
  verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  referenceCoverage: z.enum(["complete", "incomplete"]),
  captureCompleteness: z.literal("not-assessed"),
  startSlot: slot, endSlot: slot, finalizedTip: slot,
  observedDeliveries: z.number().int().nonnegative(),
  duplicateDeliveries: z.number().int().nonnegative(),
  ledger: z.array(z.strictObject({
    slot, status: z.enum(["available", "not-returned", "unavailable", "not-finalized", "budget-exhausted"]),
    attempts: z.number().int().nonnegative(),
    blockhash: z.string().optional(), signatureCount: z.number().int().nonnegative().optional(),
  })),
  transactions: z.array(capturedTransactionSchema.extend({ status: z.enum(["present", "absent", "unresolved"]) })),
});
export type CapturedTransaction = z.infer<typeof capturedTransactionSchema>;
export type MembershipReport = z.infer<typeof membershipReportSchema>;
