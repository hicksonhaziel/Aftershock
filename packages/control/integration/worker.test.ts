import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeClaim } from "../src/worker.js";
import { attemptPath, readPublishedArtifact, registerTrustedCase } from "../src/artifacts.js";
import { createApi } from "../../../apps/api/src/server.js";
import { loadCase, digest, sealLock } from "../../runner/src/regression.js";
import { syntheticCase, testControl, until, root } from "./helpers.js";

function configs(storage: string, claim: Parameters<typeof attemptPath>[1]) {
  const results = join(attemptPath(storage, claim), "case/results");
  if (!existsSync(results)) return [];
  return readdirSync(results).flatMap(id => {
    const path = join(results, id, "sample-config.json");
    return existsSync(path) ? [{ path, ...JSON.parse(readFileSync(path, "utf8")) }] : [];
  });
}

test("engine-backed API runs clean baselines, real crashes, exact discrepancies and a healthy fixed sample with inspected evidence", { timeout: 180000 }, async () => {
  const t = await testControl(), token = "b".repeat(64), headers = { authorization: `Bearer ${token}` };
  const app = createApi(t.store, t.storage, token);
  try {
    const source = await syntheticCase(t.store, t.storage);
    for (const variant of ["faulty", "fixed"] as const) {
      const response = await app.inject({ method: "POST", url: "/runs", headers, payload: { projectId: source.projectId, caseId: source.caseId, variant, idempotencyKey: `engine-${variant}` } });
      const claim = (await t.store.claim(randomUUID()))!;
      assert.equal(claim.id, response.json().id);
      const finished = await executeClaim(t.store, t.storage, claim);
      assert.equal(finished.published, true); assert.equal(finished.verdict, variant === "faulty" ? "FAIL" : "PASS", JSON.stringify(finished.result));
      const run = (await app.inject({ url: `/runs/${claim.id}`, headers })).json();
      assert.equal(run.result.baseline.verdict, "PASS"); assert.equal(run.result.faulted.requiredFaultsApplied, true);
      assert.equal(run.result.faulted.cleanup, "removed"); assert.equal(run.result.faulted.resetVerified, true);
      const trace = run.result.artifacts.find((a: any) => a.name === "faulted/recovery-trace.json");
      const observed = (await app.inject({ url: `/runs/${claim.id}/artifacts/${trace.id}`, headers })).json();
      assert.ok(observed.some((e: any) => e.kind === "crash" && e.termination === "SIGKILL" && e.exitObserved));
      const stateRef = run.result.artifacts.find((a: any) => a.name === "faulted/state.json");
      const state = (await app.inject({ url: `/runs/${claim.id}/artifacts/${stateRef.id}`, headers })).json();
      assert.equal(state.events.length, 1); assert.equal(state.totals[0].count, variant === "faulty" ? "2" : "1");
      assert.ok(!JSON.stringify(run).includes("sample-config")); assert.ok(!JSON.stringify(run).includes(t.storage));
      const incident = await app.inject({ url: `/runs/${claim.id}/incident`, headers });
      assert.equal(incident.statusCode, variant === "faulty" ? 200 : 404);
      if (variant === "faulty") {
        assert.equal(incident.json().discrepancies.find((d: any) => d.field === "solLamports").delta, "9007199254740993");
        assert.equal(incident.json().stage, "faulted");
      }
      const events = (await app.inject({ url: `/runs/${claim.id}/events?after=2`, headers })).json();
      assert.equal(events.events.at(-1).kind, "finished");
      // Integrity failure is a server/setup error, never a new consumer assertion failure.
      writeFileSync(join(attemptPath(t.storage, claim), "published", `${stateRef.id}.json`), "{}");
      assert.equal((await app.inject({ url: `/runs/${claim.id}/artifacts/${stateRef.id}`, headers })).statusCode, 500);
    }
    // A resealed arbitrary executable is still rejected by the maintained-build gate.
    const loaded = loadCase(source.directory), ref = loaded.files.get("adapter.mjs")!;
    writeFileSync(join(source.directory, "adapter.mjs"), "throw new Error('untrusted code');\n"); ref.sha256 = digest(readFileSync(join(source.directory, "adapter.mjs")));
    sealLock(source.directory, loaded.lock);
    await assert.rejects(registerTrustedCase(t.store, t.storage, source.projectId, source.directory, join(root, ".aftershock/build")), /current maintained sample build/);
  } finally { await app.close(); await t.cleanup(); }
});

test("lease loss during actual execution aborts the old worker; recovery uses different consumer ownership and cannot publish stale evidence", { timeout: 120000 }, async () => {
  const t = await testControl();
  try {
    const source = await syntheticCase(t.store, t.storage);
    const job = await t.store.enqueue({ projectId: source.projectId, caseId: source.caseId, variant: "fixed", idempotencyKey: "recovery-engine" });
    const first = (await t.store.claim(randomUUID()))!, oldWork = executeClaim(t.store, t.storage, first);
    await until(() => configs(t.storage, first).length > 0);
    const oldConfig = configs(t.storage, first)[0]!;
    await t.store.pool.query("UPDATE aftershock_workbench.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
    const second = (await t.store.claim(randomUUID()))!; assert.equal(second.generation, 2);
    const newWork = executeClaim(t.store, t.storage, second);
    const [oldResult, newResult] = await Promise.all([oldWork, newWork]);
    assert.equal(oldResult.published, false); assert.equal(newResult.published, true); assert.equal(newResult.verdict, "PASS", JSON.stringify(newResult.result));
    const newConfigs = configs(t.storage, second); assert.ok(newConfigs.length >= 2);
    assert.ok(newConfigs.every(c => c.container !== oldConfig.container && c.token !== oldConfig.token && c.runId !== oldConfig.runId));
    assert.equal((await t.store.job(job.id))!.generation, 2); assert.equal((await t.store.job(job.id))!.verdict, "PASS");
    assert.equal(await t.store.finish(first, "FAIL", { stale: true }), false);
    const result = JSON.parse(readFileSync(join(oldConfig.path, "../result.json"), "utf8"));
    assert.equal(result.cleanup, "removed");
    assert.ok((await t.store.events(job.id)).some(e => e.kind === "claimed" && e.payload.attempt === 2));
  } finally { await t.cleanup(); }
});

test("user cancellation stops real active work, preserves evidence and removes owned state", { timeout: 90000 }, async () => {
  const t = await testControl();
  try {
    const source = await syntheticCase(t.store, t.storage);
    const job = await t.store.enqueue({ projectId: source.projectId, caseId: source.caseId, variant: "fixed", idempotencyKey: "cancel-engine" });
    const claim = (await t.store.claim(randomUUID()))!, work = executeClaim(t.store, t.storage, claim);
    await until(() => configs(t.storage, claim).length > 0);
    await t.store.cancel(job.id);
    const outcome = await work; assert.equal(outcome.published, true); assert.equal(outcome.verdict, "CANCELLED");
    assert.equal((await t.store.job(job.id))!.state, "CANCELLED");
    assert.equal(outcome.result.baseline!.cleanup, "removed"); assert.equal(outcome.result.faulted, null);
    const jobState = (await t.store.job(job.id))!;
    assert.ok(jobState.result.artifacts.length > 0);
    for (const ref of jobState.result.artifacts) readPublishedArtifact(t.storage, jobState, ref.id);
  } finally { await t.cleanup(); }
});
