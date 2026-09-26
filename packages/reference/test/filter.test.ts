import assert from "node:assert/strict";
import { test } from "node:test";
import { filterFinalizedBlock } from "../src/filter.js";
const account = "a".repeat(32), other = "b".repeat(32), id = "c".repeat(64);
const fixture = () => ({ blockhash: other, transactions: [{ version: "legacy" as string | number,
  transaction: { signatures: [id], message: { accountKeys: [account, other], instructions: [{ programIdIndex: 1 }] } },
  meta: { err: null as unknown, loadedAddresses: { writable: [] as string[], readonly: [] as string[] } } }] });
test("matches account mention without requiring invocation and excludes failed transactions", () => {
  const block = fixture();
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
  block.transactions[0]!.meta.err = { InstructionError: [0, "InvalidArgument"] };
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, []);
});
test("resolves writable and readonly version-zero addresses without mutating evidence", () => {
  for (const kind of ["writable", "readonly"] as const) {
    const block = fixture(), tx = block.transactions[0]!;
    tx.version = 0; tx.transaction.message.accountKeys = [other]; tx.transaction.message.instructions = [];
    tx.meta.loadedAddresses[kind] = [account];
    const original = JSON.stringify(block);
    assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
    assert.equal(JSON.stringify(block), original);
  }
});
test("simple vote exclusion respects version, signatures, and instruction count", () => {
  const block = fixture(), tx = block.transactions[0]!;
  tx.transaction.message.accountKeys[1] = "Vote111111111111111111111111111111111111111";
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, []);
  tx.version = 0;
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
  tx.version = "legacy"; tx.transaction.message.instructions.push({ programIdIndex: 1 });
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
  tx.transaction.message.instructions.pop(); tx.transaction.signatures.push("d".repeat(64), "e".repeat(64));
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
});
test("unknown versions, missing metadata, invalid indices and duplicates cannot become empty reference", () => {
  for (const mutate of [
    (b: any) => { b.transactions[0].version = 2; },
    (b: any) => { b.transactions[0].meta = null; },
    (b: any) => { delete b.transactions[0].meta.err; },
    (b: any) => { b.transactions[0].version = 0; delete b.transactions[0].meta.loadedAddresses; },
    (b: any) => { b.transactions[0].transaction.message.instructions[0].programIdIndex = 9; },
    (b: any) => { b.transactions.push(b.transactions[0]); },
  ]) { const block = fixture(); mutate(block); assert.throws(() => filterFinalizedBlock(block, [account])); }
  assert.throws(() => filterFinalizedBlock(null, [account]));
});

test("version one uses inline accounts without requiring lookup metadata", () => {
  const block = fixture();
  block.transactions[0]!.version = 1;
  Reflect.deleteProperty(block.transactions[0]!.meta, "loadedAddresses");
  assert.deepEqual(filterFinalizedBlock(block, [account]).signatures, [id]);
});
