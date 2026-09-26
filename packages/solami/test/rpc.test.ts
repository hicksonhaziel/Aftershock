import assert from "node:assert/strict";
import { test } from "node:test";
import { readRpc, RpcFailure } from "../src/index.js";

test("limits streamed response bytes before retaining an oversized body", async () => {
  let cancelled = false;
  const request: typeof fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(100)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readRpc("https://example.com", "getBlock", [], request, 50), (error: RpcFailure) => error.kind === "size");
  assert.equal(cancelled, true);
});

test("retains exact successful response bytes for reference evidence", async () => {
  const raw = '{ "jsonrpc": "2.0", "id": 1, "result": [12,13] }';
  const response = await readRpc("https://example.com", "getBlocks", [], async () => new Response(raw));
  assert.equal(response.raw.toString(), raw);
  assert.deepEqual(response.result, [12, 13]);
});

test("RPC failures retain only numeric codes, not upstream messages", async () => {
  await assert.rejects(readRpc("https://example.com", "getBlock", [], async () => Response.json({
    error: { code: -32009, message: "synthetic-secret" },
  })), (error: RpcFailure) => error.kind === "rpc" && error.code === -32009 && !error.message.includes("synthetic-secret"));
});

test("null remains an explicit response, while malformed envelopes fail", async () => {
  assert.equal((await readRpc("https://example.com", "getBlock", [], async () => Response.json({ result: null }))).result, null);
  await assert.rejects(readRpc("https://example.com", "getBlock", [], async () => Response.json({})), (error: RpcFailure) => error.kind === "format");
});
