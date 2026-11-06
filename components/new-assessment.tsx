"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, FileCheck2, FileText, FlaskConical, Info, LoaderCircle, Plus, ShieldCheck, Sparkles, Upload, Users, X } from "lucide-react";
import type { AssessmentDTO, AssessmentInput, ClassDTO, Criterion, Mode, SubmissionInput } from "@/lib/types";
import { api, initials } from "./api";
import { Alert, CheckItem, ModePill } from "./ui";

type UploadResult = { filename: string; text: string; status: string; warnings: string[]; rows?: Record<string, string>[]; roster?: Record<string, string>[]; uploadToken: string };
type AttachedUpload = { token: string; kind: string; learnerId?: string };
type Preview = { valid: boolean; issues: { code: string; message: string; blocking: boolean }[]; rubric: Criterion[]; submissionCount: number };

export default function NewAssessment({ classes, liveConfigured, onCreated, onDemo, demoBusy, onCancel }: { classes: ClassDTO[]; liveConfigured: boolean; onCreated: (assessment: AssessmentDTO) => Promise<void>; onDemo: () => Promise<void>; demoBusy: boolean; onCancel: () => void }) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("Mark these learner responses using the attached rubric. Write constructive individual feedback, compile the marks and prepare a class summary. Flag anything that needs my attention.");
  const [instructions, setInstructions] = useState("");
  const [rubricText, setRubricText] = useState("");
  const [preferences, setPreferences] = useState("");
  const [mode, setMode] = useState<Mode>("demo");
  const [faultInjection, setFaultInjection] = useState(false);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionInput>>({});
  const [uploads, setUploads] = useState<AttachedUpload[]>([]);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [inputTabs, setInputTabs] = useState<Record<string, "paste" | "upload">>({ instructions: "paste", rubric: "paste" });
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<Preview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const classroom = classes.find((item) => item.id === classId);
  const learners = classroom?.learners || [];
  const provided = learners.filter((learner) => submissions[learner.id] && submissions[learner.id].status !== "missing").length;
  const payload = useMemo((): AssessmentInput & { uploads: AttachedUpload[] } => ({
    title, classId, goal, instructions, rubricText, feedbackPreferences: preferences, mode, faultInjection: mode === "demo" && faultInjection,
    submissions: learners.map((learner) => submissions[learner.id] || { learnerId: learner.id, text: "", status: "missing" as const }), uploads,
  }), [title, classId, goal, instructions, rubricText, preferences, mode, faultInjection, learners, submissions, uploads]);

  useEffect(() => { setValidation(null); }, [payload]);

  const setResponse = (learnerId: string, text: string) => setSubmissions((old) => ({ ...old, [learnerId]: { learnerId, text, status: text.trim() ? "received" : "missing", filename: old[learnerId]?.filename } }));

  const upload = async (file: File | undefined, kind: string, learnerId?: string) => {
    if (!file) return;
    const key = learnerId || kind;
    setUploading(key); setError(""); setWarnings([]);
    try {
      const body = new FormData(); body.set("file", file); body.set("kind", kind);
      const result = await api<UploadResult>("/api/uploads", { method: "POST", body });
      setWarnings(result.warnings || []);
      setFileNames((old) => ({ ...old, [key]: result.filename }));
      setUploads((old) => [...old.filter((item) => !(item.kind === kind && item.learnerId === learnerId)), { token: result.uploadToken, kind, ...(learnerId ? { learnerId } : {}) }]);
      if (kind === "rubric" || kind === "instructions") {
        if (!["received", "extracted", "ok", "success", "blank"].includes(result.status) || !result.text.trim()) {
          if (kind === "rubric") setRubricText(""); else setInstructions("");
          setError(`${result.filename} could not provide complete readable text. Paste the text or use OCR first; scanned and handwritten work cannot be marked.`);
          return;
        }
        if (kind === "rubric") setRubricText(result.text); else setInstructions(result.text);
      } else if (kind === "submission" && learnerId) {
        const status = ["unreadable", "failed", "blank"].includes(result.status) ? result.status as "unreadable" | "failed" | "blank" : result.text.trim() ? "received" : "blank";
        setSubmissions((old) => ({ ...old, [learnerId]: { learnerId, text: result.text, status, filename: result.filename } }));
      } else {
        const rows = result.rows || result.roster || [];
        let matched = 0;
        const unmatched: string[] = [];
        const next: Record<string, SubmissionInput> = {};
        for (const row of rows) {
          const normalized = Object.fromEntries(Object.entries(row).map(([name, value]) => [name.toLowerCase().replace(/[\s_-]/g, ""), value]));
          const identifier = normalized.learnerid || normalized.id || normalized.email || normalized.learneremail || normalized.learnername || normalized.name || normalized.learner || "";
          const learner = learners.find((item) => item.id === identifier || item.email.toLowerCase() === identifier.toLowerCase() || item.name.toLowerCase() === identifier.toLowerCase());
          if (!learner) { unmatched.push(identifier || "unnamed row"); continue; }
          matched++;
          if (kind === "submissions") {
            const text = normalized.response ?? normalized.text ?? normalized.answer ?? normalized.submission ?? normalized.sourcetext ?? "";
            const rawStatus = (normalized.status || "").toLowerCase();
            const status = ["blank", "missing", "unreadable", "failed"].includes(rawStatus) ? rawStatus as "blank" | "missing" | "unreadable" | "failed" : text.trim() ? "received" : "blank";
            next[learner.id] = { learnerId: learner.id, text, status, filename: result.filename };
          }
        }
        if (kind === "submissions") setSubmissions((old) => ({ ...old, ...next }));
        const notices = [...(result.warnings || []), `${matched} ${kind === "roster" ? "roster records matched to your assigned class" : "learner responses imported"}.`];
        if (unmatched.length) notices.push(`Could not match: ${unmatched.slice(0, 5).join(", ")}. Use assigned learner IDs, names or email addresses.`);
        setWarnings(notices);
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setUploading(null); }
  };

  const preview = async () => {
    if (!formRef.current?.reportValidity()) return;
    setBusy(true); setError("");
    try { setValidation(await api<Preview>("/api/assessments/preview", { method: "POST", body: JSON.stringify(payload) })); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validation?.valid) { await preview(); return; }
    setBusy(true); setError("");
    try { const result = await api<AssessmentDTO>("/api/assessments", { method: "POST", body: JSON.stringify(payload) }); await onCreated(result); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const uploadField = (kind: "rubric" | "instructions") => <><div className="input-tabs" role="group" aria-label={`${kind} input method`}><button type="button" className={inputTabs[kind] === "paste" ? "active" : ""} onClick={() => setInputTabs((old) => ({ ...old, [kind]: "paste" }))}><FileText size={11} />Paste text</button><button type="button" className={inputTabs[kind] === "upload" ? "active" : ""} onClick={() => setInputTabs((old) => ({ ...old, [kind]: "upload" }))}><Upload size={11} />Upload file</button></div>{inputTabs[kind] === "upload" && <label className="upload-zone">{uploading === kind ? <LoaderCircle size={23} className="spin" /> : <Upload size={23} strokeWidth={1.4} />}<strong><span>Choose a file</span> or drop it here</strong><small>TXT or text-based PDF · max 5 MB</small><input aria-label={`Upload ${kind}`} type="file" accept=".txt,.pdf" disabled={!!uploading} onChange={(event) => upload(event.target.files?.[0], kind)} /></label>}{fileNames[kind] && <div className="file-chip"><FileCheck2 size={14} /><span>{fileNames[kind]}</span><span className="badge green" style={{ marginLeft: "auto" }}>Text extracted</span></div>}</>;

  return <><div className="page-heading"><div><div className="eyebrow">From a goal to a job well done</div><h1>Create an assignment<span className="pink">.</span></h1><p>Bring your assessment. Set the standard. We’ll help with the marking.</p></div><button className="button" onClick={onDemo} disabled={busy || demoBusy}>{demoBusy ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}Use the sample materials</button></div>
    <div className="form-layout"><form ref={formRef} onSubmit={create} className="panel">
      <section className="form-section"><div className="form-section-heading"><span className="step-number">01</span><div><h2>Set the goal</h2><p>Tell your teaching colleague what a good result looks like.</p></div></div><div className="fields"><div className="field"><label htmlFor="assignment-title">Assessment title <span className="required">*</span></label><input id="assignment-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={150} placeholder="e.g. Reading with understanding" /></div><div className="field"><label htmlFor="assignment-class">Class & subject <span className="required">*</span></label><select id="assignment-class" value={classId} onChange={(event) => { setClassId(event.target.value); setSubmissions({}); setUploads((old) => old.filter((item) => !item.learnerId)); }} required><option value="" disabled>Select your class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.subject}</option>)}</select></div><div className="field wide"><label htmlFor="assignment-goal">What would you like TeachMate to do? <span className="required">*</span></label><textarea id="assignment-goal" className="goal-textarea" value={goal} onChange={(event) => setGoal(event.target.value)} required maxLength={4000} /><span className="field-hint">A clear goal helps the planner choose the right tasks and deliverables.</span></div></div></section>
      <section className="form-section"><div className="form-section-heading"><span className="step-number">02</span><div><h2>Add your assessment materials</h2><p>Good marking starts with clear instructions and a clear standard.</p></div></div><div className="fields"><div className="field wide"><label htmlFor="assessment-instructions">Assessment instructions & questions <span className="required">*</span></label>{uploadField("instructions")}<textarea id="assessment-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} required rows={5} maxLength={30000} placeholder="Paste the passage, questions and instructions learners were given…" /><span className="field-hint">Extracted file text appears here so you can inspect it before marking.</span></div><div className="field wide"><label htmlFor="assessment-rubric">Rubric or marking memorandum <span className="required">*</span></label>{uploadField("rubric")}<textarea id="assessment-rubric" value={rubricText} onChange={(event) => setRubricText(event.target.value)} required rows={6} maxLength={20000} placeholder={"Use one criterion per line, for example:\nUnderstanding | 4 | Explains the main idea accurately.\nEvidence | 4 | Uses relevant details from the passage.\nExpression | 2 | Writes clearly in complete sentences."} /><span className="field-hint">Include a maximum mark and a description for every criterion. The validation preview will show the parsed rubric.</span></div></div></section>
      <section className="form-section"><div className="form-section-heading"><span className="step-number">03</span><div style={{ flex: 1 }}><h2>Add learner responses</h2><p>{provided} of {learners.length} learners have a response or an explicit submission status.</p></div><Users size={18} color="#adb6c5" /></div><div className="fields"><div className="field"><label className="field-label">Structured submissions</label><label className="upload-zone" style={{ minHeight: 100 }}>{uploading === "submissions" ? <LoaderCircle size={20} className="spin" /> : <Upload size={20} strokeWidth={1.4} />}<strong><span>Import responses</span> from CSV</strong><small>Columns: email, response, status (optional)</small><input aria-label="Import learner responses CSV" type="file" accept=".csv" disabled={!!uploading} onChange={(event) => upload(event.target.files?.[0], "submissions")} /></label></div><div className="field"><label className="field-label">Optional class roster check</label><label className="upload-zone" style={{ minHeight: 100 }}>{uploading === "roster" ? <LoaderCircle size={20} className="spin" /> : <Users size={20} strokeWidth={1.4} />}<strong><span>Check a roster</span> against this class</strong><small>CSV with learner ID, email or name</small><input aria-label="Check class roster CSV" type="file" accept=".csv" disabled={!!uploading} onChange={(event) => upload(event.target.files?.[0], "roster")} /></label></div></div><div className="submissions-list">{(showAll ? learners : learners.slice(0, 3)).map((learner) => {
        const response = submissions[learner.id];
        return <div className="submission-editor" key={learner.id}><div className="submission-editor-head"><span className="avatar">{initials(learner.name)}</span><strong>{learner.name}</strong><small>{response?.filename || learner.email}</small></div><label className="sr-only" htmlFor={`response-${learner.id}`}>{learner.name} response</label><textarea id={`response-${learner.id}`} value={response?.text || ""} disabled={response?.status === "blank"} onChange={(event) => setResponse(learner.id, event.target.value)} placeholder="Paste the learner’s actual answer. Leave empty for a missing submission." /><div className="submission-editor-bottom"><label className="check-label"><input type="checkbox" checked={response?.status === "blank"} onChange={(event) => setSubmissions((old) => ({ ...old, [learner.id]: { learnerId: learner.id, text: "", status: event.target.checked ? "blank" : "missing" } }))} />Confirmed blank answer</label><label className="small-upload">{uploading === learner.id ? <LoaderCircle size={11} className="spin" /> : <Upload size={11} />}{response?.filename ? "Replace file" : "TXT / PDF"}<input aria-label={`Upload ${learner.name} submission`} type="file" accept=".txt,.pdf" disabled={!!uploading} onChange={(event) => upload(event.target.files?.[0], "submission", learner.id)} /></label></div>{response && ["unreadable", "failed"].includes(response.status || "") && <p style={{ fontSize: 9, color: "#b06565", marginTop: 8 }}>This file could not be read. It will be flagged for review and will not receive an automatic zero.</p>}</div>;
      })}</div>{learners.length > 3 && <button type="button" className="button full" style={{ marginTop: 12 }} onClick={() => setShowAll((old) => !old)}><ChevronDown size={13} style={{ transform: showAll ? "rotate(180deg)" : undefined }} />{showAll ? "Show fewer learners" : `Show all ${learners.length} learners`}</button>}<p className="field-hint" style={{ marginTop: 13 }}>Confirmed blanks, missing responses and unreadable files remain distinct. TeachMate never invents missing answers.</p></section>
      <section className="form-section"><div className="form-section-heading"><span className="step-number">04</span><div><h2>Choose how to work</h2><p>Make the output work for you and your classroom.</p></div></div><div className="fields"><div className="field wide"><label htmlFor="feedback-preferences">Feedback preferences <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><textarea id="feedback-preferences" value={preferences} onChange={(event) => setPreferences(event.target.value)} maxLength={3000} rows={3} style={{ minHeight: 75 }} placeholder="e.g. Use encouraging, age-appropriate language. Include one strength and one practical next step." /></div><div className="field wide"><span className="field-label">Marking mode</span><div className="mode-options"><button type="button" className={`mode-option ${mode === "demo" ? "selected" : ""}`} onClick={() => setMode("demo")} aria-pressed={mode === "demo"}><strong><FlaskConical size={14} />Simulated demo</strong><small>Deterministic practice output. Exercises the full workflow with no model calls.</small></button><button type="button" className={`mode-option ${mode === "live" ? "selected" : ""}`} onClick={() => setMode("live")} disabled={!liveConfigured} aria-pressed={mode === "live"}><strong><Sparkles size={14} />Live model</strong><small>{liveConfigured ? "Uses your configured server-side model provider." : "Add model credentials on the server to enable live marking."}</small></button></div></div>{mode === "demo" && <div className="field wide"><label className="check-label" style={{ fontWeight: 400 }}><input type="checkbox" checked={faultInjection} onChange={(event) => setFaultInjection(event.target.checked)} />Include the labelled incorrect-total demonstration</label><span className="field-hint">Deliberately injects a calculation fault so you can watch the reviewer detect it and the corrector fix it.</span></div>}</div></section>
      {(error || warnings.length > 0 || validation) && <section className="form-section" aria-live="polite">{error && <Alert>{error}</Alert>}{warnings.length > 0 && <Alert kind="info" title="File processing notes">{warnings.map((message, index) => <p key={index}>{message}</p>)}</Alert>}{validation && <><h3 style={{ fontSize: 12, marginBottom: 13 }}>Input validation preview</h3><Alert kind={validation.valid ? "success" : "warning"} title={validation.valid ? "Your materials are ready" : "A few details need attention"}>{validation.submissionCount} submissions · {validation.rubric.length} criteria · {validation.rubric.reduce((sum, criterion) => sum + criterion.maxScore, 0)} maximum marks</Alert>{validation.rubric.map((criterion) => <div className="validation-item" key={criterion.id}><CheckCircle2 size={13} color="#7aaa96" /><div style={{ flex: 1 }}>{criterion.name}<p className="field-hint">{criterion.description}</p></div><strong style={{ fontWeight: 500 }}>{criterion.maxScore} marks</strong></div>)}{validation.issues.map((issue, index) => <div className="validation-item" key={`${issue.code}-${index}`}><Info size={13} color={issue.blocking ? "#c78b53" : "#9aa9c0"} /><div>{issue.message}{issue.blocking && <span className="badge amber" style={{ marginLeft: 7 }}>Needs attention</span>}</div></div>)}</>}</section>}
      <div className="form-bottom"><p><ShieldCheck size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Results stay private until you approve and publish.</p><div className="page-actions"><button type="button" className="button" disabled={busy || !!uploading} onClick={onCancel}>Cancel</button><button type="submit" className="button primary" disabled={busy || !!uploading || !classes.length}>{busy ? <LoaderCircle size={13} className="spin" /> : validation?.valid ? <ArrowRight size={13} /> : <FileCheck2 size={13} />}{validation?.valid ? "Create assessment" : "Validate materials"}</button></div></div>
    </form><aside className="wizard-aside"><section className="panel"><div className="panel-header"><h2>Your assignment checklist</h2><FileCheck2 size={15} color="#bd9ab0" /></div><div className="panel-body"><div className="checklist"><CheckItem done={!!title.trim() && !!classId && !!goal.trim()} title="A clear goal" description="Name, classroom and desired outcome" /><CheckItem done={!!instructions.trim()} title="Assessment instructions" description="Questions and the source material" /><CheckItem done={!!rubricText.trim()} title="A marking standard" description="Criteria with maximum marks" /><CheckItem done={provided > 0} title="Learner responses" description={`${provided} of ${learners.length} learners accounted for`} /><CheckItem done={!!validation?.valid} title="Validation complete" description="Checked before any marking begins" /></div><div className="text-divider" /><ModePill mode={mode} /><p className="field-hint" style={{ marginTop: 11 }}>You’ll see a plan before the marking run starts. Every step is saved to your workspace.</p></div></section><div className="info-note"><ShieldCheck size={17} /><div><strong>Bring the words, not the guesswork.</strong>Use text-based PDFs or TXT files. Scanned pages need OCR first. Handwriting recognition is outside this MVP.</div></div></aside></div>
  </>;
}
