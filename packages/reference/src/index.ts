import { capturedTransactionSchema, membershipReportSchema, type CapturedTransaction, type MembershipReport } from "@aftershock/contracts";
export type ReferenceRpc = (method: "getBlocks" | "getBlock", params: unknown[]) => Promise<unknown>;
const validSlot = (slot: string) => /^(0|[1-9][0-9]*)$/.test(slot) && BigInt(slot) <= BigInt(Number.MAX_SAFE_INTEGER);
const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** Reconciles recorded signatures only. It never asserts full filtered capture coverage. */
export async function checkFinalizedMembership(observations: CapturedTransaction[], finalizedTip: string, rpc: ReferenceRpc,
  now: () => number = Date.now): Promise<MembershipReport> {
  if (!observations.length || !validSlot(finalizedTip)) throw new Error("Nonempty observations and a safe finalized slot are required.");
  const observed = observations.map(item => capturedTransactionSchema.parse(item));
  if (observed.some(item => !validSlot(item.slot))) throw new Error("Unsupported slot precision.");
  const start = Math.min(...observed.map(item => Number(item.slot)));
  const end = Math.max(...observed.map(item => Number(item.slot)));
  if (end - start >= 16) throw new Error("Reference interval exceeds 16 slots; use a smaller capture.");
  const unique = [...new Map(observed.map(item => [`${item.slot}:${item.signature}`, item])).values()];
  const ledger: MembershipReport["ledger"] = [];
  const blocks = new Map<string, Set<string>>();
  const deadline = now() + 60_000;
  let enumerated: number[] | undefined;
  let enumerationAttempts = 0;
  if (end <= Number(finalizedTip)) {
    for (let attempt = 0; attempt < 2 && now() < deadline; attempt++) {
      enumerationAttempts++;
      try {
        const result = await rpc("getBlocks", [start, end, { commitment: "finalized" }]);
        if (!Array.isArray(result) || result.some(n => !Number.isSafeInteger(n) || n < start || n > end) || new Set(result).size !== result.length) throw new Error("Invalid block enumeration.");
        enumerated = result as number[];
        break;
      } catch { /* Retain incomplete coverage; never treat an RPC error as an empty range. */ }
    }
  }
  for (let slot = start; slot <= end; slot++) {
    const entry: MembershipReport["ledger"][number] = { slot: String(slot), status: "unavailable", attempts: 0 };
    ledger.push(entry);
    if (end > Number(finalizedTip)) { entry.status = "not-finalized"; continue; }
    if (now() >= deadline) { entry.status = "budget-exhausted"; continue; }
    if (!enumerated) { entry.attempts = enumerationAttempts; continue; }
    if (!enumerated.includes(slot)) { entry.status = "not-returned"; continue; }
    for (let attempt = 0; attempt < 2 && now() < deadline; attempt++) {
      entry.attempts++;
      try {
        const result = await rpc("getBlock", [slot, { commitment: "finalized", encoding: "json", transactionDetails: "signatures", maxSupportedTransactionVersion: 0, rewards: false }]);
        if (!result || typeof result !== "object") throw new Error("Unavailable block.");
        const block = result as { blockhash?: unknown; signatures?: unknown };
        if (typeof block.blockhash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(block.blockhash) || !Array.isArray(block.signatures)
          || block.signatures.some(s => typeof s !== "string" || !signature.test(s)) || new Set(block.signatures).size !== block.signatures.length) throw new Error("Invalid block evidence.");
        blocks.set(String(slot), new Set(block.signatures as string[]));
        entry.status = "available";
        entry.blockhash = block.blockhash;
        entry.signatureCount = block.signatures.length;
        break;
      } catch { /* A missing/null/invalid response stays unresolved after bounded retries. */ }
    }
  }
  const transactions = unique.map(item => ({ ...item,
    status: !blocks.has(item.slot) ? "unresolved" as const : blocks.get(item.slot)!.has(item.signature) ? "present" as const : "absent" as const }));
  const incomplete = ledger.some(item => !["available", "not-returned"].includes(item.status)) || transactions.some(item => item.status === "unresolved");
  return membershipReportSchema.parse({
    schemaVersion: 1, assertionId: "captured-signatures-in-finalized-blocks", checkType: "reference", scope: "captured-transaction-membership-only",
    verdict: transactions.some(item => item.status === "absent") ? "FAIL" : incomplete ? "INCONCLUSIVE" : "PASS",
    referenceCoverage: incomplete ? "incomplete" : "complete", captureCompleteness: "not-assessed",
    startSlot: String(start), endSlot: String(end), finalizedTip, observedDeliveries: observed.length,
    duplicateDeliveries: observed.length - unique.length, ledger, transactions,
  });
}
