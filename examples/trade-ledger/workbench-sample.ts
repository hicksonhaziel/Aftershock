import { createHash } from "node:crypto";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION, regressionInputSchema } from "@aftershock/contracts";

export const SAMPLE_RAW = Buffer.from("AFTERSHOCK SYNTHETIC WORKBENCH FIXTURE — not a provider message or blockchain transaction\n");
export function workbenchSample() {
  const raw = { path: "raw.pb", sha256: createHash("sha256").update(SAMPLE_RAW).digest("hex") }, signature = "1".repeat(64);
  return regressionInputSchema.parse({ schemaVersion: 1, projectionVersion: TRADE_PROJECTION, source: "synthetic", parent: null, evidence: [],
    coverage: { status: "not-assessed", scope: "Synthetic maintained sample; no blockchain capture or finalized reference", startSlot: "100", endSlot: "100", missingSlots: [], exclusions: [] },
    deliveries: [{ inputId: "sample-0", raw, sourceSequence: "0", signature, slot: "100", events: [{ schemaVersion: 1,
      identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature, instructionPath: [0], ordinal: "0", projectionVersion: TRADE_PROJECTION },
      slot: "100", mint: "1".repeat(32), trader: "2".repeat(32), side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615", provenance: raw }] }],
  });
}
