import { spawnSync } from "node:child_process";
export const POSTGRES_IMAGE = "postgres:15-alpine@sha256:1c52f5ad23db5d7648a63634444af76de48e63b860fccbe3e3a5458b2812eaed";
export const sqlString = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function docker(args: string[], input?: string, timeout = 10000) {
  const result = spawnSync("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", ...args], {
    env: { PATH: "/usr/bin:/bin", LANG: "C" }, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error || result.status !== 0) throw new Error("Owned PostgreSQL operation failed; check the local Docker daemon and cached image.");
  return result.stdout.trim();
}
export function sql(container: string, query: string) {
  if (!/^aftershock-case-[a-f0-9]{32}$/.test(container)) throw new Error("Invalid owned container.");
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-U", "aftershock", "-d", "aftershock_run", "-v", "ON_ERROR_STOP=1"], "SET statement_timeout='5s';\n" + query);
}
export function verifyContainer(container: string, token: string) {
  const observed = docker(["inspect", "--format", '{{index .Config.Labels "dev.aftershock.token"}}:{{.HostConfig.NetworkMode}}', container]);
  if (observed !== `${token}:none`) throw new Error("Container ownership or network mismatch.");
}
export async function createDatabase(token: string, runId: string, migration: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid ownership token.");
  const container = `aftershock-case-${token.replaceAll("-", "")}`;
  docker(["image", "inspect", POSTGRES_IMAGE]); // Never pull or use a mutable tag during a run.
  try {
    docker(["run", "--detach", "--pull", "never", "--name", container, "--network", "none", "--read-only",
    "--memory", "256m", "--cpus", "1", "--pids-limit", "128",
    "--tmpfs", "/var/lib/postgresql/data:rw,size=134217728", "--tmpfs", "/var/run/postgresql:rw,size=16777216", "--tmpfs", "/tmp:rw,size=16777216",
    "--label", `dev.aftershock.token=${token}`, "--env", "POSTGRES_USER=aftershock", "--env", "POSTGRES_DB=aftershock_run",
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", POSTGRES_IMAGE], undefined, 20000);
    verifyContainer(container, token);
    const deadline = Date.now() + 30000;
    for (;;) {
      try { docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "aftershock", "-d", "aftershock_run"]); if (sql(container, "SELECT 1;") === "1") break; } catch { /* Initialization is bounded below. */ }
      if (Date.now() >= deadline) throw new Error("Owned database initialization timed out.");
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    sql(container, migration);
    sql(container, `INSERT INTO aftershock_owner VALUES (TRUE, ${sqlString(token)}, ${sqlString(runId)}, 1);`);
    return container;
  } catch (error) {
    const names = docker(["ps", "--all", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]);
    if (names.split("\n").includes(container)) removeDatabase(container, token);
    throw error;
  }
}
export function removeDatabase(container: string, token: string) {
  verifyContainer(container, token);
  docker(["rm", "--force", container]);
}
