"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck, FileCheck2, FileText, FolderOpen, GraduationCap, Layers3, LayoutDashboard, LoaderCircle, LockKeyhole, LogOut, Menu, MessageSquareText, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X } from "lucide-react";
import type { AssessmentDTO, DashboardDTO, UserDTO } from "@/lib/types";
import { api, displayStatus, initials, shortDate, shortTime, View, viewLabels } from "./api";
import { Alert, Badge, Empty, Loading, ModePill } from "./ui";
import NewAssessment from "./new-assessment";
import Workspace from "./workspace";
import ReviewDesk from "./review-desk";
import Reports from "./reports";
import LearnerView from "./learner-view";

type Me = { user: UserDTO; liveConfigured: boolean; demoAuth: boolean };
type Modal = "settings" | "delete" | null;

const navigation = [
  { view: "dashboard" as View, label: "Dashboard", icon: LayoutDashboard },
  { view: "classes" as View, label: "My classes", icon: Users },
  { view: "workspace" as View, label: "Agent workspace", icon: WandSparkles },
  { view: "review" as View, label: "Review desk", icon: ClipboardCheck },
  { view: "reports" as View, label: "Reports & gradebook", icon: FileText },
];

export default function TeachMateApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<AssessmentDTO | null>(null);
  const [fetchingAssessment, setFetchingAssessment] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);

  const loadDashboard = useCallback(async () => {
    const data = await api<DashboardDTO>("/api/dashboard");
    setDashboard(data);
    return data;
  }, []);

  const loadAssessment = useCallback(async (id: string) => {
    const data = await api<AssessmentDTO>(`/api/assessments/${encodeURIComponent(id)}`);
    setAssessment(data);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    const jobs: Promise<unknown>[] = [loadDashboard()];
    if (assessmentId) jobs.push(loadAssessment(assessmentId));
    await Promise.all(jobs);
  }, [assessmentId, loadDashboard, loadAssessment]);

  useEffect(() => {
    api<Me>("/api/me").then(async (data) => {
      setMe(data);
      if (data.user.role === "teacher") await loadDashboard();
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get("view") as View;
      if (requestedView && Object.hasOwn(viewLabels, requestedView)) setView(requestedView);
      if (params.get("assessment")) setAssessmentId(params.get("assessment"));
    }).catch(() => setMe(null)).finally(() => setInitializing(false));
  }, [loadDashboard]);

  useEffect(() => {
    if (!me || me.user.role !== "teacher" || !assessmentId) { setAssessment(null); return; }
    let active = true;
    setFetchingAssessment(true);
    api<AssessmentDTO>(`/api/assessments/${encodeURIComponent(assessmentId)}`).then((data) => { if (active) setAssessment(data); }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setFetchingAssessment(false); });
    return () => { active = false; };
  }, [assessmentId, me]);

  useEffect(() => {
    if (!me || me.user.role !== "teacher") return;
    const running = assessment?.runs.some((run) => ["queued", "running"].includes(run.status)) || dashboard?.assessments.some((item) => item.runs.some((run) => ["queued", "running"].includes(run.status)));
    if (!running && view !== "workspace") return;
    const timer = setInterval(() => { refresh().catch((reason: Error) => setError(reason.message)); }, 2000);
    return () => clearInterval(timer);
  }, [assessment, dashboard, me, refresh, view]);

  const navigate = useCallback((nextView: View, id?: string) => {
    setView(nextView);
    setError("");
    setMobileOpen(false);
    let selected = id || assessmentId;
    if (["workspace", "review", "reports"].includes(nextView) && !selected) selected = dashboard?.assessments[0]?.id || null;
    if (selected) setAssessmentId(selected);
    const params = new URLSearchParams({ view: nextView });
    if (selected && ["workspace", "review", "reports"].includes(nextView)) params.set("assessment", selected);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [assessmentId, dashboard]);

  const signedIn = async () => {
    const data = await api<Me>("/api/me");
    setMe(data);
    setView("dashboard");
    setError("");
    if (data.user.role === "teacher") await loadDashboard();
  };

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setMe(null); setDashboard(null); setAssessment(null); setAssessmentId(null); setView("dashboard");
      window.history.replaceState({}, "", "/");
    } catch (reason) { setError((reason as Error).message); }
  };

  const createDemo = async () => {
    setBusy(true); setError("");
    try { const item = await api<AssessmentDTO>("/api/assessments/demo", { method: "POST" }); await loadDashboard(); setAssessment(item); navigate("workspace", item.id); notify("Demo materials added. Start the run when you’re ready."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const removeAssessment = async () => {
    if (!assessmentId) return;
    setBusy(true);
    try { await api(`/api/assessments/${assessmentId}`, { method: "DELETE" }); setAssessmentId(null); setAssessment(null); await loadDashboard(); setModal(null); navigate("dashboard"); notify("Assessment, files and generated outputs deleted."); }
    catch (reason) { setError((reason as Error).message); setModal(null); }
    finally { setBusy(false); }
  };

  if (initializing) return <Loading />;
  if (!me) return <Login onSignedIn={signedIn} />;
  if (me.user.role === "learner") return <LearnerView user={me.user} onSignOut={signOut} />;

  const awaiting = dashboard?.assessments.reduce((sum, item) => sum + item.submissions.filter((submission) => submission.result && ["draft", "needs_review", "revision_requested"].includes(submission.result.status)).length, 0) || 0;
  const currentMode = ["workspace", "review", "reports"].includes(view) && assessment ? assessment.mode : "demo";

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
      <button className="brand" onClick={() => navigate("dashboard")} style={{ border: 0, background: "transparent", textAlign: "left" }} aria-label="TeachMate dashboard"><span className="brand-mark"><BookOpen size={23} strokeWidth={1.7} /></span>TeachMate<span className="pink" style={{ marginLeft: -7 }}>.</span></button>
      <div className="brand-tag">Your teaching colleague</div>
      <div className="nav-label">Workspace</div>
      <nav className="nav-list" aria-label="Main navigation">{navigation.map(({ view: target, label, icon: Icon }) => <button className={`nav-link ${view === target ? "active" : ""}`} key={target} onClick={() => navigate(target)} aria-current={view === target ? "page" : undefined}><Icon size={17} strokeWidth={1.7} />{label}{target === "review" && awaiting > 0 && <span className="nav-count">{awaiting}</span>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <button className="nav-link" onClick={() => setModal("settings")}><Settings2 size={17} strokeWidth={1.7} />Workspace settings</button>
      <div className="sidebar-note"><div className="note-title"><ShieldCheck size={15} />You’re always in control.</div>TeachMate suggests. You review, approve and decide what learners see.</div>
      <div className="sidebar-user"><span className="avatar">{initials(me.user.name)}</span><div><strong>{me.user.name}</strong><small>Teacher workspace</small></div><button className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button><span className="crumb-home">Workspace</span><ChevronRight size={12} className="crumb-home" /><span>{viewLabels[view]}</span></div><div className="topbar-right"><span className="today">{new Date().toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" })}</span><ModePill mode={currentMode} /><button className="button primary" onClick={() => navigate("new")}><Plus size={14} />New assignment</button></div></header>
      <main className="content" id="main-content">
        {error && <Alert onDismiss={() => setError("")}>{error}</Alert>}
        {view === "dashboard" && (dashboard ? <Dashboard data={dashboard} navigate={navigate} onDemo={createDemo} busy={busy} /> : <Loading>Loading your assessments…</Loading>)}
        {view === "classes" && dashboard && <Classes data={dashboard} onNew={() => navigate("new")} />}
        {view === "new" && dashboard && <NewAssessment classes={dashboard.classes} liveConfigured={me.liveConfigured} onCreated={async (item) => { setAssessment(item); await loadDashboard(); navigate("workspace", item.id); }} onDemo={createDemo} demoBusy={busy} onCancel={() => navigate("dashboard")} />}
        {["workspace", "review", "reports"].includes(view) && <>
          {dashboard && dashboard.assessments.length > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 15 }} className="print-hide"><button className="back-link" style={{ marginBottom: 0 }} onClick={() => navigate("dashboard")}><ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />All assessments</button><label className="assessment-selector"><FolderOpen size={14} /><span className="sr-only">Select assessment</span><select value={assessmentId || ""} onChange={(event) => navigate(view, event.target.value)}><option value="" disabled>Select an assessment</option>{dashboard.assessments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div>}
          {fetchingAssessment && !assessment ? <Loading>Opening assessment…</Loading> : assessment ? <>
            {view === "workspace" && <Workspace assessment={assessment} refresh={refresh} notify={notify} navigate={navigate} onDelete={() => setModal("delete")} />}
            {view === "review" && <ReviewDesk assessment={assessment} refresh={refresh} notify={notify} navigate={navigate} />}
            {view === "reports" && <Reports assessment={assessment} refresh={refresh} notify={notify} navigate={navigate} />}
          </> : <div className="panel no-assessment"><Empty title="Your next assessment starts here" action={<button className="button primary" onClick={() => navigate("new")}><Plus size={14} />Create an assignment</button>}>Add a rubric and learner responses to plan, mark and prepare feedback.</Empty></div>}
        </>}
        <div className="footer-note"><ShieldCheck size={11} />Thoughtful support. Teacher judgment. Every step of the way.</div>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}<button className="icon-button" style={{ color: "#aab8cd", marginLeft: "auto", height: 21, width: 21 }} aria-label="Dismiss notification" onClick={() => setToast("")}><X size={13} /></button></div>}
    {modal && <div className="modal-overlay" onClick={() => setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
      {modal === "delete" ? <><h2 id="modal-title">Delete this assessment?</h2><p>This removes <strong>{assessment?.title}</strong>, its uploaded files, run history, marks and published feedback. This action cannot be undone.</p><div className="page-actions"><button className="button" disabled={busy} onClick={() => setModal(null)}>Keep assessment</button><button className="button danger" disabled={busy} onClick={removeAssessment}>{busy && <LoaderCircle size={13} className="spin" />}Delete assessment</button></div></> : <><h2 id="modal-title">Your workspace</h2><p>Model credentials and execution limits are configured on the server. Uploaded learner work is treated as assessment data.</p><div className="settings-row"><span>Signed in as</span><strong>{me.user.email}</strong></div><div className="settings-row"><span>Live model connection</span><Badge status={me.liveConfigured ? "ready" : "pending"}>{me.liveConfigured ? "Configured" : "Not configured"}</Badge></div><div className="settings-row"><span>Demo output</span><strong>Deterministic, simulated fixtures</strong></div><div className="settings-row"><span>Correction limit</span><strong>2 attempts per task</strong></div><div className="settings-row"><span>Release controls</span><strong>Teacher approval required</strong></div><div className="page-actions"><button className="button primary" onClick={() => setModal(null)}>Done</button></div></>}
    </section></div>}
  </div>;
}

function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState("teacher@teachmate.local");
  const [password, setPassword] = useState("TeachMate-demo-2026");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signIn = async (event?: React.FormEvent, demoEmail?: string) => {
    event?.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: demoEmail || email, password: demoEmail ? "TeachMate-demo-2026" : password }) }); await onSignedIn(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="login-shell"><section className="login-story"><div className="brand"><span className="brand-mark"><BookOpen size={23} strokeWidth={1.7} /></span>TeachMate<span className="pink" style={{ marginLeft: -7 }}>.</span></div><div className="login-story-content"><div className="eyebrow">Your digital teaching colleague</div><h1>A little less admin.<br /><em>More time to teach.</em></h1><p>From a stack of responses to thoughtful feedback. One workspace to mark, review and celebrate progress.</p><div className="login-promises"><div className="login-promise"><ClipboardCheck size={18} />Mark against your rubric, with evidence.</div><div className="login-promise"><MessageSquareText size={18} />Give every learner constructive feedback.</div><div className="login-promise"><ShieldCheck size={18} />Keep every final decision in your hands.</div></div></div><div className="login-story-bottom"><LockKeyhole size={12} />Private by design. Led by teachers.</div></section><section className="login-form-area"><div className="login-form"><div className="eyebrow">A calmer teaching day starts here</div><h2>Welcome to your workspace.</h2><p>Sign in to pick up your assessments, review suggestions and share feedback with your learners.</p>{error && <Alert>{error}</Alert>}<form onSubmit={signIn}><div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" value={email} autoComplete="username" required onChange={(event) => setEmail(event.target.value)} /></div><div className="field"><label htmlFor="password">Password</label><input id="password" type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} /></div><button className="button primary full" type="submit" disabled={busy} style={{ minHeight: 43, marginTop: 5 }}>{busy ? <LoaderCircle size={15} className="spin" /> : <>Open my workspace<ArrowRight size={14} /></>}</button></form><div className="login-demo-box"><h3><Sparkles size={14} />Take a look around</h3><p>The local demo uses fictional Grade 8 learners. Demo marking is clearly labelled and simulated. These accounts use the shared password <strong>TeachMate-demo-2026</strong>.</p><div className="demo-login-actions"><button className="button" disabled={busy} onClick={() => signIn(undefined, "teacher@teachmate.local")}><GraduationCap size={13} />Explore as teacher</button><button className="button" disabled={busy} onClick={() => signIn(undefined, "learner01@teachmate.local")}><BookOpen size={13} />View as learner</button></div></div><div className="login-footer"><ShieldCheck size={11} />Your classroom. Your standards. Your decision.</div></div></section></main>;
}

function Dashboard({ data, navigate, onDemo, busy }: { data: DashboardDTO; navigate: (view: View, id?: string) => void; onDemo: () => Promise<void>; busy: boolean }) {
  const results = data.assessments.flatMap((item) => item.submissions.flatMap((submission) => submission.result ? [submission.result] : []));
  const awaiting = results.filter((result) => ["draft", "needs_review", "revision_requested"].includes(result.status)).length;
  const published = results.filter((result) => result.status === "published").length;
  const activeRuns = data.assessments.flatMap((item) => item.runs).filter((run) => ["queued", "running"].includes(run.status));
  const events = data.assessments.flatMap((item) => item.runs.flatMap((run) => run.events.map((event) => ({ ...event, assessmentId: item.id })))).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 4);
  const firstName = data.user.name.split(" ")[0];
  return <>
    <div className="page-heading"><div><div className="eyebrow">A little support for a big calling</div><h1>Hello, {firstName}<span className="pink">.</span></h1><p>Here’s what’s happening in your classroom workspace.</p></div><button className="button" onClick={onDemo} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={14} />}Try the demo assessment</button></div>
    <div className="stats-grid">
      <Stat label="Your classes" value={data.classes.length} foot={`${data.classes.reduce((sum, item) => sum + item.learners.length, 0)} learners in your care`} icon={Users} />
      <Stat label="Assessments" value={data.assessments.length} foot={activeRuns.length ? `${activeRuns.length} ${activeRuns.length === 1 ? "run" : "runs"} in progress` : "All your work, in one place"} icon={Layers3} color="pink-bg" />
      <Stat label="Awaiting your review" value={awaiting} foot={awaiting ? "Ready for your professional judgment" : "Your review desk is clear"} icon={ClipboardCheck} color="amber-bg" />
      <Stat label="Feedback published" value={published} foot="Approved and shared with learners" icon={CheckCircle2} color="green-bg" />
    </div>
    <div className="dashboard-grid"><div>
      <div className="hero-card"><div className="hero-copy"><div className="eyebrow">Meet your digital teaching colleague</div><h2>Your expertise.<br />A helping hand with the rest.</h2><p>Give TeachMate a goal and your materials. Get evidence, draft marks and individual feedback — ready for your review.</p><button className="button primary" onClick={() => navigate("new")}><Plus size={13} />Create an assignment<ArrowRight size={13} /></button></div><div className="hero-mini" aria-hidden="true"><div className="hero-step"><FileText size={14} />Your rubric & responses</div><div className="hero-step"><WandSparkles size={14} />Thoughtful draft marking</div><div className="hero-step"><CheckCircle2 size={14} />Your final approval</div></div></div>
      <section className="panel"><div className="panel-header"><div><h2>Recent assessments<span className="count-pill">{data.assessments.length}</span></h2><p>From first draft to feedback, keep everything moving.</p></div><button className="button link" onClick={() => navigate("new")}><Plus size={12} />Create new</button></div>{data.assessments.length ? <div className="table-wrap"><table><thead><tr><th>Assessment</th><th>Status</th><th>Learners</th><th><span className="sr-only">Open assessment</span></th></tr></thead><tbody>{data.assessments.slice(0, 7).map((item) => {
        const run = item.runs[0];
        const status = run && ["running", "queued"].includes(run.status) ? run.status : item.status;
        const marked = item.submissions.filter((submission) => submission.result).length;
        return <tr className="clickable" key={item.id} onClick={() => navigate("workspace", item.id)}><td><div className="assessment-title"><div className="assessment-icon"><FileText size={18} strokeWidth={1.4} /></div><div><strong>{item.title}</strong><small>{item.class.name} · {item.class.subject}</small></div></div></td><td><Badge status={status} /></td><td><span style={{ color: "#63738d", fontSize: 10 }}>{marked}/{item.submissions.length} marked</span></td><td><button className="icon-button" aria-label={`Open ${item.title}`} onClick={(event) => { event.stopPropagation(); navigate("workspace", item.id); }}><ChevronRight size={15} /></button></td></tr>;
      })}</tbody></table></div> : <Empty title="Your first assessment is one step away" action={<button className="button soft" onClick={() => navigate("new")}><Plus size={13} />Create an assignment</button>}>Add your rubric and learner responses. TeachMate will help turn them into useful, individual feedback.</Empty>}<div className="panel-footer"><span>{data.assessments.length} {data.assessments.length === 1 ? "assessment" : "assessments"} in your workspace</span><span style={{ display: "flex", alignItems: "center", gap: 4 }}><ShieldCheck size={11} />Only your assigned classes</span></div></section>
      {awaiting > 0 && <section className="panel"><div className="panel-header"><div><h2>A fresh pair of eyes, then it’s over to you.</h2><p>{awaiting} draft {awaiting === 1 ? "result needs" : "results need"} your review before learners can see feedback.</p></div><button className="button soft" onClick={() => navigate("review", data.assessments.find((item) => item.submissions.some((submission) => submission.result && !["approved", "published"].includes(submission.result.status)))?.id)}>Open review desk<ArrowRight size={12} /></button></div></section>}
    </div><aside className="dashboard-aside"><section className="panel"><div className="panel-header"><h2>Your classes</h2><button className="button link" onClick={() => navigate("classes")}>View all<ChevronRight size={11} /></button></div><div className="class-list">{data.classes.length ? data.classes.map((classroom) => <div className="class-card" key={classroom.id}><div className="class-top"><div className="class-square"><BookOpen size={18} strokeWidth={1.5} /></div><div><strong>{classroom.name}</strong><small>{classroom.subject}</small></div></div><div className="class-meta"><span><Users size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />{classroom.learners.length} learners</span><strong>{data.assessments.filter((item) => item.classId === classroom.id).length} assessments</strong></div></div>) : <Empty title="No assigned classes">Ask your administrator to assign your classes.</Empty>}</div></section><section className="panel"><div className="panel-header"><h2>Workspace activity</h2><RefreshCw size={13} color="#a0aabb" /></div>{events.length ? <div className="activity-list">{events.map((event) => <button key={event.id} onClick={() => navigate("workspace", event.assessmentId)} className="activity-item" style={{ background: "none", borderLeft: 0, borderTop: 0, borderRight: 0, textAlign: "left", width: "100%" }}><span className={`activity-dot ${event.level === "success" ? "green" : event.level === "warning" ? "amber" : "pink"}`}><Check size={12} /></span><div className="activity-text">{event.message}<small>{shortDate(event.createdAt)} · {shortTime(event.createdAt)}</small></div></button>)}</div> : <div className="empty-state" style={{ padding: "25px 20px" }}><div className="activity-dot" style={{ margin: "0 auto 10px" }}><WandSparkles size={13} /></div><p style={{ marginBottom: 0, fontSize: 10 }}>Start an assessment run to see its actual activity here.</p></div>}</section><div className="info-note"><Sparkles size={17} /><div><strong>A thoughtful colleague, always.</strong>Suggestions come with evidence. Uncertainty gets flagged. Your judgment stays at the centre.</div></div></aside></div>
  </>;
}

