"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, LoaderCircle, RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatTimestamp } from "@/lib/format";

type Feedback = { id: string; public_id: string; email?: string | null; category: string; message: string; page_path: string; status: string; created_at: string };
type PrivacyRecord = { id: string; public_id: string; agency_name: string; client_name: string; project_name: string; milestone_title: string; status: string; legal_hold: boolean; retention_until: string; privacy_deletion_requested_at?: string | null; deletion_status: string };
type Privacy = { id: string; public_id: string; request_type: string; email: string; details?: string | null; status: string; assigned_to?: string | null; internal_notes?: string | null; identity_verified_at?: string | null; response_summary?: string | null; response_sent_at?: string | null; matchedRecords: PrivacyRecord[]; created_at: string };
type Job = { id: string; record_id: string; status: string; build_label: string; target_origin: string; last_error?: string | null; acknowledged_at?: string | null; created_at: string };
type Notification = { id: string; event_type: string; title: string; delivery_status: string; delivery_error?: string | null; delivery_attempts?: number; created_at: string };
type Item = Record<string, unknown> & { id: string | number; created_at: string };
type Payload = { operator: string; summary: { newFeedback: number; activeJobIssues: number; openPrivacyRequests: number; runsLast24Hours: number }; feedback: Feedback[]; events: Item[]; jobs: Job[]; privacy: Privacy[]; notifications: Notification[]; error?: string };

