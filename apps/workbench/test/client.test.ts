import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/client";

test("an expired session signals reconnect instead of leaving protected screens loading", async () => {
  let ended = 0;
  const api = createApiClient("/api", () => ended++, async () => new Response("", { status: 401 }));
  await assert.rejects(api("/projects"), error => error instanceof ApiError && error.status === 401 && error.message.includes("Connect the runner again"));
  assert.equal(ended, 1);
});

test("unavailable and non-JSON responses use readable errors without reflecting response content", async () => {
  const unavailable = createApiClient("", () => {}, async () => { throw new Error("private transport details"); });
  await assert.rejects(unavailable("/projects"), error => error instanceof ApiError && error.status === 0 && error.message === "Runner unavailable. Try reconnecting.");
  const malformed = createApiClient("", () => {}, async () => new Response("<html>private proxy details</html>", { status: 502 }));
  await assert.rejects(malformed("/projects"), error => error instanceof ApiError && !error.message.includes("private") && error.message.includes("unreadable response"));
});

test("aborted requests do not become reconnect prompts and successful mutations retain session credentials", async () => {
  const controller = new AbortController(), reason = new DOMException("Aborted", "AbortError");
  controller.abort();
  const aborted = createApiClient("", () => assert.fail("Unexpected session invalidation"), async () => { throw reason; });
  await assert.rejects(aborted("/projects", undefined, controller.signal), error => error === reason);
  const mutation = createApiClient("/api", () => {}, async (url, settings) => {
    assert.equal(url, "/api/runs");
    assert.equal(settings?.credentials, "same-origin");
    assert.equal(settings?.method, "POST");
    assert.equal(settings?.body, '{"caseId":"case"}');
    return Response.json({ id: "run" });
  });
  assert.deepEqual(await mutation("/runs", { caseId: "case" }), { id: "run" });
});
