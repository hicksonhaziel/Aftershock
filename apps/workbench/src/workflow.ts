import type { Run } from "./model";

export function relatedCaseRuns(runs: Run[], caseId: string | null | undefined): Run[] {
  if (!caseId) return [];
  const ids = new Set([caseId]);
  // Reductions can be nested. Follow the case IDs, never timestamps or signatures.
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      const derived = run.result?.caseId;
      if (run.caseId && ids.has(run.caseId) && ["reduce", "compare"].includes(run.kind) && derived && !ids.has(derived)) {
        ids.add(derived);
        changed = true;
      }
    }
  }
  return runs.filter(run => run.caseId && ids.has(run.caseId) && ["reduce", "compare", "export"].includes(run.kind)).sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

export function latestCaseOutcome(runs: Run[], caseId: string, variant: string) {
  const latest = runs.filter(run => run.caseId === caseId && ((run.kind === "campaign" && run.variant === variant) || (run.kind === "compare" && run.result?.comparison)))
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))[0];
  if (!latest) return null;
  // A workbench comparison runs one registered case. Its locked case ID differs
  // from the registry ID used by jobs and navigation.
  const pair = latest.result?.comparison?.cases?.[0];
  if (!pair || latest.kind !== "compare") return { run: latest, verdict: latest.verdict ?? latest.state, detail: "" };
  const count = variant === "faulty" ? pair.faultyConfirmed : pair.fixedPassed;
  return {
    run: latest,
    verdict: variant === "faulty" ? count === pair.repeats ? "FAIL" : "INCONCLUSIVE" : count === pair.repeats ? "PASS" : pair.verdict,
    detail: `${count}/${pair.repeats} ${variant === "faulty" ? "reproduced" : "passed"}`,
  };
}

export function sourceName(source: string | undefined) {
  return source === "saved-mainnet-replay" ? "Mainnet replay" : source === "live-mainnet" ? "Live mainnet" : source === "synthetic" ? "Synthetic fixture" : source ?? "Awaiting evidence";
}
