"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, LoaderCircle, RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatTimestamp } from "@/lib/format";

type Feedback = { id: string; public_id: string; email?: string | null; category: string; message: string; page_path: string; status: string; created_at: string };
type Item = Record<string, unknown> & { id: string | number; created_at: string };
type Payload = { operator: string; summary: { newFeedback: number; activeJobIssues: number; openPrivacyRequests: number; runsLast24Hours: number }; feedback: Feedback[]; events: Item[]; jobs: Item[]; privacy: Item[]; notifications: Item[]; error?: string };

export function OperatorConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); const response = await fetch("/api/admin/overview", { cache: "no-store" }); const payload = await response.json() as Payload; if (!response.ok) setError(payload.error ?? "Operator overview unavailable."); else setData(payload); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const updateFeedback = async (id: string, status: string) => { await fetch("/api/admin/overview", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ feedbackId: id, status }) }); await load(); };
  if (!data && !error) return <main className="dashboard-shell"><section className="review-state"><LoaderCircle className="spin" /><h1>Loading beta operations</h1></section></main>;
  if (!data) return <main className="dashboard-shell"><section className="review-state"><FileWarning /><h1>Operator console unavailable</h1><p>{error}</p></section></main>;
  return <main className="dashboard-shell"><header className="dashboard-header"><Brand /><div>{data.operator}<button className="button button--small button--outline" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button></div></header><div className="dashboard-main"><section className="dashboard-heading"><div><div className="legal-kicker">Private operator console</div><h1>Beta operations</h1><p>Feedback, unresolved jobs, privacy requests, and delivery failures in one view.</p></div></section><div className="operator-summary"><div><span>New feedback</span><strong>{data.summary.newFeedback}</strong></div><div><span>Job issues</span><strong>{data.summary.activeJobIssues}</strong></div><div><span>Privacy queue</span><strong>{data.summary.openPrivacyRequests}</strong></div><div><span>Runs / 24h</span><strong>{data.summary.runsLast24Hours}</strong></div></div>
  <section className="panel operator-section"><h2>Beta feedback</h2>{data.feedback.length === 0 ? <p>No feedback yet.</p> : data.feedback.map((item) => <article key={item.id}><div><span className="status-badge status-badge--neutral">{item.category}</span><strong>{item.public_id} · {item.page_path}</strong><p>{item.message}</p><small>{item.email || "Anonymous"} · {formatTimestamp(new Date(item.created_at))}</small></div><select aria-label={`Status for ${item.public_id}`} value={item.status} onChange={(event) => void updateFeedback(item.id, event.target.value)}><option>NEW</option><option>REVIEWING</option><option>RESOLVED</option><option>CLOSED</option></select></article>)}</section>
  <OperatorList title="Verification job issues" items={data.jobs} /><OperatorList title="Open privacy requests" items={data.privacy} /><OperatorList title="Operational events" items={data.events} /><OperatorList title="Notification delivery" items={data.notifications} /></div></main>;
}

function OperatorList({ title, items }: { title: string; items: Item[] }) {
  const describe = (item: Item) => {
    const detail = item.last_error ?? item.details ?? item.title ?? item.email ?? "Review this item";
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  };
  return <section className="panel operator-section"><h2>{title}</h2>{items.length === 0 ? <p><CheckCircle2 size={13} /> Nothing needs attention.</p> : items.map((item) => <article key={String(item.id)}><AlertTriangle size={15} /><div><strong>{String(item.event_type ?? item.request_type ?? item.status ?? item.id)}</strong><p>{describe(item)}</p><small>{formatTimestamp(new Date(item.created_at))}</small></div></article>)}</section>;
}
