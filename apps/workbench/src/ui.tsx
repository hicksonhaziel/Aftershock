import type { ReactNode } from "react";
import { short, stamp, type Run } from "./model";
export function Mark() { return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M2 19h8l4-12 5 23 5-14 3 3h7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></svg>; }
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    captures: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    campaigns: <><path d="m8 3 12 9-12 9Z" /></>,
    incidents: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3h.01" /></>,
    cases: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 5V3h8v2M3 11h18m-12 5h6" /></>,
    runner: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8m-4-4v4M7 9l3 3-3 3m6 0h4" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.arrow}</svg>;
}
export function Status({ value }: { value: string | null }) {
  const text = value ?? "PENDING", symbol = ["PASS", "COMPLETED", "SUPPORTED"].includes(text) ? "✓" : text === "FAIL" ? "×" : ["RUNNING", "QUEUED"].includes(text) ? "◷" : "!";
  return <span className={`status ${text.toLowerCase()}`}><span aria-hidden="true">{symbol}</span> {text.replaceAll("_", " ")}</span>;
}
export function Header({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: ReactNode }) {
  return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="head-actions">{children}</div>}</div>;
}
export function Panel({ title, caption, children, action, className = "" }: { title: string; caption?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</div>{children}</section>;
}
export function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><Mark /><h3>{title}</h3><p>{text}</p>{children}</div>;
}
export function RunsTable({ runs, go }: { runs: Run[]; go: (route: string) => void }) {
  if (!runs.length) return <Empty title="No runs yet" text="Choose a case and a fault scenario to start your first isolated run." />;
  return <div className="table-wrap"><table><thead><tr><th scope="col">Run</th><th scope="col">Operation</th><th scope="col">Consumer</th><th scope="col">Result</th><th scope="col">Started</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td><button className="text-button mono" onClick={() => go(`run/${r.id}`)}>{short(r.id)} <span aria-hidden="true">↗</span></button></td><td className="capitalize">{r.kind ?? "campaign"}</td><td>{r.variant ?? "—"}</td><td><Status value={r.verdict ?? r.state} /></td><td className="muted">{stamp(r.createdAtUtc)}</td></tr>)}</tbody></table></div>;
}
export function JsonView({ value }: { value: unknown }) { return <pre className="json">{JSON.stringify(value, null, 2)}</pre>; }
