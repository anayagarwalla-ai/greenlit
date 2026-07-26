"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

type Control = {
  feature: "RUNS" | "REVIEWS" | "INVOICES";
  paused: boolean;
  reason: string;
  updated_by?: string | null;
  updated_at?: string | null;
  source?: "environment" | "database" | "default" | "unavailable";
  mutable?: boolean;
};

const labels: Record<Control["feature"], string> = {
  RUNS: "Verification runs",
  REVIEWS: "Client review decisions",
  INVOICES: "Invoice creation",
};

export function OperatorPauseControls() {
  const [controls, setControls] = useState<Control[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetchWithTimeout("/api/admin/controls", { cache: "no-store" });
      const body = await response.json() as { controls?: Control[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Safety controls are unavailable.");
      const next = body.controls ?? [];
      setControls(next);
      setDrafts(Object.fromEntries(next.map((item) => [item.feature, item.reason])));
    } catch (cause) {
      setError(clientRequestMessage(cause, "Safety controls are unavailable."));
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const update = async (control: Control) => {
    const nextPaused = !control.paused;
    const reason = drafts[control.feature]?.trim() ?? "";
    if (nextPaused && reason.length < 10) {
      setError("Record a clear reason before pausing a capability.");
      return;
    }
    setBusy(control.feature);
    setError("");
    try {
      const response = await fetchWithTimeout("/api/admin/controls", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feature: control.feature, paused: nextPaused, reason }),
      });
      const body = await response.json() as { control?: Control; error?: string };
      if (!response.ok || !body.control) throw new Error(body.error ?? "The safety control could not be updated.");
      setControls((current) => current.map((item) => item.feature === control.feature ? body.control! : item));
      if (!nextPaused) setDrafts((current) => ({ ...current, [control.feature]: "" }));
    } catch (cause) {
      setError(clientRequestMessage(cause, "The safety control could not be updated."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="panel operator-section operator-pause-controls">
      <div className="operator-section__head"><div><h2>Emergency workflow controls</h2><p>Pause high-impact capabilities without removing retained records or disabling the synthetic walkthrough.</p></div><button className="mini-action" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={13} /> Refresh</button></div>
      {error && <div className="analysis-error" role="alert">{error}</div>}
      {controls.length === 0 && !error ? <p><LoaderCircle className="spin" size={13} /> Loading safety controls…</p> : controls.map((control) => (
        <article key={control.feature}>
          {control.paused ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <div>
            <strong>{labels[control.feature]}</strong>
            <p>{control.paused ? control.reason : "Available"}</p>
            {control.source === "environment" && <small>Deployment environment override. Resume it by changing the corresponding BETA_PAUSE_* setting.</small>}
            {control.source === "unavailable" && <small>The control store is unavailable, so this capability remains fail-closed.</small>}
            {control.updated_at && <small>Last changed {new Date(control.updated_at).toLocaleString()} by {control.updated_by || "operator"}</small>}
            {!control.paused && control.mutable !== false && <label>Reason if paused<input value={drafts[control.feature] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [control.feature]: event.target.value }))} maxLength={500} placeholder="Describe the incident or safety concern" /></label>}
          </div>
          <button className={`button button--small ${control.paused ? "button--outline" : "button--danger"}`} disabled={Boolean(busy) || control.mutable === false} onClick={() => void update(control)}>
            {busy === control.feature ? "Updating…" : control.mutable === false ? "Environment-controlled" : control.paused ? "Resume" : "Pause"}
          </button>
        </article>
      ))}
    </section>
  );
}