export function OperatorConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [privacyDrafts, setPrivacyDrafts] = useState<Record<string, { status: string; assignedTo: string; internalNotes: string; identityVerified: boolean; responseSummary: string; responseSent: boolean }>>({});
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, { recordId: string; fieldName: "agency_name" | "client_name" | "project_name" | "milestone_title"; correctedValue: string; reason: string }>>({});
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "Operator overview unavailable.");
      setData(payload);
      setPrivacyDrafts(Object.fromEntries(payload.privacy.map((item) => [item.id, { status: item.status, assignedTo: item.assigned_to ?? "", internalNotes: item.internal_notes ?? "", identityVerified: Boolean(item.identity_verified_at), responseSummary: item.response_summary ?? "", responseSent: Boolean(item.response_sent_at) }])));
      setCorrectionDrafts(Object.fromEntries(payload.privacy.map((item) => [item.id, { recordId: item.matchedRecords[0]?.id ?? "", fieldName: "project_name" as const, correctedValue: "", reason: "" }])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operator overview unavailable."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const update = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; affected?: number; amendmentId?: string };
      if (!response.ok) throw new Error(payload.error ?? "Operator update failed.");
      if (typeof payload.affected === "number") setNotice(`${payload.affected} matched record${payload.affected === 1 ? "" : "s"} updated.`);
      else if (payload.amendmentId) setNotice("Append-only correction recorded in the transaction audit trail.");
      else setNotice("Operator update recorded.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Operator update failed."); }
    finally { setBusy(""); }
  };
  if (!data && !error) return <main className="dashboard-shell"><section className="review-state"><LoaderCircle className="spin" /><h1>Loading beta operations</h1></section></main>;
  if (!data) return <main className="dashboard-shell"><section className="review-state"><FileWarning /><h1>Operator console unavailable</h1><p>{error}</p><button className="button button--outline" onClick={() => void load()}>Retry</button></section></main>;
  return <main className="dashboard-shell"><header className="dashboard-header"><Brand /><div>{data.operator}<button className="button button--small button--outline" disabled={busy === "refresh"} onClick={() => void load()}><RefreshCw size={13} /> Refresh</button></div></header><div className="dashboard-main"><section className="dashboard-heading"><div><div className="legal-kicker">Private operator console</div><h1>Beta operations</h1><p>Feedback, unresolved jobs, privacy requests, and delivery failures in one view.</p></div></section>{error && <div className="analysis-error" role="alert">{error}</div>}{notice && <div className="analysis-notice" role="status">{notice}</div>}<div className="operator-summary"><div><span>New feedback</span><strong>{data.summary.newFeedback}</strong></div><div><span>Job issues</span><strong>{data.summary.activeJobIssues}</strong></div><div><span>Privacy queue</span><strong>{data.summary.openPrivacyRequests}</strong></div><div><span>Runs / 24h</span><strong>{data.summary.runsLast24Hours}</strong></div></div>
    <section className="panel operator-section"><h2>Beta feedback</h2>{data.feedback.length === 0 ? <Empty /> : data.feedback.map((item) => <article key={item.id}><div><span className="status-badge status-badge--neutral">{item.category}</span><strong>{item.public_id} · {item.page_path}</strong><p>{item.message}</p><small>{item.email || "Anonymous"} · {formatTimestamp(new Date(item.created_at))}</small></div><select aria-label={`Status for ${item.public_id}`} value={item.status} disabled={busy === `feedback:${item.id}`} onChange={(event) => void update(`feedback:${item.id}`, { kind: "feedback", id: item.id, status: event.target.value })}><option>NEW</option><option>REVIEWING</option><option>RESOLVED</option><option>CLOSED</option></select></article>)}</section>
    <section className="panel operator-section"><h2>Privacy requests</h2>{data.privacy.length === 0 ? <Empty /> : data.privacy.map((item) => {
      const draft = privacyDrafts[item.id] ?? { status: item.status, assignedTo: "", internalNotes: "", identityVerified: Boolean(item.identity_verified_at), responseSummary: "", responseSent: Boolean(item.response_sent_at) };
      const correction = correctionDrafts[item.id] ?? { recordId: item.matchedRecords[0]?.id ?? "", fieldName: "project_name" as const, correctedValue: "", reason: "" };
      const anyHold = item.matchedRecords.some((record) => record.legal_hold);
      return <article className="operator-work-item" key={item.id}><div className="operator-request-summary"><strong>{item.request_type} · {item.public_id}</strong><p><b>Requester:</b> {item.email}</p><p>{item.details || "No requester details supplied."}</p><small>{formatTimestamp(new Date(item.created_at))}</small><div className="operator-record-matches"><b>{item.matchedRecords.length} matched retained record{item.matchedRecords.length === 1 ? "" : "s"}</b>{item.matchedRecords.map((record) => <span key={record.id}>{record.public_id} · {record.project_name} · {record.status}{record.legal_hold ? " · HOLD" : ""}{record.privacy_deletion_requested_at ? " · DELETION SCHEDULED" : ""}</span>)}</div></div><div className="operator-controls">
        <label>Status<select value={draft.status} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, status: event.target.value } }))}><option>RECEIVED</option><option>VERIFYING</option><option>PROCESSING</option><option>COMPLETED</option><option>DENIED</option></select></label>
        <label>Owner<input value={draft.assignedTo} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, assignedTo: event.target.value } }))} /></label>
        <label className="operator-checkbox"><input type="checkbox" checked={draft.identityVerified} disabled={Boolean(item.identity_verified_at)} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, identityVerified: event.target.checked } }))} /><span>Requester identity verified</span></label>
        <label>Internal notes<textarea value={draft.internalNotes} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, internalNotes: event.target.value } }))} /></label>
        <label>Final response summary<textarea value={draft.responseSummary} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, responseSummary: event.target.value } }))} /></label>
        <label className="operator-checkbox"><input type="checkbox" checked={draft.responseSent} onChange={(event) => setPrivacyDrafts((current) => ({ ...current, [item.id]: { ...draft, responseSent: event.target.checked } }))} /><span>Final response sent to requester</span></label>
        <div className="operator-inline-actions"><button className="button button--ink button--small" disabled={busy === `privacy:${item.id}`} onClick={() => void update(`privacy:${item.id}`, { kind: "privacy", id: item.id, ...draft })}>Save request</button><a className="button button--outline button--small" href={`/api/admin/privacy-export/${encodeURIComponent(item.id)}`}>Export verified data</a></div>
        <div className="operator-inline-actions"><button className="button button--outline button--small" disabled={!draft.identityVerified || item.matchedRecords.length === 0 || Boolean(busy)} onClick={() => void update(`hold:${item.id}`, { kind: "privacy_hold", id: item.id, enabled: !anyHold })}>{anyHold ? "Release legal hold" : "Apply legal hold"}</button><button className="button button--outline button--small" disabled={!draft.identityVerified || item.matchedRecords.length === 0 || Boolean(busy)} onClick={() => { if (window.confirm("Schedule these records for deletion when their legal retention periods permit it? This does not erase retained legal records early.")) void update(`delete:${item.id}`, { kind: "privacy_deletion", id: item.id }); }}>Schedule lawful deletion</button></div>
        {item.matchedRecords.length > 0 && <fieldset className="operator-correction"><legend>Append-only correction</legend><label>Record<select value={correction.recordId} onChange={(event) => setCorrectionDrafts((current) => ({ ...current, [item.id]: { ...correction, recordId: event.target.value } }))}>{item.matchedRecords.map((record) => <option key={record.id} value={record.id}>{record.public_id} · {record.project_name}</option>)}</select></label><label>Field<select value={correction.fieldName} onChange={(event) => setCorrectionDrafts((current) => ({ ...current, [item.id]: { ...correction, fieldName: event.target.value as typeof correction.fieldName } }))}><option value="agency_name">Agency name</option><option value="client_name">Client name</option><option value="project_name">Project name</option><option value="milestone_title">Milestone title</option></select></label><label>Corrected value<input value={correction.correctedValue} onChange={(event) => setCorrectionDrafts((current) => ({ ...current, [item.id]: { ...correction, correctedValue: event.target.value } }))} /></label><label>Reason<textarea value={correction.reason} onChange={(event) => setCorrectionDrafts((current) => ({ ...current, [item.id]: { ...correction, reason: event.target.value } }))} /></label><button className="button button--outline button--small" disabled={!draft.identityVerified || !correction.correctedValue.trim() || !correction.reason.trim() || Boolean(busy)} onClick={() => void update(`correction:${item.id}`, { kind: "privacy_correction", id: item.id, ...correction })}>Record correction</button></fieldset>}
      </div></article>;
    })}</section>
    <section className="panel operator-section"><h2>Verification job issues</h2>{data.jobs.length === 0 ? <Empty /> : data.jobs.map((item) => <article key={item.id}><AlertTriangle size={15} /><div><strong>{item.status} · {item.build_label}</strong><p>{item.last_error || `${item.target_origin} has remained active longer than expected.`}</p><small>{item.acknowledged_at ? `Acknowledged ${formatTimestamp(new Date(item.acknowledged_at))}` : formatTimestamp(new Date(item.created_at))}</small></div><div className="operator-inline-actions"><button className="button button--outline button--small" onClick={() => void update(`ack:${item.id}`, { kind: "job", id: item.id, action: "acknowledge" })}>Acknowledge</button>{item.status === "FAILED" && <button className="button button--ink button--small" onClick={() => void update(`retry:${item.id}`, { kind: "job", id: item.id, action: "retry" })}>Retry safely</button>}</div></article>)}</section>
    <section className="panel operator-section"><h2>Notification delivery</h2>{data.notifications.length === 0 ? <Empty /> : data.notifications.map((item) => <article key={item.id}><AlertTriangle size={15} /><div><strong>{item.delivery_status} · {item.title}</strong><p>{item.delivery_error || `Delivery attempts: ${item.delivery_attempts ?? 0}`}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div><button className="button button--outline button--small" onClick={() => void update(`notification:${item.id}`, { kind: "notification", id: item.id, action: "retry" })}>Retry delivery</button></article>)}</section>
    <OperatorList title="Operational events" items={data.events} />
  </div></main>;
}

function Empty() { return <p><CheckCircle2 size={13} /> Nothing needs attention.</p>; }
function OperatorList({ title, items }: { title: string; items: Item[] }) {
  return <section className="panel operator-section"><h2>{title}</h2>{items.length === 0 ? <Empty /> : items.map((item) => <article key={String(item.id)}><AlertTriangle size={15} /><div><strong>{String(item.event_type ?? item.status ?? item.id)}</strong><p>{typeof (item.details ?? item.title) === "string" ? String(item.details ?? item.title) : JSON.stringify(item.details ?? "Review this event")}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div></article>)}</section>;
}
