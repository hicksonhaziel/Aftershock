import assert from "node:assert/strict";
import { test } from "node:test";
import { MAINNET_GENESIS, validEndpoint, verifyRpc } from "../src/rpc.js";

test("rejects bare keys and insecure endpoint URLs", () => {
  assert.equal(validEndpoint("synthetic-key"), false);
  assert.equal(validEndpoint("http://example.com"), false);
  assert.equal(validEndpoint("https://example.com?api_key=synthetic"), true);
});

test("rejects other clusters before requesting slots", async () => {
  let calls = 0;
  await assert.rejects(verifyRpc("https://example.com", async () => {
    calls++;
    return Response.json({ result: "another-genesis" });
  }), /not Solana mainnet/);
  assert.equal(calls, 1);
});

test("does not surface secrets from upstream errors", async () => {
  await assert.rejects(verifyRpc("https://example.com", async () => {
    throw new Error("synthetic-secret-in-network-error");
  }), (error: Error) => !error.message.includes("synthetic-secret"));
  await assert.rejects(verifyRpc("https://example.com", async () =>
    Response.json({ error: { message: "synthetic-secret" } })
  ), (error: Error) => !error.message.includes("synthetic-secret"));
});

test("verifies the cluster and requests a finalized slot", async () => {
  const methods: string[] = [];
  const result = await verifyRpc("https://example.com", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    if (body.method === "getSlot") assert.deepEqual(body.params, [{ commitment: "finalized" }]);
    return Response.json({ result: body.method === "getGenesisHash" ? MAINNET_GENESIS : 123 });
  });
  assert.deepEqual(methods, ["getGenesisHash", "getSlot"]);
  assert.equal(result.finalizedSlot, "123");
});
