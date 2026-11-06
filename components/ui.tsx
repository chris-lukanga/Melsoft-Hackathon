import { AlertCircle, Check, CheckCircle2, FileText, Info, LoaderCircle, X } from "lucide-react";
import { displayStatus } from "./api";
import type { ReactNode } from "react";

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const colors: Record<string, string> = { completed: "green", corrected: "green", approved: "green", published: "green", delivered: "green", running: "pink", queued: "purple", draft: "purple", ready: "purple", needs_review: "amber", needs_input: "amber", failed: "red", cancelled: "", missing: "amber", unreadable: "red", blank: "", received: "green", pending: "", revision_requested: "amber" };
  return <span className={`badge ${colors[status] || ""}`}><span className="badge-dot" />{children || displayStatus(status)}</span>;
}

export function Alert({ children, kind = "error", title, onDismiss }: { children: ReactNode; kind?: "error" | "info" | "warning" | "success"; title?: string; onDismiss?: () => void }) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "info" ? Info : AlertCircle;
  return <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}><Icon size={15} /><div className="alert-content">{title && <strong>{title}</strong>}{children}</div>{onDismiss && <button type="button" className="alert-dismiss" aria-label="Dismiss message" onClick={onDismiss}><X size={14} /></button>}</div>;
}

export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={24} strokeWidth={1.5} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Loading({ children = "Opening your workspace…" }: { children?: ReactNode }) {
  return <div className="loading-page" role="status"><LoaderCircle size={28} className="spin" strokeWidth={1.7} /><p>{children}</p></div>;
}

export function ModePill({ mode = "demo" }: { mode?: "demo" | "live" }) {
  return <span className={`mode-pill ${mode === "live" ? "live" : ""}`}><span className="dot" />{mode === "demo" ? "SIMULATED DEMO" : "LIVE MODEL"}</span>;
}

export function CheckItem({ done, title, description }: { done: boolean; title: string; description: string }) {
  return <div className="checklist-row"><span className={`check-circle ${done ? "done" : ""}`}>{done ? <Check size={10} /> : <span style={{ fontSize: 10 }}>•</span>}</span><div><strong>{title}</strong><small>{description}</small></div></div>;
}
