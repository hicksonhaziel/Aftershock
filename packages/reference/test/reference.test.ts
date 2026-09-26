import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFinalizedMembership, type ReferenceRpc } from "../src/index.js";
const a = "a".repeat(64), b = "b".repeat(64);
const observation = { slot: "10", signature: a };
const block = (signatures = [a]) => ({ blockhash: "c".repeat(32), signatures });

test("verifies membership without claiming capture completeness", async () => {
  const result = await checkFinalizedMembership([observation, observation], "20", async method => method === "getBlocks" ? [10] : block());
  assert.equal(result.verdict, "PASS");
  assert.equal(result.duplicateDeliveries, 1);
  assert.equal(result.captureCompleteness, "not-assessed");
});

test("absent signature in an available block is an explicit discrepancy", async () => {
  const result = await checkFinalizedMembership([observation], "20", async method => method === "getBlocks" ? [10] : block([b]));
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.transactions[0]?.status, "absent");
});

test("null, failed, and malformed block responses never become empty blocks", async () => {
  for (const value of [null, {}, { ...block(), signatures: ["bad"] }]) {
    const result = await checkFinalizedMembership([observation], "20", async method => method === "getBlocks" ? [10] : value);
    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.equal(result.ledger[0]?.attempts, 2);
  }
});

test("enumeration errors and unreturned observed slots remain unresolved", async () => {
  const unavailable: ReferenceRpc = async () => { throw new Error("synthetic upstream failure"); };
  for (const rpc of [unavailable, async () => []]) {
    const result = await checkFinalizedMembership([observation], "20", rpc);
    assert.equal(result.verdict, "INCONCLUSIVE");
  }
});

test("a slot gap without an observation is not invented missing data", async () => {
  const result = await checkFinalizedMembership([observation, { slot: "12", signature: a }], "20", async method => method === "getBlocks" ? [10, 12] : block());
  assert.equal(result.verdict, "PASS");
  assert.equal(result.ledger[1]?.status, "not-returned");
});

test("unfinalized intervals trigger no reference requests", async () => {
  const result = await checkFinalizedMembership([observation], "9", async () => { assert.fail("Must not request an unfinalized interval"); });
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.ledger[0]?.status, "not-finalized");
});

test("empty and oversized intervals are rejected before requests", async () => {
  const rpc: ReferenceRpc = async () => { assert.fail("Must validate before requests"); };
  await assert.rejects(checkFinalizedMembership([], "20", rpc));
  await assert.rejects(checkFinalizedMembership([observation, { slot: "30", signature: a }], "40", rpc), /16 slots/);
});

test("requests use finalized signatures and supported transaction version", async () => {
  await checkFinalizedMembership([observation], "20", async (method, params) => {
    if (method === "getBlocks") { assert.deepEqual(params, [10, 10, { commitment: "finalized" }]); return [10]; }
    assert.deepEqual(params, [10, { commitment: "finalized", encoding: "json", transactionDetails: "signatures", maxSupportedTransactionVersion: 0, rewards: false }]);
    return block();
  });
});
