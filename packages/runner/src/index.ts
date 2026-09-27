import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { adapterRequestSchema, adapterResponseSchema, artifactRefSchema } from "@aftershock/contracts";
import type { AdapterDescription } from "@aftershock/contracts";

type Request = ReturnType<typeof adapterRequestSchema.parse>;
type Response = ReturnType<typeof adapterResponseSchema.parse>;
type Result = Extract<Response, { result: unknown }>["result"];
type Ref = ReturnType<typeof artifactRefSchema.parse>;
export class RunnerError extends Error {
  readonly verdict = "RUNNER_ERROR";
}
export class AdapterError extends Error {
  constructor(readonly verdict: "UNSUPPORTED" | "RUNNER_ERROR" | "INCONCLUSIVE") { super(`Adapter returned ${verdict}.`); }
}

/** Verify references inside an owned directory; never execute commands supplied by artifacts. */
export function readArtifact(directory: string, value: Ref, maxBytes = 16 * 1024 * 1024): Buffer {
  const ref = artifactRefSchema.parse(value), root = realpathSync(directory), path = realpathSync(resolve(root, ref.path));
  if (!path.startsWith(root + sep) || !statSync(path).isFile() || statSync(path).size > maxBytes) throw new RunnerError("Artifact outside owned directory or size limit.");
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) throw new RunnerError("Artifact hash mismatch.");
  return bytes;
}

