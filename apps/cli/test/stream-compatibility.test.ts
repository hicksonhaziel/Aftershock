import assert from "node:assert/strict";
import { test } from "node:test";
import { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";
import { compareStreamTransaction } from "../src/stream-compatibility.js";
function fixture(version: "legacy" | 0 | 1) {
  const key = new Uint8Array(32).fill(2), signature = new Uint8Array(64).fill(3);
  const header = { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 };
  const message = { header, accountKeys: [key], recentBlockhash: key, versioned: version !== "legacy", instructions: [{ programIdIndex: 0, accounts: new Uint8Array([0]), data: new Uint8Array([1]) }],
    ...(version === 1 ? { config: { priorityFee: "9007199254740993", computeUnitLimit: 10 } } : {}) };
  const update = SubscribeUpdate.fromPartial({ transaction: { slot: "10", transaction: { signature, transaction: { signatures: [signature], message }, meta: {} } } });
  const reference = { version, transaction: { signatures: [bs58.encode(signature)], message: {
    header, accountKeys: [bs58.encode(key)], recentBlockhash: bs58.encode(key), addressTableLookups: [],
    instructions: [{ programIdIndex: 0, accounts: [0], data: bs58.encode(new Uint8Array([1])), stackHeight: 1 }],
    transactionConfig: { priorityFee: "9007199254740993" as string | number, computeUnitLimit: 10 },
  } }, meta: { err: null, loadedAddresses: { writable: [] as string[], readonly: [] as string[] } } };
  return { update, reference, raw: () => SubscribeUpdate.encode(update).finish() };
}
test("legacy, v0 and v1 fields survive protobuf encoding and match RPC representation", () => {
  for (const version of ["legacy", 0, 1] as const) {
    const f = fixture(version);
    assert.equal(compareStreamTransaction(f.raw(), f.reference).verdict, "PASS");
  }
});
test("dropped v1 config, altered instructions and loaded addresses produce discrepancies", () => {
  const f = fixture(1);
  f.update.transaction!.transaction!.transaction!.message!.config = undefined;
  assert.deepEqual(compareStreamTransaction(f.raw(), f.reference).mismatches, ["version", "config"]);
  const v0 = fixture(0);
  v0.reference.meta.loadedAddresses.writable.push("a".repeat(32));
  v0.reference.transaction.message.instructions[0]!.accounts = [];
  assert.deepEqual(compareStreamTransaction(v0.raw(), v0.reference).mismatches, ["loadedWritable", "instructions"]);
});
test("unsafe JSON numeric config cannot masquerade as an exact comparison", () => {
  const f = fixture(1);
  f.reference.transaction.message.transactionConfig.priorityFee = Number("9007199254740993");
  assert.throws(() => compareStreamTransaction(f.raw(), f.reference), /Unsafe reference integer/);
});
