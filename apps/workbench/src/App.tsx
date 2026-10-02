import { useCallback, useEffect, useState } from "react";
import { api, type Capture, type Case, type Project, type Run } from "./model";
import { CaseDetail, RunDetail } from "./evidence";
import { Campaigns, Captures, Cases, Overview, Runner } from "./views";
import { Empty, Header, Icon, Mark, Panel, RunsTable } from "./ui";
const nav = [{ id: "overview", name: "Overview" }, { id: "captures", name: "Captures" }, { id: "campaigns", name: "Campaigns" }, { id: "incidents", name: "Incidents" }, { id: "cases", name: "Case library" }];
export function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "overview"), [connected, setConnected] = useState(false), [sessionChecked, setSessionChecked] = useState(false), [mode, setMode] = useState("local"), [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[]>([]), [projectId, setProjectId] = useState(localStorage.getItem("aftershock-project") ?? ""), [cases, setCases] = useState<Case[]>([]), [captures, setCaptures] = useState<Capture[]>([]), [runs, setRuns] = useState<Run[]>([]), [capabilities, setCapabilities] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [projectName, setProjectName] = useState(""), [loaded, setLoaded] = useState(false), [dataReady, setDataReady] = useState(false);
  const go = useCallback((next: string) => { location.hash = next; }, []);
  useEffect(() => { const change = () => { setRoute(location.hash.slice(1) || "overview"); window.scrollTo({ top: 0 }); requestAnimationFrame(() => document.getElementById("main")?.focus()); }; window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  useEffect(() => { const controller = new AbortController(); void Promise.all([api("/health", undefined, controller.signal), api("/session", undefined, controller.signal)]).then(([health, session]) => { setMode(health.mode); setConnected(session.connected); setSessionChecked(true); }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setSessionChecked(true); } }); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!connected) return; const controller = new AbortController();
    void Promise.all([api<Project[]>("/projects", undefined, controller.signal), api("/capabilities", undefined, controller.signal)]).then(([all, caps]) => { setProjects(all); setCapabilities(caps); setLoaded(true); if (!all.some(p => p.id === projectId)) setProjectId(all[0]?.id ?? ""); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [connected]);
  useEffect(() => {
    if (!connected || !projectId) return; localStorage.setItem("aftershock-project", projectId);
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => { try {
      const [allCases, allCaptures, allRuns] = await Promise.all([api<Case[]>(`/projects/${projectId}/cases`, undefined, controller.signal), api<Capture[]>(`/projects/${projectId}/captures`, undefined, controller.signal), api<Run[]>(`/projects/${projectId}/runs`, undefined, controller.signal)]);
      setDataReady(true); setCases(allCases); setCaptures(allCaptures); setRuns(allRuns); timer = setTimeout(refresh, allRuns.some(r => ["QUEUED", "RUNNING"].includes(r.state)) ? 2000 : 6000);
    } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); timer = setTimeout(refresh, 4000); } } };
    setDataReady(false); setCases([]); setCaptures([]); setRuns([]); void refresh(); return () => { controller.abort(); clearTimeout(timer); };
  }, [connected, projectId]);
  const submit = async (settings: Record<string, unknown>) => {
    if (busy) return; setBusy(true); setError("");
    try { const job = await api<Run>("/runs", { ...settings, projectId, idempotencyKey: crypto.randomUUID() }); setRuns(previous => [job, ...previous]); go(`run/${job.id}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const pair = async () => { setBusy(true); setError(""); try { await api("/session", mode === "local" ? {} : { token }); setToken(""); setConnected(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const create = async () => { setBusy(true); setError(""); try { const project = await api<Project>("/projects", { name: projectName, adapter: "maintained-trade-ledger-v1" }); setProjects(previous => [...previous, project]); setProjectId(project.id); setProjectName(""); go("overview"); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const project = projects.find(p => p.id === projectId), actions = { go, submit, busy }, page = route.split("/")[0];
  return <div className="app"><a className="skip" href="#main" onClick={e => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a><aside className="sidebar"><a className="brand" href="#overview" aria-label="Aftershock overview"><Mark /><span>aftershock<span className="brand-period">.</span></span></a><div className="workspace-tag">EVIDENCE WORKBENCH <span>04</span></div>
    <label className="project-picker"><span>Project</span><select value={projectId} onChange={e => { setProjectId(e.target.value); go("overview"); }} disabled={!connected || !projects.length}><option value="" disabled>Select project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <nav aria-label="Workbench">{nav.map(n => <a key={n.id} href={`#${n.id}`} className={page === n.id || page === "run" && n.id === "campaigns" || page === "case" && n.id === "cases" ? "selected" : ""}><Icon name={n.id} /><span>{n.name}</span>{n.id === "incidents" && runs.filter(r => r.kind === "campaign" && r.verdict === "FAIL").length > 0 && <span className="nav-count">{runs.filter(r => r.kind === "campaign" && r.verdict === "FAIL").length}</span>}</a>)}</nav>
    <details className="new-project"><summary>+ New project</summary><form onSubmit={e => { e.preventDefault(); void create(); }}><label><span className="sr-only">Project name</span><input placeholder="Project name" maxLength={80} value={projectName} onChange={e => setProjectName(e.target.value)} required /></label><button disabled={!connected || busy}>Create project</button></form></details>
    <div className="sidebar-bottom"><a href="#runner" className={page === "runner" ? "selected" : ""}><Icon name="runner" /> Runner & capabilities</a><div className="runner-state"><span className={connected ? "connected-dot" : "offline-dot"} /><div><strong>{connected ? mode === "local" ? "Local runner" : "Hosted samples" : "Runner disconnected"}</strong><span>{connected ? "Evidence stays on this runner" : "Connect to inspect evidence"}</span></div></div><span className="sidebar-foot">FROM CAPTURE TO VERIFIED FIX</span></div></aside>
    <div className="workspace"><header className="topbar"><div><span className="muted">Aftershock</span><span aria-hidden="true">/</span><strong>{project?.name ?? "Your workspace"}</strong></div><span className="label">{mode === "local" ? "LOCAL WORKSPACE" : "MAINTAINED SAMPLES"}</span></header><main id="main" tabIndex={-1}>{error && <div className="alert" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {!sessionChecked ? <p role="status">Checking the saved runner connection…</p> : !connected ? <div className="connect"><div className="connection-mark"><Mark /></div><Header eyebrow="AFTERSHOCK / START HERE" title="Turn a crash into a test you can keep." description="A workbench for Solana ingestion failures. Follow the input, the write and the recovery—then verify the fix." /><div className="connect-box"><h2>{mode === "local" ? "Connect to this machine’s runner" : "Connect to the maintained sample runner"}</h2><p>{mode === "local" ? "Your recordings, credentials and consumer execution stay local. Connection survives page refresh for this session." : "Use the access token issued by the operator. Only maintained sample code can execute here."}</p>{mode !== "local" && <label>Operator access token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>}<button className="primary" disabled={busy} onClick={() => void pair()}>{busy ? "Connecting…" : "Connect runner"} <Icon name="arrow" /></button></div><div className="connect-notes"><span>✓ Raw source evidence</span><span>✓ Real process failures</span><span>✓ Offline regression cases</span></div></div>
      : !loaded ? <p role="status">Loading your projects…</p> : !project ? <Empty title="Create your first project" text="Give this investigation a name. The maintained trade sample is ready to run."><form className="form" onSubmit={e => { e.preventDefault(); void create(); }}><label>Project name<input value={projectName} maxLength={80} onChange={e => setProjectName(e.target.value)} required /></label><button className="primary" disabled={busy}>Create project</button></form></Empty>
      : !dataReady ? <p role="status">Loading this project’s saved evidence…</p>
      : page === "run" && route.split("/")[1] ? <RunDetail key={route} id={route.split("/")[1]!} runs={runs} {...actions} />
      : page === "case" && route.split("/")[1] ? <CaseDetail key={route} id={route.split("/")[1]!} {...actions} />
      : page === "captures" || page === "capture" ? <Captures key={project.id} initialCapture={route.split("/")[1]} captures={captures} runs={runs} {...actions} />
      : page === "campaigns" ? <Campaigns key={`${project.id}-${cases.length === 0}`} cases={cases} runs={runs} {...actions} />
      : page === "cases" ? <Cases cases={cases} runs={runs} go={go} />
      : page === "incidents" ? <><Header eyebrow="03 / EXPLAIN" title="Failures with a chain of evidence." description="An incident requires a proven assertion failure. Incomplete runs remain visible in their history." /><Panel title="Assertion failures"><RunsTable runs={runs.filter(r => r.kind === "campaign" && r.verdict === "FAIL")} go={go} /></Panel></>
      : page === "runner" ? <Runner capabilities={capabilities} mode={mode} />
      : <Overview project={project} cases={cases} captures={captures} runs={runs} go={go} />}
    <footer className="main-footer"><span>AFTERSHOCK</span><span>Evidence before verdict. Coverage before claims.</span><a href="https://github.com/hicksonhaziel/Aftershock" target="_blank" rel="noreferrer">Source ↗</a></footer></main></div></div>;
}
