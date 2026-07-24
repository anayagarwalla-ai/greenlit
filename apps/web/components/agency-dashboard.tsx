"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, Check, Clipboard, Clock3, CreditCard, ExternalLink, FileCheck2, History, LoaderCircle, LogOut, ReceiptText, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatTimestamp } from "@/lib/format";
import { signOutAndClearDraftState } from "@/lib/client-storage";
import { canCreateReviewLink } from "@/lib/review-lifecycle";
import { InvoicePlanCard } from "@/components/invoice-plan-card";

type Run = { id: string; status: string; build_label: string; build_url: string; last_error?: string | null; completed_at?: string | null; created_at: string };
type Review = { public_id: string; decision?: "APPROVED" | "CHANGES_REQUESTED" | null; reviewer_name?: string | null; reviewer_email?: string | null; reviewer_note?: string | null; decided_at?: string | null; expires_at: string; revoked_at?: string | null; created_at: string };
type Invoice = { id: string; status: string; invoice_number?: string | null; amount_due_minor: number; amount_paid_minor: number; currency: string; billing_email: string; due_at?: string | null; hosted_invoice_url?: string | null; invoice_pdf_url?: string | null; sent_at?: string | null; paid_at?: string | null; last_error?: string | null };
type InvoiceJob = { id: string; status: string; attempts: number; last_error?: string | null; updated_at: string };
type Correction = { record_id: string; field_name: string; corrected_value: string; reason: string; created_at: string };
type RecordItem = { id: string; public_id: string; agency_name: string; client_name: string; project_name: string; milestone_title: string; amount_minor: number; currency: string; target_origin: string; revision: number; status: string; updated_at: string; latestRun?: Run | null; latestReview?: Review | null; latestInvoice?: Invoice | null; latestInvoiceJob?: InvoiceJob | null; invoicePlan?: { auto_send: boolean; billing_email: string; days_until_due: number } | null; corrections?: Correction[] | null };
type Notice = { id: string; record_id?: string | null; event_type: string; title: string; body: string; read_at?: string | null; created_at: string };
type DashboardPayload = { user: { id: string; email?: string }; stripe: { configured: boolean; connection: null | { accountId: string; livemode: boolean; status: string; lastError?: string | null } }; records: RecordItem[]; notifications: Notice[]; error?: string };
type ShareGrant = { url: string; accessCode: string; recipientEmail: string };

const money = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);

function invoiceStatusLine(invoice: Invoice): string {
  const status = invoice.status.toUpperCase();
  // A DRAFT invoice exists in Stripe but was never emailed — say "created",
  // never "sent".
  if (status === "DRAFT") return `Draft invoice ${invoice.invoice_number ?? "created"} — created in Stripe, not emailed`;
  if (status === "OPEN") return `Invoice ${invoice.invoice_number ?? ""} sent`.replace("  ", " ");
  if (status === "PAID") return `Invoice ${invoice.invoice_number ?? ""} paid`.replace("  ", " ");
  return `Invoice ${invoice.invoice_number ?? ""} · ${invoice.status.toLowerCase()}`.replace("  ", " ");
}

