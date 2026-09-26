import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../..");
const envFile = resolve(root, ".aftershock/dev-db.env");
const project = process.env.AFTERSHOCK_COMPOSE_PROJECT || "aftershock-dev";
const args = ["compose", "--project-name", project, "--env-file", envFile, "-f", resolve(root, "compose.yaml")];
function docker(extra: string[], input?: string, timeout = 60_000) {
  const result = spawnSync("docker", [...args, ...extra], { encoding: "utf8", timeout, maxBuffer: 1024 * 1024,
    ...(input === undefined ? {} : { input }) });
  if (result.error || result.status !== 0) throw new Error("Local database operation failed; verify Docker and port 55439 availability.");
  return result.stdout.trim();
}
function sql(database: string, input: string) {
  return docker(["exec", "-T", "db", "psql", "-X", "-q", "-A", "-t", "-U", "aftershock", "-d", database, "-v", "ON_ERROR_STOP=1"], input);
}
const action = process.argv[2];
try {
  if (!/^aftershock-[a-z0-9-]{1,40}$/.test(project)) throw new Error("Use an Aftershock-owned Compose project name.");
  if (!["up", "check", "down"].includes(action ?? "")) throw new Error("Use db:up, db:check or db:down.");
  if (action === "up") {
    if (!existsSync(envFile)) {
      const volumes = spawnSync("docker", ["volume", "ls", "--format", "{{.Name}}"], { encoding: "utf8", timeout: 10_000 });
      if (volumes.error || volumes.status !== 0) throw new Error("Could not inspect owned database storage.");
      if (volumes.stdout.split("\n").includes(`${project}_aftershock_data`)) throw new Error("Existing database volume requires its original local password file; refusing to replace credentials.");
      mkdirSync(resolve(root, ".aftershock"), { recursive: true, mode: 0o700 });
      writeFileSync(envFile, `AFTERSHOCK_DB_PASSWORD=${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
    }
    docker(["up", "-d", "--wait", "--wait-timeout", "60"], undefined, 90_000);
    console.log("Aftershock PostgreSQL is healthy at localhost:55439. Credentials are in ignored local configuration.");
  } else if (action === "down") {
    docker(["down"]);
    console.log("Aftershock database stopped. Its development volume was preserved.");
  } else {
    const token = randomUUID(), name = `aftershock_run_${token.replaceAll("-", "")}`;
    // Only this freshly generated identifier can be created/dropped by this command.
    sql("aftershock_control", `CREATE DATABASE ${name};`);
    let owned = false;
    try {
      sql(name, readFileSync(resolve(root, "migrations/001_consumer_state.sql"), "utf8"));
      sql(name, `INSERT INTO aftershock_owner VALUES (TRUE, '${token}', '${name}', 1);`);
      owned = true;
      const result = sql(name, `BEGIN;
INSERT INTO consumer_events VALUES ('event-1','pumpfun','synthetic-signature',ARRAY[1,2],0,'pumpfun-trades-v1',10,'mint-1','buy',9007199254740993,18446744073709551615);
INSERT INTO consumer_checkpoints VALUES ('sample',1,'event-1');
COMMIT;
INSERT INTO consumer_events SELECT * FROM consumer_events ON CONFLICT DO NOTHING;
BEGIN;
UPDATE consumer_events SET sol_lamports=1;
UPDATE consumer_checkpoints SET last_delivery=2;
ROLLBACK;
SELECT COUNT(*)::text || ':' || MIN(sol_lamports)::text || ':' || MIN(token_base_units)::text FROM consumer_events;
SELECT last_delivery::text FROM consumer_checkpoints;
`);
      if (result !== "1:9007199254740993:18446744073709551615\n1") throw new Error("Database invariants did not match.");
      console.log("Database checks passed: migration, exact large integers, unique events, and atomic rollback.");
    } finally {
      if (owned && sql(name, "SELECT ownership_token::text FROM aftershock_owner WHERE singleton;") !== token) throw new Error("Database ownership mismatch; cleanup refused.");
      // If setup failed before the ownership row, this process still owns its freshly created random database.
      sql("aftershock_control", `DROP DATABASE ${name} WITH (FORCE);`);
    }
    console.log("Disposable test database removed; other databases were not targeted.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local database operation failed.");
  process.exitCode = 2;
}
