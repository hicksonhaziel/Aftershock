import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { reduceCase, compareCases } from "../../../packages/runner/src/reduction.js";
import { exportCase, exitCode } from "../../../packages/runner/src/regression.js";
import { AdapterError } from "@aftershock/runner";
const root = resolve(import.meta.dirname, "../../..");
const abort = new AbortController();
const cancel = () => abort.abort();
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "export") {
    if (args.length !== 2) throw new Error();
    console.log(`Export: ${exportCase(resolve(args[0]!), resolve(args[1]!))}`);
  } else if (mode === "reduce") {
    if (!args[0] || args.length > 4) throw new Error();
    const parent = join(root, ".aftershock/reductions"); mkdirSync(parent, { recursive: true, mode: 0o700 });
    const result = await reduceCase(resolve(args[0]), join(parent, randomUUID()), {
      maxAttempts: Number(args[1] ?? 20), maxSeconds: Number(args[2] ?? 900), maxBytes: Number(args[3] ?? 536870912),
    }, abort.signal);
    console.log(`Reduction: ${result.verdict}; ${result.originalInputs} -> ${result.retainedInputs.length} inputs\nMinimality: ${result.minimality}\nCase: ${result.directory}`);
    process.exitCode = exitCode(result.verdict);
  } else if (mode === "compare") {
    if (!args.length || args.length > 4) throw new Error();
    const parent = join(root, ".aftershock/comparisons"); mkdirSync(parent, { recursive: true, mode: 0o700 });
    const output = join(parent, randomUUID());
    const result = await compareCases(args.map(p => resolve(p)), output, 5, abort.signal);
    console.log(`Comparison: ${result.verdict}\nEvidence: ${output}`);
    for (const row of result.cases) console.log(`${row.caseId}: same fault ${row.faultyConfirmed}/${row.repeats}; fixed pass ${row.fixedPassed}/${row.repeats}; case ${row.directory}`);
    process.exitCode = exitCode(result.verdict);
  } else throw new Error();
} catch (error) { console.error("Case operation failed; verify case integrity, supported runtime, arguments and operation limits. Local evidence is retained."); process.exitCode = error instanceof AdapterError ? exitCode(error.verdict) : 2; }
finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
