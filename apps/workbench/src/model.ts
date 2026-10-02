export type Project = { id: string; name: string; adapter: string };
export type Provenance = { sourceMode: string; capture: { captureId: string; manifest: { sha256: string } } | null; coverage: { status: string; scope: string; startSlot: string; endSlot: string; exclusions: string[] }; inputs: number; events: number; scenario: any; assertion: any };
export type Case = { id: string; lockSha256: string; provenance: Provenance };
export type Capture = { id: string; manifestSha256: string; summary: any; reference: any };
export type Run = { id: string; projectId: string; caseId: string | null; kind: string; variant: string | null; state: string; verdict: string | null; attempt: number; cancelRequested: boolean; createdAtUtc: string; result: any; maxSeconds: number };
export const base = import.meta.env.DEV ? "/api" : "";
export async function api<T = any>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(base + path, { credentials: "same-origin", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "The runner could not complete this request."); return value;
}
export const short = (id: string | null | undefined) => id ? id.slice(0, 8) : "—";
export const stamp = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
export const presets = [
  { id: "crash", name: "Crash after commit", text: "Kill the process after the trade is saved. Restart with an overlapping input.", expectation: "The saved totals must count each business event once." },
  { id: "duplicate", name: "Duplicate delivery", text: "Deliver one anchored transaction twice.", expectation: "A repeated delivery must leave the expected totals unchanged." },
  { id: "disconnect", name: "Disconnect & overlap", text: "Reconnect with one input of overlap.", expectation: "Recovery must preserve the declared final state." },
  { id: "temporary-omission", name: "Recover a missing input", text: "Temporarily hold one transaction, then recover it.", expectation: "All declared inputs must contribute once after recovery." },
  { id: "permanent-omission", name: "Unrecovered input", text: "Keep one input absent and make the unresolved boundary visible.", expectation: "Incomplete recovery must be INCONCLUSIVE." },
];
export function scenarioName(c: Case) { const fault = c.provenance.scenario?.faults?.[0]; return fault?.kind === "crash" ? "Crash after commit" : fault?.kind?.replaceAll("-", " ") ?? "Declared scenario"; }
