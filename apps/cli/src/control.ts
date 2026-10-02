import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { localControl, apiToken, registerTrustedCase, repositoryRoot } from "@aftershock/control";
import { createCase } from "../../../packages/runner/src/regression.js";
import { readNormalized } from "./campaign.js";

let control: ReturnType<typeof localControl> | undefined;
try {
  control = localControl(); await control.store.migrate(); apiToken(control.storage);
  const [action, ...args] = process.argv.slice(2);
  if (action === "init" && !args.length) console.log("Persistent control tables and private API token are ready.");
  else if (action === "project" && args.length === 1) {
    const project = await control.store.createProject({ name: args[0], adapter: "maintained-trade-ledger-v1" });
    console.log(`Project ID: ${project.id}`);
  } else if (action === "import" && args.length >= 2 && args.length <= 4) {
    const [projectId, normalized, seed = "workbench", mode = "crash"] = args;
    if (!/^[a-f0-9-]{36}$/.test(projectId!) || !["duplicate", "crash"].includes(mode)) throw new Error();
    const staging = join(control.storage, `import-${randomUUID()}`); mkdirSync(staging, { mode: 0o700 });
    try {
      const directory = join(staging, "case");
      createCase(directory, readNormalized(resolve(normalized!)), resolve(normalized!), join(repositoryRoot, ".aftershock/build"), seed, mode as "duplicate" | "crash");
      const saved = await registerTrustedCase(control.store, control.storage, projectId!, directory, join(repositoryRoot, ".aftershock/build"));
      console.log(`Registered saved-mainnet case ID: ${saved.id}. The recording remains local.`);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  } else throw new Error();
} catch { console.error("Control setup failed; use init, project <name>, or import <project-id> <normalized-directory> [seed] [duplicate|crash]. Check local database and current build."); process.exitCode = 2; }
finally { await control?.store.pool.end(); }
