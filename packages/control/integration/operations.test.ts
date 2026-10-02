import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { testControl, syntheticCase } from "./helpers.js";
import { executeClaim } from "../src/worker.js";
import { digest, loadCase } from "../../runner/src/regression.js";
import { createApi } from "../../../apps/api/src/server.js";

test("durable operations confirm, reduce, compare and export the same failure through the real engine", { timeout: 300000 }, async () => {
  const t = await testControl(), token = "b".repeat(64), api = createApi(t.store, t.storage, token);
  const headers = { authorization: `Bearer ${token}` };
  try {
    const source = await syntheticCase(t.store, t.storage);
    const run = async (kind: string, caseId: string, extra = {}) => {
      const response = await api.inject({ method: "POST", url: "/runs", headers, payload: { projectId: source.projectId, caseId, kind, idempotencyKey: randomUUID(), maxSeconds: 360, ...extra } });
      assert.equal(response.statusCode, 202); const id = response.json().id;
      const claim = (await t.store.claim(randomUUID()))!;
      assert.equal(claim.id, id); assert.equal((await executeClaim(t.store, t.storage, claim)).published, true);
      return (await t.store.job(id))!;
    };
    const original = await t.store.case(source.caseId), hash = digest(readFileSync(join(t.storage, original.storage_path, "runtime-lock.json")));
    const faulty = await run("campaign", source.caseId, { variant: "faulty" });
    assert.equal(faulty.verdict, "FAIL"); assert.equal(faulty.result.faulted.requiredFaultsApplied, true);
    const confirmed = await t.store.case(faulty.result.caseId);
    assert.ok(loadCase(join(t.storage, confirmed.storage_path)).spec.failureFingerprint);
    const reduced = await run("reduce", confirmed.id, { maxAttempts: 3 }); assert.equal(reduced.verdict, "PASS");
    assert.equal(reduced.result.reduction.originalPreserved, true);
    const comparison = await run("compare", reduced.result.caseId, { repeats: 1 }); assert.equal(comparison.verdict, "PASS");
    assert.equal(comparison.result.comparison.cases[0].faultyConfirmed, 1); assert.equal(comparison.result.comparison.cases[0].fixedPassed, 1);
    assert.equal(comparison.result.comparison.cases[0].directory, undefined);
    const exported = await run("export", comparison.result.caseId); assert.equal(exported.verdict, "PASS");
    const download = await api.inject({ url: `/runs/${exported.id}/download`, headers });
    assert.equal(download.statusCode, 200); assert.equal(digest(download.rawPayload), exported.result.download.sha256);
    assert.ok(existsSync(join(t.storage, "attempts", exported.id, "1", "export", "regression.mjs")));
    assert.equal(digest(readFileSync(join(t.storage, original.storage_path, "runtime-lock.json"))), hash);
    const detail = await api.inject({ url: `/cases/${confirmed.id}`, headers }); assert.equal(detail.statusCode, 200);
    const raw = await api.inject({ url: `/cases/${confirmed.id}/sources/source-0`, headers }); assert.equal(raw.statusCode, 200);
    assert.equal(raw.json().sha256, detail.json().input.deliveries[0].raw.sha256);
    assert.equal(raw.json().encoding, "synthetic/base64");
    assert.equal((await api.inject({ url: `/cases/${confirmed.id}/sources/unknown`, headers })).statusCode, 404);
  } finally { await api.close(); await t.cleanup(); }
});

test("local browser pairing requires same-origin loopback intent; hosted pairing requires the existing operator token", async () => {
  const t = await testControl(), token = "c".repeat(64), api = createApi(t.store, t.storage, token);
  const hosted = createApi(t.store, t.storage, token, "https://aftershock.example", "hosted-samples");
  try {
    assert.equal((await api.inject({ method: "POST", url: "/session", payload: {} })).statusCode, 401);
    assert.equal((await api.inject({ method: "POST", url: "/session", headers: { origin: "https://evil.example" }, payload: {} })).statusCode, 403);
    const session = await api.inject({ method: "POST", url: "/session", headers: { origin: "http://127.0.0.1:8787" }, payload: {} });
    assert.equal(session.statusCode, 200); const cookie = session.headers["set-cookie"] as string;
    assert.ok(cookie.includes("HttpOnly; SameSite=Strict")); assert.ok(!cookie.includes(token));
    assert.equal((await api.inject({ url: "/projects", headers: { cookie } })).statusCode, 200);
    assert.equal((await hosted.inject({ method: "POST", url: "/session", headers: { origin: "https://aftershock.example" }, payload: {} })).statusCode, 401);
    assert.equal((await hosted.inject({ method: "POST", url: "/session", headers: { origin: "https://aftershock.example" }, payload: { token } })).statusCode, 200);
  } finally { await api.close(); await hosted.close(); await t.cleanup(); }
});

test("expired live recording is never silently repeated; stale publication and cancellation cannot register a new case", async () => {
  const t = await testControl();
  try {
    const source = await syntheticCase(t.store, t.storage);
    const live = await t.store.enqueue({ kind: "capture", projectId: source.projectId, idempotencyKey: randomUUID() });
    const claim = (await t.store.claim(randomUUID(), 1000))!;
    await t.store.pool.query("UPDATE aftershock_workbench.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [live.id]);
    assert.equal(await t.store.claim(randomUUID()), undefined);
    assert.equal((await t.store.job(live.id))!.verdict, "INCONCLUSIVE");
    let published = false; assert.equal(await t.store.finish(claim, "PASS", {}, async () => { published = true; return {}; }), false); assert.equal(published, false);
    const queued = await t.store.enqueue({ projectId: source.projectId, caseId: source.caseId, variant: "fixed", idempotencyKey: randomUUID() });
    const active = (await t.store.claim(randomUUID()))!; await t.store.cancel(queued.id);
    assert.equal(await t.store.finish(active, "PASS", {}, async () => { published = true; return {}; }), true); assert.equal(published, false);
  } finally { await t.cleanup(); }
});
