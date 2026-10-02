import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { ControlStore } from "./store.js";

export const repositoryRoot = resolve(import.meta.dirname, "../../..");
export function localControl() {
  const storage = resolve(process.env.AFTERSHOCK_WORKBENCH_STORAGE ?? resolve(repositoryRoot, ".aftershock/workbench"));
  mkdirSync(storage, { recursive: true, mode: 0o700 });
  if (realpathSync(storage) !== storage) throw new Error("Workbench storage must not be a symlink.");
  chmodSync(storage, 0o700);
  const url = process.env.AFTERSHOCK_CONTROL_URL;
  let config: pg.PoolConfig;
  if (url) {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.pathname !== "/aftershock_control") throw new Error("Use the dedicated Aftershock control database.");
    config = { connectionString: url };
  } else {
    const contents = readFileSync(resolve(repositoryRoot, ".aftershock/dev-db.env"), "utf8");
    const password = contents.match(/^AFTERSHOCK_DB_PASSWORD=([a-f0-9]{64})$/m)?.[1];
    if (!password) throw new Error("Run pnpm db:up to initialize local control storage.");
    config = { host: "127.0.0.1", port: 55439, user: "aftershock", database: "aftershock_control", password };
  }
  const pool = new pg.Pool({ ...config, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000, idle_in_transaction_session_timeout: 5000 });
  pool.on("error", () => { /* Callers report sanitized operation failures; never log connection credentials. */ });
  return { store: new ControlStore(pool), storage };
}
export function apiToken(storage: string) {
  const path = resolve(storage, "api-token");
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid local API token.");
  chmodSync(path, 0o600); return token;
}