function Stat({ label, value, foot, icon: Icon, color = "" }: { label: string; value: number; foot: string; icon: typeof Users; color?: string }) {
  return <div className="stat-card"><div className="stat-top"><div className={`stat-icon ${color}`}><Icon size={18} strokeWidth={1.7} /></div><span style={{ width: 4, height: 4, borderRadius: "50%", background: "#d9deea" }} /></div><div className="stat-number">{value}</div><div className="stat-label">{label}</div><div className="stat-foot">{foot}</div></div>;
}

function Classes({ data, onNew }: { data: DashboardDTO; onNew: () => void }) {
  return <><div className="page-heading"><div><div className="eyebrow">The people behind the progress</div><h1>Your classes<span className="pink">.</span></h1><p>Your assigned classrooms and their learners.</p></div><button className="button primary" onClick={onNew}><Plus size={13} />New assignment</button></div>{data.classes.map((classroom) => <section className="panel" key={classroom.id}><div className="panel-header"><div><h2>{classroom.name} <span className="count-pill">{classroom.learners.length}</span></h2><p>{classroom.subject} · Synthetic demonstration roster</p></div><BookOpen size={20} color="#b994aa" /></div><div className="table-wrap"><table><thead><tr><th>Learner</th><th>Account</th><th>Class</th></tr></thead><tbody>{classroom.learners.map((learner) => <tr key={learner.id}><td><div className="grade-learner"><span className="avatar">{initials(learner.name)}</span>{learner.name}</div></td><td className="muted">{learner.email}</td><td className="muted">{classroom.name}</td></tr>)}</tbody></table></div></section>)}{!data.classes.length && <div className="panel"><Empty title="No assigned classes">Classes become available when they are assigned to your teacher account.</Empty></div>}</>;
}
