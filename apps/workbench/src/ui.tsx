import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Box, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDashed, Clock3, Copy, Database, FileCode2, FlaskConical, FolderOpen, Layers, LayoutGrid, LoaderCircle, Menu, Monitor, Moon, Sun, Plus, Radio, Search, Settings2, ShieldCheck, SlidersHorizontal, Square, Terminal, TriangleAlert, Unplug, X, Zap, type LucideIcon } from "lucide-react";
import { short, stamp, type Run } from "./model";
const icons: Record<string, LucideIcon> = { moon: Moon, sun: Sun, overview: LayoutGrid, captures: Radio, campaigns: FlaskConical, incidents: CircleAlert, cases: Layers, runner: Terminal, arrow: ArrowRight, back: ArrowLeft, external: ArrowUpRight, search: Search, plus: Plus, close: X, menu: Menu, chevron: ChevronDown, left: ChevronLeft, right: ChevronRight, check: Check, verified: ShieldCheck, copy: Copy, copied: CheckCheck, download: ArrowDownToLine, down: ArrowDown, folder: FolderOpen, database: Database, clock: Clock3, settings: Settings2, filter: SlidersHorizontal, source: FileCode2, box: Box, monitor: Monitor, docs: BookOpen, crash: Zap, disconnected: Unplug, stop: Square };
export function Mark() { return <img src={`${import.meta.env.BASE_URL}aftershock-mark.svg`} className="brand-mark" width="32" height="32" alt="" aria-hidden="true" />; }
export function Icon({ name }: { name: string }) { const Component = icons[name] ?? ArrowRight; return <Component size={18} strokeWidth={1.65} aria-hidden="true" />; }
export function Status({ value }: { value: string | null }) {
  const text = value ?? "PENDING";
  const Symbol = ["PASS", "COMPLETED", "SUPPORTED"].includes(text) ? CircleCheck : text === "FAIL" ? CircleAlert : text === "RUNNING" ? LoaderCircle : text === "QUEUED" ? Clock3 : text === "CANCELLED" ? CircleDashed : ["INCONCLUSIVE", "RUNNER_ERROR"].includes(text) ? TriangleAlert : Circle;
  return <span className={`status ${text.toLowerCase().replaceAll(" ", "-")}`}><Symbol size={13} strokeWidth={1.8} aria-hidden="true" />{text.replaceAll("_", " ")}</span>;
}
export function Header({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="head-actions">{children}</div>}</div>;
}
export function Panel({ title, caption, children, action, className = "" }: { title: string; caption?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</div>{children}</section>;
}
export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name="folder" /></div><h3>{title}</h3><p>{text}</p>{children}</div>;
}
export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spinner" size={20} aria-hidden="true" /><span>{text}</span><div className="skeleton-lines" aria-hidden="true"><i /><i /><i /></div></div>;
}
export function CopyButton({ value, label = "Copy ID" }: { value: string; label?: string }) {
  const [state, setState] = useState("");
  useEffect(() => { setState(""); }, [value]);
  useEffect(() => { if (!state) return; const timer = setTimeout(() => setState(""), 2000); return () => clearTimeout(timer); }, [state]);
  return <button className="icon-button copy-button" aria-label={state || label} title={state || label} onClick={async () => { try { await navigator.clipboard.writeText(value); setState("Copied"); } catch { setState("Copy unavailable"); } }}><Icon name={state === "Copied" ? "copied" : "copy"} /><span className="sr-only" role="status">{state}</span></button>;
}
export function RunsTable({ runs, go, searchable = false, emptyTitle = "No runs yet", emptyText = "Choose a saved case to run a campaign." }: { runs: Run[]; go: (route: string) => void; searchable?: boolean; emptyTitle?: string; emptyText?: string }) {
  const [query, setQuery] = useState(""), [verdict, setVerdict] = useState("all"), [page, setPage] = useState(0);
  const filtered = runs.filter(r => `${r.id} ${r.kind} ${r.variant ?? ""} ${r.verdict ?? r.state}`.toLowerCase().includes(query.toLowerCase()) && (verdict === "all" || (verdict === "active" ? ["RUNNING", "QUEUED"].includes(r.state) : r.verdict === verdict)));
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), current = Math.min(page, pages - 1), visible = filtered.slice(current * 10, current * 10 + 10);
  if (!runs.length) return <Empty title={emptyTitle} text={emptyText} />;
  return <>{searchable && <div className="table-tools"><label className="search"><Icon name="search" /><span className="sr-only">Search runs</span><input placeholder="Search runs…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><label className="filter-select"><Icon name="filter" /><span className="sr-only">Filter runs</span><select value={verdict} onChange={e => { setVerdict(e.target.value); setPage(0); }}><option value="all">All results</option><option value="FAIL">Failed</option><option value="PASS">Passed</option><option value="INCONCLUSIVE">Inconclusive</option><option value="UNSUPPORTED">Unsupported</option><option value="active">In progress</option><option value="RUNNER_ERROR">Runner error</option><option value="CANCELLED">Cancelled</option></select></label></div>}
    {visible.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Run</th><th scope="col">Operation</th><th scope="col">Consumer</th><th scope="col">Result</th><th scope="col">Started</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{visible.map(r => <tr key={r.id}><td><a className="row-link mono" href={`#run/${r.id}`}>{short(r.id)}</a></td><td><span className="operation"><Icon name={r.kind === "campaign" ? "campaigns" : r.kind === "capture" ? "captures" : r.kind === "export" ? "download" : r.kind === "compare" ? "verified" : "cases"} />{operationName(r.kind)}</span></td><td><span className="consumer-tag">{r.variant ?? "—"}</span></td><td><Status value={r.verdict ?? r.state} /></td><td className="muted time-cell">{stamp(r.createdAtUtc)}</td><td><button className="icon-button row-open" onClick={() => go(`run/${r.id}`)} aria-label={`Open run ${short(r.id)}`}><Icon name="external" /></button></td></tr>)}</tbody></table></div> : <Empty title="No matching runs" text="Try a different search or result filter." />}
    {(searchable || pages > 1) && <div className="table-bottom"><span>{filtered.length ? `${current * 10 + 1}–${Math.min((current + 1) * 10, filtered.length)} of ${filtered.length} runs` : "0 runs"}</span><div><button className="icon-button" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}><Icon name="left" /></button><button className="icon-button" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><Icon name="right" /></button></div></div>}</>;
}
export function operationName(kind: string) { return ({ campaign: "Campaign", capture: "Capture", reference: "Reference check", normalize: "Prepare trades", scenario: "Scenario", reduce: "Reduction", compare: "Fix comparison", export: "Export" } as Record<string, string>)[kind] ?? kind; }
export function JsonView({ value }: { value: unknown }) { return <pre className="json">{JSON.stringify(value, null, 2)}</pre>; }

export function Tabs({ id, value, choose, options }: { id: string; value: string; choose: (value: string) => void; options: { id: string; label: string }[] }) {
  return <div className="detail-tabs" role="tablist" aria-label="Run sections">{options.map((option, index) => <button key={option.id} role="tab" id={`${id}-${option.id}-tab`} aria-controls={`${id}-${option.id}-panel`} aria-selected={value === option.id} tabIndex={value === option.id ? 0 : -1} onClick={() => choose(option.id)} onKeyDown={e => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    choose(options[next].id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }}>{option.label}</button>)}</div>;
}
