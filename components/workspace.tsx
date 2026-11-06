"use client";

import { useState } from "react";
import { AlertCircle, ArrowDownToLine, ArrowRight, Check, CheckCheck, CheckCircle2, ClipboardCheck, FileSpreadsheet, FileText, Flag, FlaskConical, FolderCheck, ListChecks, LoaderCircle, MessageSquareText, PackageCheck, Play, RotateCcw, ShieldCheck, Square, Trash2, WandSparkles } from "lucide-react";
import type { AssessmentDTO, IssueDTO } from "@/lib/types";
import { api, displayStatus, shortTime, View } from "./api";
import { Alert, Badge, Empty, ModePill } from "./ui";

const stages = [
  { label: "Goal", icon: Flag }, { label: "Plan", icon: ListChecks }, { label: "Act", icon: WandSparkles }, { label: "Check", icon: ShieldCheck }, { label: "Correct", icon: RotateCcw }, { label: "Deliver", icon: PackageCheck },
];

export default function Workspace({ assessment, refresh, notify, navigate, onDelete }: { assessment: AssessmentDTO; refresh: () => Promise<void>; notify: (message: string) => void; navigate: (view: View, id?: string) => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const run = assessment.runs[0];
  const active = !!run && ["queued", "running"].includes(run.status);
  const finished = !!run && ["completed", "delivered", "needs_review"].includes(run.status);
  const completedTasks = run?.tasks.filter((task) => ["completed", "corrected", "skipped"].includes(task.status)).length || 0;
  const progress = finished ? 100 : run?.tasks.length ? Math.round(completedTasks / run.tasks.length * 100) : 0;
  const stageIndex = Math.max(0, stages.findIndex((item) => item.label.toLowerCase() === run?.stage.toLowerCase()));
  const results = assessment.submissions.filter((submission) => submission.result);
  const allIssues: IssueDTO[] = [...new Map([...assessment.issues, ...assessment.submissions.flatMap((submission) => submission.issues)].map((issue) => [issue.id, issue])).values()];
  const issues = allIssues.filter((issue) => !issue.resolved);
  const resolved = allIssues.filter((issue) => issue.resolved);
  const visibleIssues = showResolved ? allIssues : issues;
  const received = assessment.submissions.filter((submission) => ["received", "blank"].includes(submission.extractionStatus)).length;

  const start = async (retry = false) => {
    setBusy(true); setError("");
    try { await api(`/api/assessments/${assessment.id}/run`, { method: "POST", body: JSON.stringify({ retry }) }); await refresh(); notify(retry ? "Run resumed. Completed work and teacher edits are preserved." : "Run started. The activity feed shows real backend events."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!run) return;
    setBusy(true); setError("");
    try { await api(`/api/runs/${run.id}/cancel`, { method: "POST" }); await refresh(); notify("Cancellation requested. Completed work has been saved."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <><div className="page-heading"><div><div className="eyebrow">A colleague with a clear plan</div><h1>Agent workspace<span className="pink">.</span></h1><p>{assessment.class.name} · {assessment.class.subject} · {assessment.submissions.length} learners</p></div><div className="page-actions">{active ? <button className="button" onClick={cancel} disabled={busy}><Square size={12} />Cancel run</button> : <button className="button navy" onClick={() => start(!!run)} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : run ? <RotateCcw size={13} /> : <Play size={13} />}{run ? "Retry unfinished tasks" : "Start marking"}</button>}<button className="button primary" disabled={!results.length} onClick={() => navigate("review", assessment.id)}><ClipboardCheck size={14} />Open review desk<ArrowRight size={13} /></button></div></div>
    {error && <Alert>{error}</Alert>}
    {assessment.faultInjection && <Alert kind="info" title="Labelled fault-injection demonstration"><p>This demo deliberately introduces an incorrect intermediate total. The reviewer will detect it and the corrector will recalculate it. It is an intentional test, not a spontaneous model error.</p></Alert>}
    {run?.error && <Alert kind="warning" title="This run needs attention">{run.error} Completed tasks are saved; retrying continues unfinished work.</Alert>}
    <div className="workspace-top"><section className="panel"><div className="run-overview"><div><ModePill mode={assessment.mode} /><h2>{assessment.title}</h2><p>{active ? `TeachMate is working through ${run.stage.toLowerCase()} tasks. You can follow each action below.` : finished ? "Draft deliverables are ready. Review suggested marks and flags before approving any results." : run?.status === "cancelled" ? "This run was cancelled. Completed work is saved and can be reviewed or resumed." : "Your materials are in. Start the run to create a plan and prepare draft marking for your review."}</p></div><div className="progress-ring"><svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true"><circle cx="38" cy="38" r="32" fill="none" stroke="#f0edf4" strokeWidth="5" /><circle cx="38" cy="38" r="32" fill="none" stroke="#e57da1" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${progress * 2.0106} 201.06`} /></svg><strong>{progress}%</strong></div></div><div className="stage-strip" aria-label="Workflow stages">{stages.map(({ label, icon: Icon }, index) => <div className={`stage-item ${finished || index < stageIndex ? "done" : index === stageIndex ? "current" : ""}`} key={label} aria-current={!finished && index === stageIndex ? "step" : undefined}><span className="stage-icon">{finished || index < stageIndex ? <Check size={16} /> : <Icon size={16} strokeWidth={1.7} />}</span>{label}</div>)}</div></section><section className="panel run-meta"><div><span>Run status</span><Badge status={run?.status || "ready"} /></div><div><span>Tool executions</span><strong>{run?.toolCount || 0}</strong></div><div><span>Model calls</span><strong>{run?.modelCalls || 0}{assessment.mode === "demo" ? " · simulated mode" : ""}</strong></div><div><span>Correction limit</span><strong>2 attempts per task</strong></div><div><span>Materials ready</span><strong>{received}/{assessment.submissions.length} submissions</strong></div></section></div>
    <div className="workspace-grid"><div><section className="panel"><div className="panel-header"><div><h2>The work plan</h2><p>{run?.tasks.length ? `${completedTasks} of ${run.tasks.length} tasks completed` : "Generated from your goal and available materials"}</p></div>{active ? <span className="badge pink"><LoaderCircle size={10} className="spin" />In progress</span> : <Badge status={run?.status || "ready"} />}</div><div className="plan-goal"><strong>Your goal</strong>{assessment.goal}</div>{run?.plan.length ? <div className="task-list">{run.plan.map((step) => {
        const task = run.tasks.find((item) => item.key === step.key);
        const status = task?.status || "pending";
        const Icon = ["completed", "corrected", "skipped"].includes(status) ? Check : status === "running" ? LoaderCircle : ["failed", "needs_input"].includes(status) ? AlertCircle : status === "corrected" ? RotateCcw : Square;
        return <div className="task-row" key={step.key}><span className={`task-state ${status}`}><Icon size={12} className={status === "running" ? "spin" : undefined} /></span><div className="task-copy"><strong>{step.title}</strong><p>{task?.error || step.completionCriteria}</p><div className="task-criteria">Tool: {step.tool}{step.dependencies.length ? ` · Depends on ${step.dependencies.join(", ")}` : ""}{task?.attempts ? ` · ${task.attempts} attempt${task.attempts === 1 ? "" : "s"}` : ""}</div></div><Badge status={status} /></div>;
      })}</div> : <Empty title="The plan begins with your materials" action={!active ? <button className="button soft" onClick={() => start()} disabled={busy}><Play size={12} />Start marking</button> : undefined}>The planner will inspect your rubric, match learner responses and set completion criteria before the workers begin.</Empty>}</section>
      <section className="panel"><div className="panel-header"><div><h2>Live activity</h2><p>Actual actions, checks and outcomes from this run.</p></div><span className="badge" style={{ fontSize: 10 }}>{run?.events.length || 0} events</span></div>{run?.events.length ? <div className="event-feed" aria-live="polite" aria-relevant="additions">{run.events.map((event) => {
        const Icon = event.level === "error" || event.level === "warning" ? AlertCircle : event.stage === "Correct" ? RotateCcw : event.level === "success" ? CheckCheck : event.stage === "Deliver" ? FolderCheck : WandSparkles;
        return <article className={`event ${event.level} ${event.stage === "Correct" ? "correct" : ""}`} key={event.id}><span className="event-symbol"><Icon size={12} /></span><div className="event-copy"><header><strong>{event.message}</strong><time dateTime={event.createdAt}>{shortTime(event.createdAt)}</time></header><p>{event.detail}</p></div></article>;
      })}</div> : <div className="empty-state" style={{ padding: "30px 20px" }}><p style={{ marginBottom: 0 }}>No actions have run yet. Activity will appear here after you start marking.</p></div>}</section>
    </div><aside className="workspace-aside"><section className="panel"><div className="panel-header"><div><h2>Needs your attention<span className="count-pill">{issues.length}</span></h2><p>Uncertainty stays visible.</p></div><Flag size={15} color="#c6a178" /></div>{visibleIssues.length ? <div className="issue-list">{visibleIssues.map((issue) => <div className="issue-card" key={issue.id}>{issue.resolved ? <CheckCircle2 size={14} color="#80b49d" /> : <AlertCircle size={14} />}<div><strong>{issue.message}</strong>{issue.resolution && <p>{issue.resolution}</p>}<Badge status={issue.resolved ? "completed" : issue.blocking ? "needs_review" : "draft"}>{issue.resolved ? "Resolved" : issue.blocking ? "Blocks approval" : "Review note"}</Badge></div></div>)}</div> : <div className="empty-state" style={{ padding: "28px 20px" }}><div className="activity-dot green" style={{ margin: "0 auto 11px" }}><Check size={14} /></div><p style={{ marginBottom: 0 }}>{run ? "No unresolved issues have been recorded." : "Issues will be recorded as the materials are checked."}</p></div>}{resolved.length > 0 && <div className="panel-footer"><button className="button link" style={{ fontSize: 11 }} onClick={() => setShowResolved((old) => !old)}>{showResolved ? "Hide resolved issues" : `Show ${resolved.length} resolved issue${resolved.length === 1 ? "" : "s"}`}</button></div>}{issues.length > 0 && results.length > 0 && <div className="panel-footer"><button className="button link" style={{ fontSize: 12 }} onClick={() => navigate("review", assessment.id)}>Review flagged responses<ArrowRight size={11} /></button></div>}</section><section className="panel"><div className="panel-header"><div><h2>Your deliverables</h2><p>{results.length ? "Drafts ready for teacher review" : "Prepared after marking and checking"}</p></div><PackageCheck size={15} color="#b797ae" /></div><Deliverable icon={FileSpreadsheet} title="Draft gradebook" description={`${results.length} of ${assessment.submissions.length} learners assessed`} onClick={() => navigate("reports", assessment.id)} disabled={!results.length} /><Deliverable icon={MessageSquareText} title="Individual feedback" description="Evidence, marks and practical next steps" onClick={() => navigate("review", assessment.id)} disabled={!results.length} /><Deliverable icon={FileText} title="Class performance report" description={assessment.report ? "Calculated from current gradebook rows" : "Waiting for results"} onClick={() => navigate("reports", assessment.id)} disabled={!assessment.report} /></section><div className="info-note"><ShieldCheck size={17} /><div><strong>Checks support your judgment.</strong>Deterministic checks verify calculations. A separate review pass checks evidence and consistency. Final approval stays with you.</div></div></aside></div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 23, gap: 15 }} className="print-hide"><span style={{ fontSize: 12, color: "#9ba6b8" }}><ShieldCheck size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />{assessment.documents.length} uploaded files · {assessment.runs.length} persisted {assessment.runs.length === 1 ? "run" : "runs"}</span><button className="button link" style={{ color: "#aa8b99", fontSize: 11 }} onClick={onDelete} disabled={active}><Trash2 size={11} />Delete assessment & files</button></div>
  </>;
}

function Deliverable({ icon: Icon, title, description, onClick, disabled }: { icon: typeof FileText; title: string; description: string; onClick: () => void; disabled: boolean }) {
  return <div className="deliverable"><Icon size={19} strokeWidth={1.4} /><div><strong>{title}</strong><small>{description}</small></div><button className="icon-button" disabled={disabled} aria-label={`Open ${title.toLowerCase()}`} onClick={onClick}><ArrowRight size={14} /></button></div>;
}
