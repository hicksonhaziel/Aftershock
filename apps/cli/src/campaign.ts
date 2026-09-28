import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { projectedTradeSchema, sourceTransactionSchema, regressionInputSchema, captureManifestSchema } from "@aftershock/contracts";
import { createCase, executeCase, sealFailure, exportCase, writeArtifact, digest } from "../../../packages/runner/src/regression.js";
import { readArtifact, AdapterError } from "@aftershock/runner";
import { inspectReference } from "../../../packages/runner/src/reference-evidence.js";
import { compareTradeState } from "@aftershock/projection";
const root = resolve(import.meta.dirname, "../../..");
export function readNormalized(directory: string) {
  const bytes = readFileSync(join(directory, "normalization.json"));
  if (bytes.length > 1024 * 1024 || digest(bytes) !== readFileSync(join(directory, "normalization.sha256"), "utf8").trim()) throw new Error("Normalization integrity failed.");
  const report = JSON.parse(bytes.toString());
  if (report.schemaVersion !== 1 || report.source !== "live-derived" || !Array.isArray(report.artifacts) || !Array.isArray(report.sources) || !Array.isArray(report.exclusions)) throw new Error("Invalid normalization.");
  for (const artifact of report.artifacts) readArtifact(directory, artifact);
  const events = JSON.parse(readArtifact(directory, report.artifacts.find((r: { path: string }) => r.path === "events.json")).toString()).map((v: unknown) => projectedTradeSchema.parse(v));
  const sources = report.sources.map((v: unknown) => sourceTransactionSchema.parse(v));
  if (new Set(sources.map((s: ReturnType<typeof sourceTransactionSchema.parse>) => s.signature)).size !== sources.length || events.some((e: ReturnType<typeof projectedTradeSchema.parse>) => !sources.some((s: ReturnType<typeof sourceTransactionSchema.parse>) => s.signature === e.identity.signature))) throw new Error("Ambiguous or unlinked normalized event.");
  if (events.length !== report.eventCount) throw new Error("Event count mismatch.");
  const parent = { path: "capture-manifest.json", sha256: report.parentManifestSha256 };
  const capture = captureManifestSchema.parse(JSON.parse(readArtifact(directory, parent).toString()));
  const slots = capture.frames.flatMap(f => f.slot ? [BigInt(f.slot)] : []).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return regressionInputSchema.parse({ schemaVersion: 1, projectionVersion: report.projectionVersion, source: "live-derived",
    parent: { captureId: report.parentCaptureId, manifest: parent },
    evidence: [{ path: "normalization.json", sha256: digest(bytes) }, report.artifacts.find((r: { path: string }) => r.path === "events.json")],
    coverage: { status: "not-assessed", scope: "Selected legacy/v0 recorded Pump.fun trades; no full-chain completeness claim",
      startSlot: String(slots[0]), endSlot: String(slots.at(-1)), missingSlots: [],
      exclusions: report.exclusions.map((e: { sourceSequence: number; reason: string }) => `source-${e.sourceSequence}:${e.reason}`) },
    deliveries: sources.map((s: ReturnType<typeof sourceTransactionSchema.parse>) => ({ inputId: s.deliveryId, raw: { path: `raw/${s.sourceSequence}.pb`, sha256: s.rawSha256 },
      sourceSequence: String(s.sourceSequence), slot: s.slot, signature: s.signature,
      events: events.filter((e: ReturnType<typeof projectedTradeSchema.parse>) => e.identity.signature === s.signature) })) });
}
export async function campaign(normalized: string, seed = "phase1", mode: "duplicate" | "crash" = "duplicate", referenceDirectory?: string) {
  const input = readNormalized(normalized), campaignRoot = join(root, ".aftershock", "campaigns", randomUUID());
  mkdirSync(campaignRoot, { recursive: true, mode: 0o700 });
  const reference = referenceDirectory && input.parent
    ? await inspectReference(referenceDirectory, JSON.parse(readArtifact(normalized, input.parent.manifest).toString()), input.parent.manifest.sha256)
    : { checkType: "reference", verdict: "INCONCLUSIVE", coverage: "not-assessed", scope: "No finalized reference supplied; does not block saved-input application checks" };
  writeArtifact(campaignRoot, "reference-lane.json", reference);
  const directory = join(campaignRoot, "case");
  createCase(directory, input, normalized, join(root, ".aftershock/build"), seed, mode);
  const baseline = await executeCase(directory, "faulty", false);
  if (baseline.verdict !== "PASS") { writeArtifact(campaignRoot, "campaign.json", { stage: "baseline", verdict: baseline.verdict, baseline }); return { campaignRoot, verdict: baseline.verdict }; }
  const faulty = await executeCase(directory, "faulty");
  if (faulty.verdict !== "FAIL" || faulty.appliedFaults.some(f => f.status !== "applied")) {
    const verdict = ["RUNNER_ERROR", "UNSUPPORTED", "CANCELLED"].includes(faulty.verdict) ? faulty.verdict : "INCONCLUSIVE";
    writeArtifact(campaignRoot, "campaign.json", { stage: "duplicate", verdict, baseline, faulty });
    return { campaignRoot, verdict };
  }
  sealFailure(directory, faulty.discrepancies);
  const fixedBaseline = await executeCase(directory, "fixed", false);
  if (fixedBaseline.verdict !== "PASS") {
    writeArtifact(campaignRoot, "campaign.json", { stage: "fixed-baseline", verdict: fixedBaseline.verdict, baseline, faulty, fixedBaseline });
    return { campaignRoot, verdict: fixedBaseline.verdict };
  }
  const fixed = await executeCase(directory, "fixed");
  const verdict = fixedBaseline.verdict === "PASS" && fixed.verdict === "PASS" ? "PASS" : fixed.verdict === "PASS" ? fixedBaseline.verdict : fixed.verdict;
  let exported: string | null = null;
  if (verdict === "PASS") exported = exportCase(directory, join(campaignRoot, "export"));
  const state = (run: { output: string }) => {
    const snapshot = JSON.parse(readFileSync(join(run.output, "snapshot.json"), "utf8"));
    return JSON.parse(readArtifact(run.output, snapshot.state).toString());
  };
  const metamorphic = [ [baseline, faulty], [fixedBaseline, fixed] ].map(([clean, changed]) => ({
    checkType: "metamorphic", variant: changed!.variant, cleanRunId: clean!.runId, faultedRunId: changed!.runId,
    ...(["PASS", "FAIL"].includes(changed!.verdict) && existsSync(join(changed!.output, "snapshot.json"))
      ? compareTradeState(state(clean!).events, state(changed!))
      : { verdict: changed!.verdict, summary: "Faulted execution did not establish a complete comparison." }) }));
  writeArtifact(campaignRoot, "checking-lanes.json", { reference, metamorphic,
    application: [baseline, faulty, fixedBaseline, fixed].map(r => ({ checkType: "application", runId: r.runId, variant: r.variant, faulted: r.faulted, verdict: r.verdict })) });
  writeArtifact(campaignRoot, "campaign.json", { schemaVersion: 1, stage: "comparison", verdict, reference, metamorphic,
    meaning: "Intentional sample defect detected and fixed sample passed; not an external consumer defect", baseline, faulty, fixedBaseline, fixed, exported });
  return { campaignRoot, verdict, exported };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2] || process.argv.length > 6) throw new Error();
    if (process.argv[4] && !["duplicate", "crash"].includes(process.argv[4])) throw new Error();
    const result = await campaign(resolve(process.argv[2]), process.argv[3] ?? "phase1", process.argv[4] as "duplicate" | "crash" | undefined, process.argv[5] ? resolve(process.argv[5]) : undefined);
    console.log(`Campaign: ${result.verdict}\nEvidence: ${result.campaignRoot}\nExport: ${result.exported ?? "not-created"}`);
    process.exitCode = result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : result.verdict === "RUNNER_ERROR" ? 2 : 3;
  } catch (error) { console.error("Campaign setup failed; verify normalized capture, build artifacts and local offline dependencies."); process.exitCode = error instanceof AdapterError ? 3 : 2; }
}
