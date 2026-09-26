import assert from "node:assert/strict";
import { test } from "node:test";
import { SubscribeUpdate, SubscribeUpdateTransactionInfo } from "@triton-one/yellowstone-grpc";
import { protobufMessageField } from "../src/protobuf-field.js";
test("extracts original transaction-info bytes, including unknown future fields", () => {
  const info = SubscribeUpdateTransactionInfo.encode(SubscribeUpdateTransactionInfo.fromPartial({ signature: new Uint8Array([7]) })).finish();
  const future = Buffer.concat([info, Buffer.from([0xf8, 0x07, 0x01])]); // unknown field 127
  const nested = Buffer.concat([Buffer.from([10, future.length]), future, Buffer.from([16, 10])]);
  const raw = Buffer.concat([Buffer.from([34, nested.length]), nested]);
  assert.equal(SubscribeUpdate.decode(raw).transaction?.slot, "10");
  assert.deepEqual(Buffer.from(protobufMessageField(protobufMessageField(raw, 4), 1)), future);
});
test("malformed, ambiguous and missing frames cannot silently produce replay input", () => {
  for (const raw of [[34, 4, 1], [34, 0, 34, 0], [32, 1], [0], [0x80], [13, 1], [11], [10, 0]])
    assert.throws(() => protobufMessageField(new Uint8Array(raw), 4));
});
