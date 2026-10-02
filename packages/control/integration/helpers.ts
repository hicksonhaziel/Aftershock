import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ControlStore } from "../src/store.js";
import { registerTrustedCase } from "../src/artifacts.js";
import { createCase, digest } from "../../runner/src/regression.js";
import { PUMPFUN_PROGRAM, TRADE_PROJECTION } from "@aftershock/contracts";

export const root = resolve(import.meta.dirname, "../../..");
export async function testControl() {
  const password = readFileSync(join(root, ".aftershock/dev-db.env"), "utf8").match(/^AFTERSHOCK_DB_PASSWORD=([a-f0-9]{64})$/m)?.[1];
  if (!password) throw new Error("Run pnpm db:up before control integration tests.");
  const base = { host: "127.0.0.1", port: 55439, user: "aftershock", password, connectionTimeoutMillis: 5000 };
  const admin = new pg.Pool({ ...base, database: "aftershock_control" });
  const name = `aftershock_control_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const store = new ControlStore(new pg.Pool({ ...base, database: name }));
  const storage = mkdtempSync(join(tmpdir(), "aftershock-control-test-"));
  await store.migrate();
  return { store, storage, reconnect: () => new ControlStore(new pg.Pool({ ...base, database: name })),
    cleanup: async () => { await store.pool.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); rmSync(storage, { recursive: true, force: true }); } };
}
export async function syntheticCase(store: ControlStore, storage: string) {
  const project = await store.createProject({ name: "Synthetic control acceptance", adapter: "maintained-trade-ledger-v1" });
  const raw = Buffer.from("SYNTHETIC worker persistence fixture; not blockchain evidence");
  writeFileSync(join(storage, "raw.pb"), raw);
  const ref = { path: "raw.pb", sha256: digest(raw) }, signature = "1".repeat(64);
  const event = { schemaVersion: 1, identity: { chain: "solana-mainnet-beta", program: PUMPFUN_PROGRAM, signature,
    instructionPath: [5, 1, 6], ordinal: "0", projectionVersion: TRADE_PROJECTION }, slot: "100", mint: "1".repeat(32), trader: "2".repeat(32),
    side: "buy", solLamports: "9007199254740993", tokenBaseUnits: "18446744073709551615", provenance: ref };
  const input = { schemaVersion: 1, projectionVersion: TRADE_PROJECTION, source: "synthetic", parent: null, evidence: [],
    coverage: { status: "not-assessed", scope: "Synthetic worker acceptance", startSlot: "100", endSlot: "100", missingSlots: [], exclusions: [] },
    deliveries: [{ inputId: "source-0", raw: ref, sourceSequence: "0", signature, slot: "100", events: [event] }] };
  const directory = join(storage, "original"); createCase(directory, input, storage, join(root, ".aftershock/build"), "worker-test", "crash");
  const registered = await registerTrustedCase(store, storage, project.id, directory, join(root, ".aftershock/build"));
  return { projectId: project.id as string, caseId: registered.id as string, directory };
}
export async function until(check: () => boolean | Promise<boolean>, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() >= deadline) throw new Error("Acceptance wait timed out."); await new Promise(resolve => setTimeout(resolve, 50)); }
}
