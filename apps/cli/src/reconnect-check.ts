import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { captureConfigSchema, type CaptureConfig } from "@aftershock/contracts";
import { compareReplay, verifyCapture } from "@aftershock/capture";

let activeChild: ChildProcess | undefined;
let cancelled = false;
let directory: string | undefined;
const cancel = () => { cancelled = true; activeChild?.kill("SIGTERM"); };
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

try {
  if (existsSync(".env")) loadEnvFile(".env");
  const base = captureConfigSchema.parse(JSON.parse(readFileSync("config/capture.example.json", "utf8")));
  if (base.fromSlot !== undefined) throw new Error("The first session must be live.");
  const experimentId = randomUUID();
  directory = resolve(process.env.AFTERSHOCK_DATA_DIR || ".aftershock", "reconnect", experimentId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const run = async (label: string, config: CaptureConfig) => {
    if (cancelled) throw new Error("Cancelled.");
    const configPath = join(directory!, `${label}.json`);
    const root = join(directory!, label);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const startedAtUtc = new Date().toISOString();
    const exitCode = await new Promise<number | null>((accept, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./capture.ts", import.meta.url)), configPath], {
        env: { ...process.env, AFTERSHOCK_DATA_DIR: root }, stdio: "ignore",
      });
      activeChild = child;
      let hardStop: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM"); hardStop = setTimeout(() => child.kill("SIGKILL"), 3000);
      }, 70_000);
      child.once("error", () => { clearTimeout(timeout); clearTimeout(hardStop); activeChild = undefined; reject(new Error("Capture process failed.")); });
      child.once("close", code => { clearTimeout(timeout); clearTimeout(hardStop); activeChild = undefined; accept(code); });
    });
    const closedAtUtc = new Date().toISOString();
    const entries = readdirSync(join(root, "captures"));
    if (entries.length !== 1) throw new Error("Missing capture evidence.");
    const captureDirectory = join(root, "captures", entries[0]!);
    return { ...verifyCapture(captureDirectory), captureDirectory, exitCode, startedAtUtc, closedAtUtc };
  };
  console.log("Recording a small live sample before the pause.");
  const before = await run("before", { ...base, maxTransactions: 25, maxFrames: 100, maxBytes: 2 * 1024 * 1024, durationSeconds: 10 });
  const slots = before.manifest.frames.filter(frame => frame.kind === "transaction" && frame.slot).map(frame => BigInt(frame.slot!));
  if (before.exitCode !== 0 || !slots.length || cancelled) throw new Error("The live sample did not complete.");
  const fromSlot = slots.reduce((a, b) => a > b ? a : b).toString();
  console.log("First capture process closed. Pausing, then requesting replay from its last observed slot.");
  await pause(1500);
  const after = await run("after", { ...base, fromSlot, maxTransactions: 200, maxFrames: 500, maxBytes: 4 * 1024 * 1024, durationSeconds: 10 });
  const result = compareReplay(before.manifest, after.manifest);
  const summarize = (session: typeof before) => ({ captureId: session.manifest.captureId, manifestSha256: session.manifestHash,
    exitCode: session.exitCode, startedAtUtc: session.startedAtUtc, closedAtUtc: session.closedAtUtc,
    transactions: session.manifest.transactions, stopReason: session.manifest.stopReason });
  const report = { schemaVersion: 1, experimentId, operation: "close-capture-process-then-open-new-subscription",
    requestedPauseMs: 1500, before: summarize(before), after: summarize(after), result };
  const bytes = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(join(directory, "reconnect.json"), bytes, { flag: "wx", mode: 0o600, flush: true });
  writeFileSync(join(directory, "reconnect.sha256"), digest(bytes) + "\n", { flag: "wx", mode: 0o600, flush: true });
  console.log(`Before pause: ${before.manifest.transactions} transactions. After reconnect: ${after.manifest.transactions}.`);
  console.log(`Known transactions at the replay boundary: ${result.knownTransactionCount}; received again: ${result.reobserved.length}.`);
  console.log(`Not re-observed within this bounded run: ${result.notReobserved.length}.`);
  console.log(`Later-slot data observed: ${result.advancedBeyondRequestedSlot}. Gap-free coverage: not assessed.`);
  console.log(`Evidence: ${directory}`);
  process.exitCode = !cancelled && before.exitCode === 0 && after.exitCode === 0 && result.sessionsHealthy && result.overlapObserved && !result.notReobserved.length && result.advancedBeyondRequestedSlot ? 0 : 3;
} catch {
  console.error("Reconnect experiment could not complete. Configuration, connectivity, or local evidence needs inspection; credentials withheld.");
  if (directory) console.error(`Partial evidence: ${directory}`);
  process.exitCode = 2;
} finally {
  activeChild?.kill("SIGTERM");
  process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
}
