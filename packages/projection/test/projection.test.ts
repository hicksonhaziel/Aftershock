import { test } from "node:test";
import assert from "node:assert/strict";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION } from "@aftershock/contracts";
import type { ProjectedTrade } from "@aftershock/contracts";
import { compareTradeState, eventId, expectedTradeState } from "../src/index.js";
const trade = (overrides: Partial<ProjectedTrade> = {}): ProjectedTrade => ({
  schemaVersion: 1, identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM,
    signature: "1".repeat(64), instructionPath: [5, 1, 6], ordinal: "0", projectionVersion: TRADE_PROJECTION },
  slot: "450000000", mint: "1".repeat(32), trader: "2".repeat(32), side: "buy",
  solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615",
  provenance: { path: "raw/1.pb", sha256: "a".repeat(64) }, ...overrides,
});

test("synthetic multiple-event transaction retains path and ordinal identity; repeated delivery has one effect", () => {
  const first = trade(), second = trade({ identity: { ...first.identity, instructionPath: [5, 4, 6] } });
  const third = trade({ identity: { ...first.identity, ordinal: "1" } });
  assert.equal(new Set([first, second, third].map(eventId)).size, 3);
  const state = expectedTradeState([first, second, third, first]);
  assert.equal(state.events.length, 3);
  assert.deepEqual(state.totals.map(t => [t.count, t.solLamports, t.tokenBaseUnits]), [["3", "27021597764222979", "55340232221128654845"]]);
  assert.equal(compareTradeState([first, second, third], state).verdict, "PASS");
});
test("mints and buy/sell groups keep separate exact base units", () => {
  const a = trade(), b = trade({ mint: "3".repeat(32), identity: { ...a.identity, ordinal: "1" } });
  const c = trade({ side: "sell", identity: { ...a.identity, ordinal: "2" } });
  assert.equal(expectedTradeState([a, b, c]).totals.length, 3);
});
test("unique rows with duplicate-sensitive totals fail with exact excess", () => {
  const input = [trade()], state = expectedTradeState(input);
  state.totals[0]!.solLamports = "18014398509481986";
  const result = compareTradeState(input, state);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(result.discrepancies.map(d => [d.kind, d.field, d.expected, d.actual, d.delta]),
    [["total-field", "solLamports", "9007199254740993", "18014398509481986", "9007199254740993"]]);
});
test("reports missing, unexpected, duplicate and changed rows even if totals match", () => {
  const first = trade(), second = trade({ identity: { ...first.identity, ordinal: "1" } });
  const state = expectedTradeState([first, second]);
  state.events = [trade({ trader: "4".repeat(32) }), first, trade({ identity: { ...first.identity, ordinal: "2" } })];
  const result = compareTradeState([first, second], state);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(new Set(result.discrepancies.map(d => d.kind)), new Set(["missing-event", "unexpected-event", "duplicate-event", "event-field"]));
});
test("missing, unexpected and duplicated aggregate rows cannot hide behind event equality", () => {
  const input = [trade()], state = expectedTradeState(input), total = state.totals[0]!;
  state.totals = [{ ...total, mint: "3".repeat(32) }, { ...total, mint: "3".repeat(32) }];
  assert.deepEqual(new Set(compareTradeState(input, state).discrepancies.map(d => d.kind)), new Set(["missing-total", "unexpected-total", "duplicate-total"]));
});
test("provenance changes and row order are not business-state changes", () => {
  const a = trade(), b = trade({ identity: { ...a.identity, ordinal: "1" } });
  const state = expectedTradeState([a, b]);
  state.events.reverse(); state.events[0]!.provenance = { path: "raw/replay.pb", sha256: "b".repeat(64) };
  assert.equal(compareTradeState([a, b], state).verdict, "PASS");
});
test("empty evidence cannot pass; malformed and conflicting evidence is a runner error", () => {
  assert.equal(compareTradeState([], expectedTradeState([])).verdict, "INCONCLUSIVE");
  const a = trade();
  assert.equal(compareTradeState([a, trade({ solLamports: "1" })], expectedTradeState([a])).verdict, "RUNNER_ERROR");
  assert.equal(compareTradeState([a], { ...expectedTradeState([a]), events: [trade({ tokenBaseUnits: "1.5" })] }).verdict, "RUNNER_ERROR");
  assert.throws(() => expectedTradeState([trade({ identity: { ...a.identity, projectionVersion: "unknown" } })]));
  assert.throws(() => expectedTradeState(Array(10001).fill(a)));
});
