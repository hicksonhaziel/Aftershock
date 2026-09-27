import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION, projectedTradeSchema, tradeStateSchema } from "@aftershock/contracts";
import type { ProjectedTrade, TradeState, TradeTotal } from "@aftershock/contracts";

export function eventId(event: ProjectedTrade): string {
  const i = event.identity;
  return createHash("sha256").update(JSON.stringify([
    i.chain, i.program, i.signature, i.instructionPath, i.ordinal, i.projectionVersion,
  ])).digest("hex");
}
const groupId = (row: TradeTotal | ProjectedTrade) => JSON.stringify([
  "identity" in row ? row.identity.program : row.program, row.mint, row.side,
]);
const semantic = (event: ProjectedTrade) => ({
  slot: event.slot, mint: event.mint, trader: event.trader, side: event.side,
  solLamports: event.solLamports, tokenBaseUnits: event.tokenBaseUnits,
});

/** Derive empty-initial-state expectations from already decoded, supported events. */
export function expectedTradeState(input: unknown[]): TradeState {
  if (input.length > 10000) throw new Error("Projection event limit exceeded.");
  const unique = new Map<string, ProjectedTrade>();
  for (const value of input) {
    const event = projectedTradeSchema.parse(value), key = eventId(event), prior = unique.get(key);
    if (prior && !isDeepStrictEqual(semantic(prior), semantic(event))) throw new Error("Conflicting expected business event.");
    if (!prior) unique.set(key, event);
  }
  const events = [...unique].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
  const groups = new Map<string, TradeTotal>();
  for (const event of events) {
    const key = groupId(event), prior = groups.get(key);
    groups.set(key, {
      program: PUMPFUN_PROGRAM, mint: event.mint, side: event.side,
      count: (BigInt(prior?.count ?? "0") + 1n).toString(),
      solLamports: (BigInt(prior?.solLamports ?? "0") + BigInt(event.solLamports)).toString(),
      tokenBaseUnits: (BigInt(prior?.tokenBaseUnits ?? "0") + BigInt(event.tokenBaseUnits)).toString(),
    });
  }
  return { schemaVersion: 1, projectionVersion: TRADE_PROJECTION, events,
    totals: [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value) };
}

export type Discrepancy = {
  kind: "missing-event" | "unexpected-event" | "duplicate-event" | "event-field" | "missing-total" | "unexpected-total" | "duplicate-total" | "total-field";
  key: string; field?: string; expected: unknown; actual: unknown; delta?: string;
};

/** Application assertion only. Caller must separately establish decoding, drain and applied faults. */
export function compareTradeState(expectedInput: unknown[], actualInput: unknown) {
  let expected: TradeState, actual: TradeState;
  try { expected = expectedTradeState(expectedInput); actual = tradeStateSchema.parse(actualInput); }
  catch { return { verdict: "RUNNER_ERROR" as const, discrepancies: [], reason: "Invalid or unsupported projection evidence." }; }
  const discrepancies: Discrepancy[] = [];
  function compare<T>(expectedRows: T[], actualRows: T[], keyOf: (row: T) => string, fields: (row: T) => Record<string, string>, total: boolean) {
    const wanted = new Map(expectedRows.map(row => [keyOf(row), row]));
    const observed = new Map<string, T[]>();
    for (const row of actualRows) {
      const key = keyOf(row), rows = observed.get(key);
      if (rows) rows.push(row); else observed.set(key, [row]);
    }
    for (const [key, rows] of observed) {
      if (rows.length > 1) discrepancies.push({ kind: total ? "duplicate-total" : "duplicate-event", key, expected: "1", actual: String(rows.length) });
      if (!wanted.has(key)) discrepancies.push({ kind: total ? "unexpected-total" : "unexpected-event", key, expected: null, actual: rows });
    }
    for (const [key, row] of wanted) {
      const rows = observed.get(key);
      if (!rows) { discrepancies.push({ kind: total ? "missing-total" : "missing-event", key, expected: row, actual: null }); continue; }
      for (const actualRow of rows) {
        const values = fields(actualRow);
        for (const [field, value] of Object.entries(fields(row))) {
          const found = values[field]!;
          if (value !== found) discrepancies.push({ kind: total ? "total-field" : "event-field", key, field, expected: value, actual: found,
            ...(total ? { delta: (BigInt(found) - BigInt(value)).toString() } : {}) });
        }
      }
    }
  }
  compare(expected.events, actual.events, eventId, semantic, false);
  compare(expected.totals, actual.totals, groupId, row => ({ count: row.count, solLamports: row.solLamports, tokenBaseUnits: row.tokenBaseUnits }), true);
  if (!expected.events.length) return { verdict: "INCONCLUSIVE" as const, discrepancies, reason: "No expected events; nonempty campaign evidence is required." };
  return { verdict: discrepancies.length ? "FAIL" as const : "PASS" as const, discrepancies };
}
