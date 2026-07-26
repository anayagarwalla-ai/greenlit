"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";
import { formatTimestamp } from "@/lib/format";

type DemoRequest = {
  id: string;
  public_id: string;
  name: string;
  email: string;
  agency_name: string;
  role: string;
  agency_size: string;
  location: string;
  monthly_milestone_volume: string;
  approval_delay_days: number;
  staging_model: string;
  desired_next_step: string;
  current_process: string;
  status: "NEW" | "QUALIFYING" | "BOOKED" | "CLOSED" | "DECLINED";
  assigned_to?: string | null;
  internal_notes?: string | null;
  created_at: string;
};

type Draft = { status: DemoRequest["status"]; assignedTo: string; internalNotes: string };
type StatusFilter = "ALL" | DemoRequest["status"];

export function OperatorDemoRequests() {
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (options?: { append?: boolean; cursor?: string | null }) => {
    const append = options?.append === true;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams({ status: statusFilter, limit: "50" });
      if (options?.cursor) parameters.set("cursor", options.cursor);
      const response = await fetchWithTimeout(`/api/admin/demo-requests?${parameters}`, { cache: "no-store" });
      const body = await response.json() as { requests?: DemoRequest[]; nextCursor?: string | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Demo requests are unavailable.");
      const next = body.requests ?? [];
      setRequests((current) => append
        ? [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))]
        : next);
      setDrafts((current) => {
        const incoming = Object.fromEntries(next.map((item) => [item.id, {
          status: item.status,
          assignedTo: item.assigned_to ?? "",
          internalNotes: item.internal_notes ?? "",
        }]));
        return append ? { ...current, ...incoming } : incoming;
      });
      setNextCursor(body.nextCursor ?? null);
    } catch (cause) {
      setError(clientRequestMessage(cause, "Demo requests are unavailable."));
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const save = async (item: DemoRequest) => {
    const draft = drafts[item.id];
    if (!draft) return;
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const response = await fetchWithTimeout("/api/admin/demo-requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, ...draft }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The demo request could not be updated.");
      setNotice(`${item.public_id} updated.`);
      await load();
    } catch (cause) {
      setError(clientRequestMessage(cause, "The demo request could not be updated."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel operator-section operator-demo-requests">
      <div className="operator-section__head">
        <div><h2>Demo and design-partner requests</h2><p>Qualify public requests before creating beta access.</p></div>
        <div className="operator-controls">
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} disabled={Boolean(busy)}>
              <option value="ALL">All</option>
              <option value="NEW">New</option>
              <option value="QUALIFYING">Qualifying</option>
              <option value="BOOKED">Booked</option>
              <option value="CLOSED">Closed</option>
              <option value="DECLINED">Declined</option>
            </select>
          </label>
          <button className="mini-action" disabled={Boolean(busy) || loading} onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      {error && <div className="analysis-error" role="alert">{error}</div>}
      {notice && <div className="analysis-notice" role="status">{notice}</div>}
      {loading ? <p><LoaderCircle className="spin" size={13} /> Loading requests…</p> : requests.length === 0 ? <p><CheckCircle2 size={13} /> No demo requests yet.</p> : requests.map((item) => {
        const draft = drafts[item.id] ?? { status: item.status, assignedTo: "", internalNotes: "" };
        return (
          <article className="operator-work-item" key={item.id}>
            <div className="operator-request-summary">
              <span className="status-badge status-badge--neutral">{item.status}</span>
              <strong>{item.public_id} · {item.agency_name}</strong>
              <p>{item.name} · {item.role} · <a href={`mailto:${item.email}`}>{item.email}</a></p>
              <p>{item.location} · {item.agency_size} people · {item.monthly_milestone_volume} milestones/month · {item.approval_delay_days} typical approval days</p>
              <p><b>Staging:</b> {item.staging_model.replaceAll("-", " ")} · <b>Next step:</b> {item.desired_next_step.replaceAll("-", " ")}</p>
              <p>{item.current_process}</p>
              <small>{formatTimestamp(new Date(item.created_at))}</small>
            </div>
            <div className="operator-controls">
              <label>Status<select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, status: event.target.value as Draft["status"] } }))}><option>NEW</option><option>QUALIFYING</option><option>BOOKED</option><option>CLOSED</option><option>DECLINED</option></select></label>
              <label>Owner<input value={draft.assignedTo} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, assignedTo: event.target.value } }))} /></label>
              <label>Internal notes<textarea value={draft.internalNotes} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, internalNotes: event.target.value } }))} /></label>
              <button className="button button--ink button--small" disabled={busy === item.id} onClick={() => void save(item)}>{busy === item.id ? "Saving…" : "Save request"}</button>
            </div>
          </article>
        );
      })}
      {!loading && nextCursor && <button className="button button--outline button--small" disabled={loadingMore || Boolean(busy)} onClick={() => void load({ append: true, cursor: nextCursor })}>
        {loadingMore ? <><LoaderCircle className="spin" size={13} /> Loading more…</> : "Load more requests"}
      </button>}
    </section>
  );
}
