import { z } from "zod";
import { unsignedInteger, sha256 } from "./core.js";
import { eventIdentitySchema, tradeEventSchema } from "./execution.js";
export const tradeAuditSchema = z.strictObject({
  signature: eventIdentitySchema.shape.signature,
  instructionPath: eventIdentitySchema.shape.instructionPath,
  ordinal: unsignedInteger, slot: unsignedInteger,
  mint: tradeEventSchema.shape.mint, trader: tradeEventSchema.shape.trader,
  side: tradeEventSchema.shape.side, solLamports: unsignedInteger, tokenBaseUnits: unsignedInteger,
});
export const sourceTransactionSchema = z.strictObject({
  deliveryId: z.string().regex(/^source-[0-9]+$/), sourceSequence: z.number().int().nonnegative(),
  slot: unsignedInteger, signature: eventIdentitySchema.shape.signature,
  rawSha256: sha256, file: z.string().regex(/^frame-[0-9]+\.pb\.gz$/),
});
export type TradeAudit = z.infer<typeof tradeAuditSchema>;
export type SourceTransaction = z.infer<typeof sourceTransactionSchema>;
