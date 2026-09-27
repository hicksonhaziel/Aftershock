import { z } from "zod";
import { unsignedInteger } from "./core.js";
import { tradeEventSchema } from "./execution.js";

// Pump.fun bonding-curve trades are grouped by program/mint/side, not inferred pools.
export const TRADE_PROJECTION = "pumpfun-trades-v1";
export const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const projectedTradeSchema = tradeEventSchema.refine(
  event => event.identity.program === PUMPFUN_PROGRAM && event.identity.projectionVersion === TRADE_PROJECTION,
  "Unsupported trade projection",
);
export const tradeTotalSchema = z.strictObject({
  program: z.literal(PUMPFUN_PROGRAM), mint: tradeEventSchema.shape.mint,
  side: z.enum(["buy", "sell"]), count: unsignedInteger,
  solLamports: unsignedInteger, tokenBaseUnits: unsignedInteger,
});
export const tradeStateSchema = z.strictObject({
  schemaVersion: z.literal(1), projectionVersion: z.literal(TRADE_PROJECTION),
  events: z.array(projectedTradeSchema).max(10000), totals: z.array(tradeTotalSchema).max(10000),
});
export type ProjectedTrade = z.infer<typeof projectedTradeSchema>;
export type TradeState = z.infer<typeof tradeStateSchema>;
export type TradeTotal = z.infer<typeof tradeTotalSchema>;
