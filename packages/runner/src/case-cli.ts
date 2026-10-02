import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { AdapterError } from "./index.js";
import { executeCase, loadCase, failureFields, failureFingerprint, exitCode, digest } from "./regression.js";
async function main() {
  const [mode, path, variant = "fixed"] = process.argv.slice(2);
  if (!["test", "reproduce", "baseline"].includes(mode ?? "") || !path || !["faulty", "fixed"].includes(variant) || process.argv.length > 5) throw new Error();
  const directory = resolve(path), loaded = loadCase(directory);
  // The invoked runner must be the exact implementation pinned by this case.
  if (digest(readFileSync(process.argv[1]!)) !== loaded.files.get("regression.mjs")!.sha256) throw new Error();
  const result = await executeCase(directory, variant as "faulty" | "fixed", mode !== "baseline");
  let verdict = result.verdict;
  if (mode === "reproduce" && ["PASS", "FAIL"].includes(verdict)) {
    verdict = result.verdict === "FAIL" && loaded.spec.expectedFailure.length > 0
      && result.appliedFaults.every(f => f.status === "applied")
      && isDeepStrictEqual(failureFields(result.discrepancies), loaded.spec.expectedFailure)
      && (!loaded.spec.failureFingerprint || failureFingerprint(loaded.spec, loaded.input.projectionVersion, result.discrepancies) === loaded.spec.failureFingerprint) ? "PASS" : "FAIL";
  }
  console.log(`${mode}: ${verdict}; consumer: ${result.verdict}; variant: ${variant}\nEvidence: ${result.output}`);
  process.exitCode = exitCode(verdict);
}
if (process.env.AFTERSHOCK_OFFLINE_INNER === "1") {
  main().catch(error => { console.error("Regression setup failed: verify case integrity, pinned runtime and offline dependencies."); process.exitCode = error instanceof AdapterError ? exitCode(error.verdict) : 2; });
} else {
  // The exported command disables networking for both runner and consumer, not only the adapter.
  const child = spawn("/usr/bin/unshare", ["--user", "--map-root-user", "--net", process.execPath, ...process.argv.slice(1)], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", AFTERSHOCK_OFFLINE_INNER: "1" }, stdio: "inherit",
  });
  const cancel = () => child.kill("SIGTERM");
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  const deadline = setTimeout(cancel, 180000);
  child.on("error", () => { console.error("Offline namespace startup failed."); process.exitCode = 2; });
  child.on("close", code => { clearTimeout(deadline); process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); process.exitCode = code ?? 3; });
}