export function AgencyDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [reviewLinks, setReviewLinks] = useState<Record<string, ShareGrant>>({});
  const [receiptLinks, setReceiptLinks] = useState<Record<string, ShareGrant>>({});
  const [invoiceRecord, setInvoiceRecord] = useState<RecordItem | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const invoiceDialogRef = useRef<HTMLElement>(null);
  const invoiceTriggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account/records", { cache: "no-store" });
      const payload = await response.json() as DashboardPayload;
      if (response.status === 401 || response.status === 403) {
        setAuthError(payload.error ?? "Sign in to open the agency dashboard.");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "The dashboard could not be loaded.");
      setAuthError("");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof TypeError || cause instanceof SyntaxError ? "The dashboard could not be loaded because of a network problem. Your records are unchanged — retry when you are back online." : cause instanceof Error ? cause.message : "The dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  // The invoice dialog is a real modal: Escape closes it, Tab is trapped
  // inside it, and focus returns to the button that opened it.
  useEffect(() => {
    if (!invoiceRecord) return;
    const node = invoiceDialogRef.current;
    node?.querySelector<HTMLElement>("h2")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setInvoiceRecord(null); return; }
      if (event.key !== "Tab" || !node) return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      const heading = node.querySelector<HTMLElement>("h2");
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!node.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); invoiceTriggerRef.current?.focus(); };
  }, [invoiceRecord]);

  const createReview = async (record: RecordItem) => {
    if (!record.latestRun) return;
    const reviewerEmail = window.prompt("Client business email for this one-time review", record.invoicePlan?.billing_email ?? record.latestReview?.reviewer_email ?? "")?.trim();
    if (!reviewerEmail) return;
    setBusy(`review:${record.id}`);
    setError("");
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId: record.id, runId: record.latestRun.id, reviewerEmail }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "A new review link could not be created.");
      setReviewLinks((current) => ({ ...current, [record.id]: { url: payload.reviewUrl, accessCode: payload.accessCode, recipientEmail: payload.reviewerEmail } }));
      try { await navigator.clipboard.writeText(payload.reviewUrl); setCopied(record.id); } catch { setCopied(""); setError("Review created, but clipboard access is unavailable. Copy the visible link manually."); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A new review link could not be created."); }
    finally { setBusy(""); }
  };

  const reviewAction = async (record: RecordItem, action: "revoke" | "extend") => {
    if (!record.latestReview) return;
    setBusy(`${action}:${record.id}`);
    try {
      const response = await fetch(`/api/account/reviews/${encodeURIComponent(record.latestReview.public_id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The review could not be updated.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The review could not be updated."); }
    finally { setBusy(""); }
  };

  const createReceiptLink = async (record: RecordItem) => {
    if (!record.latestReview?.decision) return;
    const recipientEmail = window.prompt("Business email authorized to open this one-time receipt", record.latestReview.reviewer_email ?? record.invoicePlan?.billing_email ?? "")?.trim();
    if (!recipientEmail) return;
    setBusy(`receipt:${record.id}`); setError("");
    try {
      const response = await fetch(`/api/account/reviews/${encodeURIComponent(record.latestReview.public_id)}/receipt-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientEmail }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The authorized receipt link could not be created.");
      setReceiptLinks((current) => ({ ...current, [record.id]: { url: payload.receiptUrl, accessCode: payload.accessCode, recipientEmail: payload.recipientEmail } }));
      try { await navigator.clipboard.writeText(payload.receiptUrl); setCopied(`receipt:${record.id}`); }
      catch { setCopied(""); setError("Receipt link created, but clipboard access is unavailable. Select and copy the visible link manually."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The authorized receipt link could not be created."); }
    finally { setBusy(""); }
  };

  const markNotificationsRead = async () => {
    setBusy("notifications");
    setError("");
    try {
      const response = await fetch("/api/account/records", { method: "PATCH" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? "Notifications could not be marked read.");
      }
      await load();
    } catch (cause) { setError(cause instanceof TypeError || cause instanceof SyntaxError ? "Notifications could not be marked read because of a network problem. They are unchanged." : cause instanceof Error ? cause.message : "Notifications could not be marked read."); }
    finally { setBusy(""); }
  };

  const disconnectStripe = async () => {
    if (!window.confirm("Disconnect Stripe from Greenlit? Existing invoices stay in Stripe and in retained records.")) return;
    setBusy("stripe-disconnect");
    setError("");
    try {
      const response = await fetch("/api/account/stripe", { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? "Stripe could not be disconnected.");
      }
      await load();
    } catch (cause) { setError(cause instanceof TypeError || cause instanceof SyntaxError ? "Stripe could not be disconnected because of a network problem. The connection is unchanged." : cause instanceof Error ? cause.message : "Stripe could not be disconnected."); }
    finally { setBusy(""); }
  };

  const signOut = async () => {
    setBusy("sign-out");
    setError("");
    try {
      // Only clears this account's local draft/review state once the server
      // actually ended the session; a failed sign-out must not erase work.
      const signedOut = await signOutAndClearDraftState(data?.user.email);
      if (!signedOut) throw new Error("Sign-out failed. You are still signed in and your local draft was kept.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof TypeError || cause instanceof SyntaxError ? "Sign-out failed because of a network problem. You are still signed in and your local draft was kept." : cause instanceof Error ? cause.message : "Sign-out failed. You are still signed in and your local draft was kept.");
      setBusy("");
    }
  };

  if (loading && !data) return <main className="dashboard-shell"><section className="review-state"><div className="loader-orbit" /><h1>Opening agency dashboard</h1><p>Loading your retained milestone records and client decisions.</p></section></main>;
  if (authError) return <main className="dashboard-shell"><section className="review-state"><ShieldCheck size={34} /><h1>Sign in required</h1><p>{authError}</p><Link className="button button--lime" href={"/login" as Route}>Agency sign in</Link></section></main>;
  if (!data) return <main className="dashboard-shell"><section className="review-state"><ShieldCheck size={34} /><h1>Dashboard unavailable</h1><p role="alert">{error || "The dashboard could not be loaded."}</p><button className="button button--lime" onClick={() => void load()}><RefreshCw size={15} /> Retry</button></section></main>;

  const unread = data.notifications.filter((item) => !item.read_at);
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header"><Brand /><div><span>{data.user.email}</span><button className="button button--outline button--small" onClick={() => void signOut()} disabled={busy === "sign-out"}>{busy === "sign-out" ? <LoaderCircle className="spin" size={13} /> : <LogOut size={13} />} Sign out</button></div></header>
      <div className="dashboard-main">
        <section className="dashboard-heading"><div><div className="legal-kicker">Closed agency beta</div><h1>Your milestone proofs</h1><p>Resume projects, watch client decisions, and keep approval and invoice records accessible across devices.</p></div><div className="dashboard-heading__actions">{data.stripe.configured && data.stripe.connection?.status !== "CONNECTED" && <a className="button button--outline" href="/api/stripe/install"><CreditCard size={15} /> Connect Stripe</a>}<Link className="button button--lime" href="/workspace">New milestone <ArrowRight size={15} /></Link></div></section>
        {data.stripe.configured && data.stripe.connection?.status === "CONNECTED" && <div className="stripe-account-banner" role="status"><CreditCard size={15} /><span>Stripe {data.stripe.connection.livemode ? "live" : "test"} mode connected · {data.stripe.connection.accountId}</span><button className="text-action" onClick={() => void disconnectStripe()} disabled={busy === "stripe-disconnect"}>{busy === "stripe-disconnect" ? "Disconnecting…" : "Disconnect"}</button></div>}

        {unread.length > 0 && <section className="panel notification-panel"><div className="panel-header"><div><h2><Bell size={17} /> Recent client activity</h2><p>Remote decisions appear here even when the client used a different device.</p></div><button className="mini-action" onClick={() => void markNotificationsRead()} disabled={busy === "notifications"}>{busy === "notifications" ? "Marking…" : "Mark read"}</button></div>{unread.slice(0, 5).map((notice) => <article key={notice.id}><strong>{notice.title}</strong><span>{notice.body}</span><time>{formatTimestamp(new Date(notice.created_at))}</time></article>)}</section>}

        {error && <div className="analysis-error" role="alert">{error}</div>}
        {data.records.length === 0 ? <section className="panel dashboard-empty"><FileCheck2 size={34} /><h2>No retained milestones yet</h2><p>Create a proof from a SOW you are authorized to process, connect an authorized staging origin, and run the confirmed checks.</p><Link className="button button--lime" href="/workspace">Create the first milestone</Link></section> : <section className="record-grid">{data.records.map((record) => {
          const review = record.latestReview;
          const expired = review ? new Date(review.expires_at).getTime() <= renderedAt : false;
          const canCreateReview = canCreateReviewLink(record.status, record.latestRun?.status, review, renderedAt);
          const noCharge = record.amount_minor <= 0;
          return <article className="panel record-card" key={record.id}>
            <div className="record-card__top"><span className="status-badge status-badge--neutral">{record.status.replaceAll("_", " ")}</span><span>{record.public_id}</span></div>
            <h2>{record.milestone_title}</h2><p>{record.project_name} · {record.client_name}</p>
            <div className="record-card__facts"><div><span>Value</span><strong>{money(record.amount_minor, record.currency)}</strong></div><div><span>Target</span><strong>{new URL(record.target_origin).hostname}</strong></div><div><span>Updated</span><strong>{formatTimestamp(new Date(record.updated_at))}</strong></div></div>
            {review && <div className={`review-status ${review.decision === "APPROVED" ? "is-approved" : ""}`}><div><strong>{review.decision === "APPROVED" ? "Client approved" : review.decision === "CHANGES_REQUESTED" ? "Changes requested" : review.revoked_at ? "Review revoked" : expired ? "Review expired" : "Awaiting client"}</strong><span>{review.decided_at ? `${review.reviewer_name} · ${formatTimestamp(new Date(review.decided_at))}` : `Expires ${formatTimestamp(new Date(review.expires_at))}`}</span>{review.decision === "CHANGES_REQUESTED" && <p>{review.reviewer_note || "The client did not include a note."}</p>}</div>{review.decision === "APPROVED" && <Link href={`/receipt/${review.public_id}`}>Open record <ExternalLink size={13} /></Link>}</div>}
            {(record.corrections?.length ?? 0) > 0 && <div className="correction-history"><strong><History size={12} aria-hidden="true" /> Correction history</strong><p>The retained evidence is unchanged; these amendments document later corrections.</p><ol>{record.corrections!.map((correction) => <li key={`${correction.field_name}-${correction.created_at}`}><span>{formatTimestamp(new Date(correction.created_at))}</span> {correction.field_name.replaceAll("_", " ")} corrected to “{correction.corrected_value}” — {correction.reason}</li>)}</ol></div>}
            {record.latestRun?.last_error && <div className="record-warning">{record.latestRun.last_error}</div>}
            {record.latestInvoice && <div className={`invoice-status invoice-status--${record.latestInvoice.status.toLowerCase()}`}><div><strong><ReceiptText size={13} /> {invoiceStatusLine(record.latestInvoice)}</strong><span>{money(record.latestInvoice.amount_due_minor, record.latestInvoice.currency)} · {record.latestInvoice.billing_email}{record.latestInvoice.paid_at ? ` · paid ${formatTimestamp(new Date(record.latestInvoice.paid_at))}` : record.latestInvoice.due_at ? ` · due ${formatTimestamp(new Date(record.latestInvoice.due_at))}` : ""}</span>{record.latestInvoice.last_error && <p>{record.latestInvoice.last_error}</p>}</div>{record.latestInvoice.hosted_invoice_url && <a href={record.latestInvoice.hosted_invoice_url} target="_blank" rel="noreferrer">Open invoice <ExternalLink size={12} /></a>}</div>}
            {!record.latestInvoice && record.latestInvoiceJob && ["PENDING", "PROCESSING", "FAILED"].includes(record.latestInvoiceJob.status) && <div className={record.latestInvoiceJob.status === "FAILED" ? "record-warning" : "invoice-job-state"}>{record.latestInvoiceJob.status === "FAILED" ? record.latestInvoiceJob.last_error ?? "Invoice delivery failed. Review the billing details and retry." : record.latestInvoiceJob.status === "PENDING" ? "Stripe invoice job is queued. Do not create a duplicate." : "Stripe invoice is being prepared. Do not create a duplicate."}</div>}
            {record.status === "APPROVED" && noCharge && <div className="no-charge-note">No-charge milestone — {money(0, record.currency)}. There is nothing to invoice; the approval record stands on its own.</div>}
            <div className="record-card__actions">
              {record.status !== "APPROVED" && <Link className="button button--outline button--small" href={`/workspace?record=${record.id}` as Route}>{review?.decision === "CHANGES_REQUESTED" ? "Revise and rerun" : "Resume project"} <ArrowRight size={13} /></Link>}
              {canCreateReview && <button className="button button--ink button--small" onClick={() => void createReview(record)} disabled={busy === `review:${record.id}`}>{busy === `review:${record.id}` ? <LoaderCircle className="spin" size={13} /> : copied === record.id ? <Check size={13} /> : <Clipboard size={13} />}{copied === record.id ? "New link copied" : "Create new review link"}</button>}
              {review && !review.decision && !review.revoked_at && !expired && <><button className="text-action" onClick={() => void reviewAction(record, "extend")}><Clock3 size={12} /> Extend 72h</button><button className="text-action text-action--danger" onClick={() => void reviewAction(record, "revoke")}>Revoke</button></>}
              {review?.decision === "APPROVED" && <button className="text-action" disabled={busy === `receipt:${record.id}`} onClick={() => void createReceiptLink(record)}><Clipboard size={12} /> {busy === `receipt:${record.id}` ? "Creating…" : "Create client receipt link"}</button>}
              {record.status === "APPROVED" && !noCharge && !record.latestInvoice && record.latestInvoiceJob?.status !== "PROCESSING" && record.latestInvoiceJob?.status !== "PENDING" && <button className="button button--ink button--small" onClick={(event) => { invoiceTriggerRef.current = event.currentTarget; setInvoiceRecord(record); }}><ReceiptText size={13} /> {record.latestInvoiceJob?.status === "FAILED" ? "Review & retry invoice" : data.stripe.connection?.livemode ? "Send invoice" : "Create test invoice"}</button>}
            </div>
              {(() => {
                const sharedReview = reviewLinks[record.id];
                if (!sharedReview) return null;
                return <div className="dashboard-review-link"><input aria-label={`Review link for ${record.milestone_title}`} readOnly value={sharedReview.url} /><button className="mini-action" onClick={async () => { try { await navigator.clipboard.writeText(sharedReview.url); setCopied(record.id); } catch { setCopied(""); setError("Clipboard access is unavailable. Select and copy the link manually."); } }}>{copied === record.id ? <Check size={12} /> : <Clipboard size={12} />} {copied === record.id ? "Copied" : "Copy link"}</button><a href={sharedReview.url} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a><strong>Separate code: {sharedReview.accessCode}</strong><small>For {sharedReview.recipientEmail}. Share the code separately from the link.</small></div>;
              })()}
              {(() => {
                const sharedReceipt = receiptLinks[record.id];
                if (!sharedReceipt) return null;
                return <div className="dashboard-review-link"><input aria-label={`Client receipt link for ${record.milestone_title}`} readOnly value={sharedReceipt.url} /><button className="mini-action" onClick={async () => { try { await navigator.clipboard.writeText(sharedReceipt.url); setCopied(`receipt:${record.id}`); } catch { setCopied(""); setError("Clipboard access is unavailable. Select and copy the link manually."); } }}>{copied === `receipt:${record.id}` ? <Check size={12} /> : <Clipboard size={12} />} {copied === `receipt:${record.id}` ? "Copied" : "Copy link"}</button><a href={sharedReceipt.url} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a><strong>Separate code: {sharedReceipt.accessCode}</strong><small>For {sharedReceipt.recipientEmail}. Share the code separately from the link.</small></div>;
              })()}
          </article>;
        })}</section>}
      </div>
      {invoiceRecord && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInvoiceRecord(null); }}><section ref={invoiceDialogRef} className="dialog invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-dialog-title"><button className="dialog-close" onClick={() => setInvoiceRecord(null)} aria-label="Close invoice setup"><X size={17} /></button><h2 id="invoice-dialog-title" tabIndex={-1}>Invoice approved work</h2><p>Confirm the billing contact. Greenlit will create one Stripe invoice for this retained approval and save its status.</p><InvoicePlanCard recordId={invoiceRecord.id} clientName={invoiceRecord.client_name} projectName={invoiceRecord.project_name} milestoneTitle={invoiceRecord.milestone_title} amountMinor={invoiceRecord.amount_minor} currency={invoiceRecord.currency} mode="approved" onComplete={() => { window.setTimeout(() => { setInvoiceRecord(null); void load(); }, 900); }} /></section></div>}
    </main>
  );
}
