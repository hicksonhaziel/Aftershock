import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApi } from "../../../apps/api/src/server.js";
import { testControl } from "./helpers.js";

test("API protects private data and mutations, preserves run IDs after reconnect, and resumes durable SSE cursors", async () => {
  const t = await testControl(), token = "a".repeat(64), headers = { authorization: `Bearer ${token}` };
  const app = createApi(t.store, t.storage, token);
  try {
    assert.equal((await app.inject({ url: "/projects" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/projects", headers: { ...headers, origin: "https://untrusted.invalid" }, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/projects", headers, payload: { name: "Bad", adapter: "upload" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/projects", headers: { ...headers, "content-type": "application/json" }, payload: "x".repeat(9000) })).statusCode, 413);
    const projectResponse = await app.inject({ method: "POST", url: "/projects", headers, payload: { name: "API acceptance", adapter: "maintained-trade-ledger-v1" } });
    assert.equal(projectResponse.statusCode, 201); const projectId = projectResponse.json().id;
    const saved = await t.store.registerCase(projectId, `cases/${randomUUID()}`, "c".repeat(64), { source: "synthetic-api-test" });
    const payload = { projectId, caseId: saved.id, variant: "fixed", idempotencyKey: "api-request" };
    const queued = await app.inject({ method: "POST", url: "/runs", headers, payload }); assert.equal(queued.statusCode, 202);
    const id = queued.json().id;
    assert.equal((await app.inject({ method: "POST", url: "/runs", headers, payload })).json().id, id);
    assert.equal((await app.inject({ method: "POST", url: "/runs", headers, payload: { ...payload, variant: "faulty" } })).statusCode, 409);
    assert.equal((await app.inject({ url: `/runs/${id}/events?after=-1`, headers })).statusCode, 400);
    const initial = (await app.inject({ url: `/runs/${id}/events`, headers })).json(); assert.equal(initial.nextCursor, 1);
    const claim = (await t.store.claim(randomUUID()))!; await t.store.cancel(id); await t.store.finish(claim, "PASS", null);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const stream = await fetch(`${address}/runs/${id}/stream`, { headers: { ...headers, "last-event-id": "1" } });
    const body = await stream.text(); assert.ok(!body.includes("id: 1\n")); assert.ok(body.includes("id: 2\n")); assert.ok(body.includes("CANCELLED"));
    const reconnected = t.reconnect(), restored = createApi(reconnected, t.storage, token);
    try {
      const afterRefresh = (await restored.inject({ url: `/runs/${id}`, headers })).json();
      assert.equal(afterRefresh.id, id); assert.equal(afterRefresh.state, "CANCELLED");
      assert.equal((await restored.inject({ url: `/runs/${id}/events?after=${initial.nextCursor}`, headers })).json().events.length, 3);
      assert.equal((await restored.inject({ url: `/runs/${id}/incident`, headers })).statusCode, 404);
      const cases = (await restored.inject({ url: `/projects/${projectId}/cases`, headers })).json();
      assert.equal(cases[0].storage_path, undefined);
    } finally { await restored.close(); await reconnected.pool.end(); }
  } finally { await app.close(); await t.cleanup(); }
});
