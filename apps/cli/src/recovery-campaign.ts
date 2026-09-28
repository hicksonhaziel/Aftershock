import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readNormalized, campaign } from "./campaign.js";
import { createCase, executeCase, writeArtifact } from "../../../packages/runner/src/regression.js";
const root = resolve(import.meta.dirname, "../../..");
try {
  if (!process.argv[2] || process.argv[4]) throw new Error();
  const normalized = resolve(process.argv[2]);
  const flagship = await campaign(normalized, "phase2", "crash", process.argv[3] ? resolve(process.argv[3]) : undefined);
  if (flagship.verdict !== "PASS") { console.log(`Crash comparison: ${flagship.verdict}\nEvidence: ${flagship.campaignRoot}`); process.exitCode = 2; }
  else {
    const output = join(root, ".aftershock/recovery", randomUUID()); mkdirSync(output, { recursive: true, mode: 0o700 });
    const input = readNormalized(normalized), outcomes = [];
    for (const mode of ["disconnect", "temporary-omission", "permanent-omission"] as const) {
      const directory = join(output, mode); createCase(directory, input, normalized, join(root, ".aftershock/build"), "phase2", mode);
      const result = await executeCase(directory, "fixed"); outcomes.push({ mode, result });
      console.log(`${mode}: ${result.verdict}`);
    }
    const accepted = outcomes.every(o => o.result.verdict === (o.mode === "permanent-omission" ? "INCONCLUSIVE" : "PASS") && o.result.appliedFaults.every(f => f.status === "applied"));
    writeArtifact(output, "recovery-campaign.json", { schemaVersion: 1, verdict: accepted ? "PASS" : "INCONCLUSIVE",
      meaning: "Declared recovery checks completed; permanently withheld input remains explicitly inconclusive", flagship, outcomes });
    console.log(`Recovery acceptance: ${accepted ? "PASS" : "INCONCLUSIVE"}\nEvidence: ${output}\nFlagship: ${flagship.campaignRoot}`);
    process.exitCode = accepted ? 0 : 3;
  }
} catch { console.error("Recovery campaign could not complete; verify normalized input, recorded reference and offline dependencies."); process.exitCode = 2; }
