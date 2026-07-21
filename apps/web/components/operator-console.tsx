"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, LoaderCircle, RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatTimestamp } from "@/lib/format";

type Feedback = { id: string; public_id: string; email?: string | null; category: string; message: string; page_path: string; status: string; created_at: string };
type Privacy = { id: string; public_id: string; request_type: string; email: string; details?: string | null; status: string; assigned_to?: string | null; internal_notes?: string | null; created_at: string };
type Job = { id: string; record_id: string; status: string; build_label: string; target_origin: string; last_error?: string | null; acknowledged_at?: string | null; created_at: string };
type Notification = { id: string; event_type: string; title: string; delivery_status: string; delivery_error?: string | null; delivery_attempts?: number; created_at: string };
type Item = Record<string, unknown> & { id: string | number; created_at: string };
type Payload = { operator: string; summary: { newFeedback: number; activeJobIssues: number; openPrivacyRequests: number; runsLast24Hours: number }; feedback: Feedback[]; events: Item[]; jobs: Job[]; privacy: Privacy[]; notifications: Notification[]; error?: string };

export function OperatorConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [privacyDrafts, setPrivacyDrafts] = useState<Record<string, { status: string; assignedTo: string; internalNotes: string }>>({});
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Operator overview unavailable.");
      setData(payload);
      setPrivacyDrafts(Object.fromEntries(payload.privacy.map((item) => [item.id, { status: item.status, assignedTo: item.assigned_to ?? "", internalNotes: item.internal_notes ?? "" }])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operator overview unavailable."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const update = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Operator update failed.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operator update failed."); }
    finally { setBusy(""); }
  };
  if (!data && !error) return <main className="dashboard-shell"><section className="review-state"><LoaderCircle className="spin" /><h1>Loading beta operations</h1></section></main>;
  if (!data) return <main className="dashboard-shell"><section className="review-state"><FileWarning /><h1>Operator console unavailable</h1><p>{error}</p><button className="button button--outline" onClick={() => void load()}>Retry</button></section></main>;
  return <main className="dashboard-shell"><header className="dashboard-header"><Brand /><div>{data.operator}<button className="button button--small button--outline" disabled={busy === "refresh"} onClick={() => void load()}><RefreshCw size={13} /> Refresh</button></div></header><div className="dashboard-main"><section className="dashboard-heading"><div><div className="legal-kicker">Private operator console</div><h1>Beta operations</h1><p>Feedback, unresolved jobs, privacy requests, and delivery failures in one view.</p></div></section>{error && <div className="analysis-error" role="alert">{error}</div>}<div className="operator-summary"><div><span>New feedback</span><strong>{data.summary.newFeedback}</strong></div><div><span>Job issues</span><strong>{data.summary.activeJobIssues}</strong></div><div><span>Privacy queue</span><strong>{data.summary.openPrivacyRequests}</strong></div><div><span>Runs / 24h</span><strong>{data.summary.runsLast24Hours}</strong></div></div>
    <section className="panel operator-section"><h2>Beta feedback</h2>{data.feedback.length === 0 ? <Empty /> : data.feedback.map((item) => <article key={item.id}><div><span className="status-badge status-badge--neutral">{item.category}</span><strong>{item.public_id} · {item.page_path}</strong><p>{item.message}</p><small>{item.email || "Anonymous"} · {formatTimestamp(new Date(item.created_at))}</small></div><select aria-label={`Status for ${item.public_id}`} value={item.status} disabled={busy === `feedback:${item.id}`} onChange={(event) => void update(`feedback:${item.id}`, { kind: "feedback", id: item.id, status: event.target.value })}><option>NEW</option><option>REVIEWING</option><option>RESOLVED</option><option>CLOSED</option></select></article>)}</section>
    <section className="panel operator-section"><h2>Open privacy requests</h2>{data.privacy.length === 0 ? <Empty /> : data.privacy.map((item) => { const draft = privacyDrafts[item.id] ?? { status: item.status, assignedTo: "", internalNotes: "" }; return <article className="operator-work-item" key={item.id}><div><strong>{item.request_type} · {item.public_id}</strong><p><b>Requester:</b> {item.email}</p><p>{item.details || "No requester details supplied."}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div><div className="operator-controls"><label>Status<select value={draft.status} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, status: event.target.value } }))}><option>RECEIVED</option><option>VERIFYING</option><option>PROCESSING</option><option>COMPLETED</option><option>DENIED</option></select></label><label>Owner<input value={draft.assignedTo} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, assignedTo: event.target.value } }))} /></label><label>Internal notes<textarea value={draft.internalNotes} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, internalNotes: event.target.value } }))} /></label><button className="button button--ink button--small" disabled={busy === `privacy:${item.id}`} onClick={() => void update(`privacy:${item.id}`, { kind: "privacy", id: item.id, ...draft })}>Save request</button></div></article>; })}</section>
    <section className="panel operator-section"><h2>Verification job issues</h2>{data.jobs.length === 0 ? <Empty /> : data.jobs.map((item) => <article key={item.id}><AlertTriangle size={15} /><div><strong>{item.status} · {item.build_label}</strong><p>{item.last_error || `${item.target_origin} has remained active longer than expected.`}</p><small>{item.acknowledged_at ? `Acknowledged ${formatTimestamp(new Date(item.acknowledged_at))}` : formatTimestamp(new Date(item.created_at))}</small></div><div className="operator-inline-actions"><button className="button button--outline button--small" onClick={() => void update(`ack:${item.id}`, { kind: "job", id: item.id, action: "acknowledge" })}>Acknowledge</button>{item.status === "FAILED" && <button className="button button--ink button--small" onClick={() => void update(`retry:${item.id}`, { kind: "job", id: item.id, action: "retry" })}>Retry safely</button>}</div></article>)}</section>
    <section className="panel operator-section"><h2>Notification delivery</h2>{data.notifications.length === 0 ? <Empty /> : data.notifications.map((item) => <article key={item.id}><AlertTriangle size={15} /><div><strong>{item.delivery_status} · {item.title}</strong><p>{item.delivery_error || `Delivery attempts: ${item.delivery_attempts ?? 0}`}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div><button className="button button--outline button--small" onClick={() => void update(`notification:${item.id}`, { kind: "notification", id: item.id, action: "retry" })}>Retry delivery</button></article>)}</section>
    <OperatorList title="Operational events" items={data.events} />
  </div></main>;
}

function Empty() { return <p><CheckCircle2 size={13} /> Nothing needs attention.</p>; }
function OperatorList({ title, items }: { title: string; items: Item[] }) {
  return <section className="panel operator-section"><h2>{title}</h2>{items.length === 0 ? <Empty /> : items.map((item) => <article key={String(item.id)}><AlertTriangle size={15} /><div><strong>{String(item.event_type ?? item.status ?? item.id)}</strong><p>{typeof (item.details ?? item.title) === "string" ? String(item.details ?? item.title) : JSON.stringify(item.details ?? "Review this event")}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div></article>)}</section>;
}
