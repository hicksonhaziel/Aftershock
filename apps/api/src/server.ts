import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { campaignRequestSchema, projectRequestSchema, progressCursorSchema } from "@aftershock/contracts";
import { ControlError, publicJob, readPublishedArtifact, type ControlStore } from "@aftershock/control";

function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new ControlError(400, "A valid ID is required.");
  return value;
}
export function createApi(store: ControlStore, storage: string, token: string, origin = "http://127.0.0.1:8787") {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("API token is required.");
  const app = Fastify({ logger: false, bodyLimit: 8192, requestTimeout: 10000, connectionTimeout: 10000 });
  let streams = 0;
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof ControlError;
    const invalid = !!(error && typeof error === "object" && "name" in error && error.name === "ZodError");
    const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = known ? error.status : invalid || statusCode === 400 ? 400 : statusCode === 413 ? 413 : 500;
    void reply.code(status).send({ error: known ? error.message : status === 400 ? "Invalid request settings." : status === 413 ? "Request body is too large." : "Operation failed; check local setup and saved evidence." });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    if (request.url === "/health" && request.method === "GET") return;
    if (request.headers.origin && request.headers.origin !== origin) throw new ControlError(403, "Origin is not allowed.");
    const supplied = request.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    const suppliedBytes = Buffer.from(supplied), expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new ControlError(401, "API authentication is required.");
  });
  app.get("/health", async () => ({ status: "ready", mode: "local", phase: "4-in-progress" }));
  app.get("/capabilities", async () => ({
    adapter: "maintained-trade-ledger-v1", variants: ["faulty", "fixed"],
    inputMode: "operator-imported saved inputs", privateCodeUpload: false,
    supportedFaults: ["duplicate", "crash-afterDurableEffectCommit", "disconnect-overlap", "temporary-omission", "permanent-omission"],
    baselineRequired: true, liveCaptureApi: false, reductionApi: false, comparisonApi: false,
    limits: { queuedAndRunning: 20, concurrentLeases: 2, attempts: 3, maxSeconds: 360, cleanupGraceSeconds: 90,
      caseBytes: 32 * 1024 * 1024, storageBytes: 1024 * 1024 * 1024 },
    limitations: ["Trusted maintained sample code only", "Fresh state replaces an expired attempt; interrupted consumer state is never shared", "Finite saved-input assertions do not prove whole-chain completeness"] }));
  app.get("/projects", async () => store.projects());
  app.post("/projects", async (request, reply) => { const body = projectRequestSchema.safeParse(request.body); if (!body.success) throw new ControlError(400, "Invalid project settings."); return reply.code(201).send(await store.createProject(body.data)); });
  app.get<{ Params: { id: string } }>("/projects/:id/cases", async request => store.cases(uuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/projects/:id/runs", async request => (await store.jobs(uuid(request.params.id))).map(publicJob));
  app.post("/runs", async (request, reply) => {
    const body = campaignRequestSchema.safeParse(request.body); if (!body.success) throw new ControlError(400, "Invalid campaign settings.");
    return reply.code(202).send(publicJob(await store.enqueue(body.data)));
  });
  const requiredJob = async (id: string) => { const job = await store.job(uuid(id)); if (!job) throw new ControlError(404, "Run not found."); return job; };
  app.get<{ Params: { id: string } }>("/runs/:id", async request => publicJob(await requiredJob(request.params.id)));
  app.post<{ Params: { id: string } }>("/runs/:id/cancel", async request => publicJob(await store.cancel(uuid(request.params.id))));
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/runs/:id/events", async request => {
    const job = await requiredJob(request.params.id);
    const cursor = progressCursorSchema.safeParse(request.query.after ?? 0); if (!cursor.success) throw new ControlError(400, "Invalid progress cursor.");
    const events = await store.events(job.id, cursor.data);
    return { job: publicJob(job), events, nextCursor: events.at(-1)?.sequence ?? cursor.data };
  });
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/runs/:id/stream", async (request, reply) => {
    const job = await requiredJob(request.params.id);
    const cursorValue = request.headers["last-event-id"] ?? request.query.after ?? 0;
    const parsed = progressCursorSchema.safeParse(cursorValue); if (!parsed.success) throw new ControlError(400, "Invalid progress cursor.");
    if (streams >= 16) throw new ControlError(429, "Progress connection limit reached.");
    streams++;
    reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    let cursor = parsed.data, closed = false;
    const close = () => { closed = true; }; reply.raw.once("close", close);
    const deadline = Date.now() + 30000;
    try {
      while (!closed && Date.now() < deadline) {
        const events = await store.events(job.id, cursor);
        for (const event of events) {
          if (!reply.raw.write(`id: ${event.sequence}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`)) { closed = true; break; }
          cursor = event.sequence;
        }
        if (closed) break;
        const current = await store.job(job.id);
        if (current && ["COMPLETED", "CANCELLED"].includes(current.state)) break;
        reply.raw.write(": heartbeat\n\n");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch { if (!closed) reply.raw.write("event: retry\ndata: {\"message\":\"Reconnect to resume saved progress.\"}\n\n"); }
    finally { streams--; reply.raw.removeListener("close", close); reply.raw.end(); }
  });
  app.get<{ Params: { id: string } }>("/runs/:id/incident", async request => {
    const job = await requiredJob(request.params.id), result = job.result;
    const failed = result?.faulted?.verdict === "FAIL" ? result.faulted : result?.baseline?.verdict === "FAIL" ? result.baseline : null;
    if (!failed) throw new ControlError(404, "This run has no proven assertion failure.");
    return { runId: job.id, failureFingerprint: failed.failureFingerprint, assertion: result.provenance.assertion,
      stage: result.faulted?.verdict === "FAIL" ? "faulted" : "baseline", discrepancies: result.discrepancies,
      requiredFaultsApplied: failed.requiredFaultsApplied, provenance: result.provenance, artifacts: result.artifacts,
      explanation: "Inspect expected totals, observed state, and the delivery/commit/checkpoint trace. This is an intentional sample defect." };
  });
  app.get<{ Params: { id: string; artifactId: string } }>("/runs/:id/artifacts/:artifactId", async (request, reply) => {
    const job = await requiredJob(request.params.id), artifact = readPublishedArtifact(storage, job, uuid(request.params.artifactId));
    return reply.type("application/json").header("Content-Disposition", 'inline; filename="evidence.json"').send(artifact.bytes);
  });
  return app;
}