/** One trusted executable, one run, serialized JSON-RPC. No crash/barrier support yet. */
export class AdapterSupervisor {
  private child: ChildProcessWithoutNullStreams;
  private state: "new" | "started" | "drained" | "stopped" | "closed" = "new";
  private failure: Error | undefined;
  private description: AdapterDescription | undefined;
  private nextId = 0;
  private lastSequence: bigint | undefined;
  private deliveries = new Set<string>();
  private buffer = Buffer.alloc(0);
  private outputBytes = 0;
  private pending: { id: string; resolve: (result: Result) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  private lifetime: NodeJS.Timeout;
  private exitPromise: Promise<void>;
  constructor(private options: {
    executable: string; args: string[]; directory: string; runId: string; ownershipToken: string;
    requestTimeoutMs: number; durationMs: number; maxOutputBytes: number;
    network: "disabled";
  }) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(options.ownershipToken) || !Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1 || options.requestTimeoutMs > 60000
      || !Number.isInteger(options.durationMs) || options.durationMs < 1 || options.durationMs > 300000
      || !Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 1024 || options.maxOutputBytes > 64 * 1024 * 1024)
      throw new RunnerError("Invalid supervisor limits.");
    this.child = spawn("/usr/bin/unshare", ["--user", "--map-root-user", "--net", options.executable, ...options.args], {
      cwd: options.directory, env: { PATH: "/usr/bin:/bin", LANG: "C" }, stdio: ["pipe", "pipe", "pipe"], detached: true,
    });
    this.exitPromise = new Promise(resolveExit => this.child.once("close", () => {
      if (this.state !== "closed") this.fail("Adapter exited before supervisor disposal.");
      resolveExit();
    }));
    this.child.on("error", () => this.fail("Adapter process could not start."));
    this.child.stdin.on("error", () => this.fail("Adapter input closed unexpectedly."));
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    // Count diagnostics, but never echo arbitrary child text that may contain secrets.
    this.child.stderr.on("data", (chunk: Buffer) => this.account(chunk.length));
    this.lifetime = setTimeout(() => this.fail("Run duration exceeded."), options.durationMs);
  }
  private kill() {
    if (this.child.pid) { try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* Already exited. */ } }
  }
  private fail(message: string) {
    if (!this.failure) this.failure = new RunnerError(message);
    this.state = "closed";
    clearTimeout(this.lifetime);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(this.failure); this.pending = undefined; }
    this.kill();
  }
  private account(bytes: number) {
    this.outputBytes += bytes;
    if (this.outputBytes > this.options.maxOutputBytes) this.fail("Adapter output limit exceeded.");
  }
  private receive(chunk: Buffer) {
    this.account(chunk.length);
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      if (newline > 1024 * 1024) { this.fail("Adapter line limit exceeded."); return; }
      const line = this.buffer.subarray(0, newline); this.buffer = this.buffer.subarray(newline + 1);
      try {
        const response = adapterResponseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)));
        const pending = this.pending;
        if (!pending || response.id !== pending.id) throw new Error();
        clearTimeout(pending.timer); this.pending = undefined;
        if ("error" in response) pending.reject(new AdapterError(response.error.verdict));
        else pending.resolve(response.result);
      } catch { this.fail("Malformed, unsolicited or uncorrelated adapter response."); return; }
    }
    if (this.buffer.length > 1024 * 1024) this.fail("Adapter line limit exceeded.");
  }
  private async request(method: Request["method"], params: Record<string, unknown>): Promise<Result> {
    if (this.failure) throw this.failure;
    if (this.pending || this.state === "closed") throw new RunnerError("Concurrent or closed adapter request.");
    const id = `request-${++this.nextId}`;
    const request = adapterRequestSchema.parse({ jsonrpc: "2.0", id, method, params: { protocolVersion: 1, ...params } });
    try {
      const result = await new Promise<Result>((resolveResult, reject) => {
        const timer = setTimeout(() => this.fail("Adapter request timed out."), this.options.requestTimeoutMs);
        this.pending = { id, resolve: resolveResult, reject, timer };
        this.child.stdin.write(JSON.stringify(request) + "\n");
      });
      if (this.failure) throw this.failure;
      if ("runId" in result && result.runId !== this.options.runId) throw new RunnerError("Adapter responded for another run.");
      return result;
    } catch (error) {
      this.fail("Adapter request failed.");
      throw error;
    }
  }
  private require(condition: boolean) {
    if (this.failure) throw this.failure;
    if (!condition) { this.fail("Invalid adapter lifecycle or response."); throw this.failure!; }
  }
  async describe() {
    const result = await this.request("describe", {});
    this.require(result.kind === "description");
    if (result.kind !== "description") throw new RunnerError("Missing description.");
    this.description = result.description;
    return result.description;
  }
  async start(initialState: Ref) {
    this.require(this.state === "new" && !!this.description);
    readArtifact(this.options.directory, initialState);
    const result = await this.request("start", { runId: this.options.runId, initialState });
    this.require(result.kind === "lifecycle" && result.state === "started"); this.state = "started";
  }
  async deliver(deliveryId: string, sequence: string, input: Ref) {
    this.require((this.state === "started" || this.state === "drained") && !this.deliveries.has(deliveryId)
      && /^(0|[1-9][0-9]*)$/.test(sequence) && (this.lastSequence === undefined || BigInt(sequence) === this.lastSequence + 1n)
      && this.deliveries.size < 10000);
    readArtifact(this.options.directory, input);
    const result = await this.request("deliver", { runId: this.options.runId, deliveryId, sequence, input });
    this.require(result.kind === "ack" && result.deliveryId === deliveryId && result.acknowledgement === this.description!.acknowledgement);
    this.deliveries.add(deliveryId); this.lastSequence = BigInt(sequence); this.state = "started";
  }
  async drain() {
    this.require(this.state === "started" && this.lastSequence !== undefined);
    const throughSequence = String(this.lastSequence);
    const result = await this.request("drain", { runId: this.options.runId, throughSequence });
    this.require(result.kind === "drained" && result.throughSequence === throughSequence); this.state = "drained";
  }
  async snapshot() {
    this.require(this.state === "drained");
    const result = await this.request("snapshot", { runId: this.options.runId });
    this.require(result.kind === "snapshot");
    if (result.kind !== "snapshot") throw new RunnerError("Missing snapshot.");
    const snapshot = result.snapshot;
    this.require(snapshot.runId === this.options.runId && snapshot.projectionVersion === this.description!.projectionContract
      && snapshot.drainedThrough === String(this.lastSequence));
    this.checkCheckpoint(snapshot.checkpoint);
    readArtifact(this.options.directory, snapshot.state);
    return snapshot;
  }
  private checkCheckpoint(checkpoint: { runId: string; supported: boolean; lastDurableDelivery: string | null; consumerValue: Ref | null }) {
    this.require(checkpoint.runId === this.options.runId && checkpoint.supported === this.description!.supportsCheckpoints
      && (checkpoint.lastDurableDelivery === null || (this.lastSequence !== undefined && BigInt(checkpoint.lastDurableDelivery) <= this.lastSequence)));
    if (checkpoint.consumerValue) readArtifact(this.options.directory, checkpoint.consumerValue);
  }
  async checkpoint() {
    this.require(this.state === "drained");
    const result = await this.request("checkpoint", { runId: this.options.runId });
    this.require(result.kind === "checkpoint");
    if (result.kind !== "checkpoint") throw new RunnerError("Missing checkpoint.");
    this.checkCheckpoint(result.checkpoint); return result.checkpoint;
  }
  async stop() {
    this.require(this.state === "started" || this.state === "drained");
    const result = await this.request("stop", { runId: this.options.runId });
    this.require(result.kind === "lifecycle" && result.state === "stopped"); this.state = "stopped";
  }
  async reset(ownershipToken: string) {
    this.require(this.state === "stopped" && ownershipToken === this.options.ownershipToken);
    const result = await this.request("reset", { runId: this.options.runId, ownershipToken });
    this.require(result.kind === "lifecycle" && result.state === "reset");
    this.state = "new"; this.lastSequence = undefined; this.deliveries.clear();
  }
  async dispose() {
    this.state = "closed"; clearTimeout(this.lifetime);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new RunnerError("Run cancelled.")); this.pending = undefined; }
    this.kill(); await this.exitPromise;
  }
}
