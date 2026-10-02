import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ControlError } from "../src/store.js";
import { attemptPath } from "../src/artifacts.js";
import { testControl } from "./helpers.js";

test("transactional claims, reconnect, idempotency, lease fencing, retry bounds and cancellation survive PostgreSQL", async () => {
  const t = await testControl();
  try {
    const project = await t.store.createProject({ name: "Queue acceptance", adapter: "maintained-trade-ledger-v1" });
    const saved = await t.store.registerCase(project.id, `cases/${randomUUID()}`, "a".repeat(64), { source: "synthetic-store-test" });
    const request = { projectId: project.id, caseId: saved.id, variant: "fixed", idempotencyKey: "claim-test" };
    const [a, b] = await Promise.all([t.store.enqueue(request), t.store.enqueue(request)]);
    assert.equal(a.id, b.id);
    await assert.rejects(t.store.enqueue({ ...request, variant: "faulty" }), (e: unknown) => e instanceof ControlError && e.status === 409);
    const claims = await Promise.all([t.store.claim(randomUUID()), t.store.claim(randomUUID())]);
    const old = claims.find(Boolean)!; assert.equal(claims.filter(Boolean).length, 1);
    const reconnected = t.reconnect();
    try { assert.equal((await reconnected.job(a.id))!.state, "RUNNING"); assert.equal((await reconnected.events(a.id)).length, 2); }
    finally { await reconnected.pool.end(); }
    await t.store.pool.query("UPDATE aftershock_workbench.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [a.id]);
    assert.equal((await t.store.heartbeat(old)).owned, false);
    assert.equal(await t.store.progress(old, "faulted", "PASS"), false);
    assert.equal(await t.store.finish(old, "PASS", { forged: true }), false);
    const next = (await t.store.claim(randomUUID()))!;
    assert.equal(next.id, old.id); assert.equal(next.generation, 2);
    assert.notEqual(attemptPath(t.storage, old), attemptPath(t.storage, next));
    assert.equal(await t.store.finish(old, "PASS", { forged: true }), false);
    await t.store.pool.query("UPDATE aftershock_workbench.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [a.id]);
    const last = (await t.store.claim(randomUUID()))!; assert.equal(last.generation, 3);
    await t.store.pool.query("UPDATE aftershock_workbench.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [a.id]);
    assert.equal(await t.store.claim(randomUUID()), undefined);
    assert.equal((await t.store.job(a.id))!.verdict, "RUNNER_ERROR");
    const pending = await t.store.enqueue({ ...request, idempotencyKey: "cancel-queued" });
    assert.equal((await t.store.cancel(pending.id)).state, "CANCELLED"); assert.equal(await t.store.claim(randomUUID()), undefined);
    const active = await t.store.enqueue({ ...request, idempotencyKey: "cancel-running" });
    const owned = (await t.store.claim(randomUUID()))!;
    await t.store.cancel(active.id); assert.deepEqual(await t.store.heartbeat(owned), { owned: true, cancelled: true });
    assert.equal(await t.store.finish(owned, "PASS", { verdict: "PASS" }), true);
    const cancelled = (await t.store.job(active.id))!;
    assert.equal(cancelled.verdict, "CANCELLED"); assert.equal(cancelled.result.verdict, "CANCELLED");
    const events = await t.store.events(a.id); assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1));
  } finally { await t.cleanup(); }
});

test("global worker and queue limits are enforced under competing claims", async () => {
  const t = await testControl();
  try {
    const project = await t.store.createProject({ name: "Limits", adapter: "maintained-trade-ledger-v1" });
    const saved = await t.store.registerCase(project.id, `cases/${randomUUID()}`, "b".repeat(64), {});
    for (let n = 0; n < 20; n++) await t.store.enqueue({ projectId: project.id, caseId: saved.id, variant: "fixed", idempotencyKey: `limited-${n}` });
    await assert.rejects(t.store.enqueue({ projectId: project.id, caseId: saved.id, variant: "fixed", idempotencyKey: "overflow-job" }), (e: unknown) => e instanceof ControlError && e.status === 429);
    const claims = await Promise.all(Array.from({ length: 4 }, () => t.store.claim(randomUUID())));
    assert.equal(claims.filter(Boolean).length, 2);
    assert.equal(new Set(claims.filter(Boolean).map(c => c!.id)).size, 2);
  } finally { await t.cleanup(); }
});
