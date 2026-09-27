import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAudit } from "../src/normalize-trades.js";
const source = { deliveryId: "source-1", sourceSequence: 1, slot: "100", signature: "1".repeat(64), rawSha256: "a".repeat(64), file: "frame-1.pb.gz" };
const event = { signature: source.signature, instructionPath: [5, 1, 6], ordinal: "0", slot: "100", mint: "1".repeat(32), trader: "2".repeat(32), side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615" };
const output = (events: unknown[]) => events.map(e => "AFTERSHOCK_TRADE_AUDIT=" + JSON.stringify(e)).join("\n") + `\nreplay finished: 1 passes, 1 sent, 0 skipped\nCollected ${events.length} events\n`;
test("synthetic decoder audit preserves exact amounts, multiple-event paths and source links", () => {
  const result = normalizeAudit(output([event, { ...event, instructionPath: [5, 4, 6] }]), [source]);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0]!.provenance.sha256, source.rawSha256);
  assert.equal(result.expected.totals[0]!.solLamports, "18014398509481986");
});
test("skipped, empty, unsupported and incomplete decoder output cannot become accepted evidence", () => {
  for (const text of [output([]), output([event]).replace("0 skipped", "1 skipped"), output([event]).replace("Collected 1", "Collected 2"), output([event]).replace("1 sent", "0 sent"), output([event]) + "replay finished: 1 passes, 1 sent, 0 skipped\n"])
    assert.throws(() => normalizeAudit(text, [source]));
});
test("source mismatch, numeric precision loss and ambiguous identities are rejected", () => {
  for (const events of [[{ ...event, slot: "101" }], [{ ...event, signature: "2".repeat(64) }], [{ ...event, solLamports: 9007199254740992 }], [event, event]])
    assert.throws(() => normalizeAudit(output(events), [source]));
  assert.throws(() => normalizeAudit(output([event]), [source, source]));
});
