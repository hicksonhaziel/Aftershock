import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { localControl, apiToken, registerTrustedCase, repositoryRoot, importSavedCapture } from "@aftershock/control";
import { createCase } from "../../../packages/runner/src/regression.js";
import { readNormalized } from "./campaign.js";

import { workbenchSample, SAMPLE_RAW } from "../../../examples/trade-ledger/workbench-sample.js";

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
  } else if (action === "sample" && args.length === 1) {
    const staging = join(control.storage, `sample-${randomUUID()}`); mkdirSync(staging, { mode: 0o700 });
    try {
      writeFileSync(join(staging, "raw.pb"), SAMPLE_RAW, { mode: 0o600 });
      const directory = join(staging, "case"); createCase(directory, workbenchSample(), staging, join(repositoryRoot, ".aftershock/build"), "maintained-sample", "crash");
      const saved = await registerTrustedCase(control.store, control.storage, args[0]!, directory, join(repositoryRoot, ".aftershock/build"));
      console.log(`Registered SYNTHETIC maintained sample case: ${saved.id}. No provider calls were made.`);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  } else if (action === "capture-import" && args.length === 2) {
    const saved = await importSavedCapture(control.store, control.storage, args[0]!, resolve(args[1]!));
    console.log(`Registered saved recording: ${saved.captureId}. It stays on this runner.`);
  } else throw new Error();
} catch { console.error("Control setup failed; use init, project <name>, sample <project-id>, capture-import <project-id> <capture-directory>, or import <project-id> <normalized-directory> [seed] [duplicate|crash]. Check local database and current build."); process.exitCode = 2; }
finally { await control?.store.pool.end(); }
