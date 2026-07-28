"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CreditCard, Download, ExternalLink, FileJson2, FileWarning, LockKeyhole } from "lucide-react";
import { Brand } from "@/components/brand";
import { demoCriteria, demoMilestone, seededDemoResults } from "@/lib/demo";
import { DEMO_TIME_ZONE, formatTimestamp } from "@/lib/format";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

type Result = { criterionId: string; status: string; expected: string; observed: string };
type Criterion = { id: string; title: string; supported?: boolean; checkType?: string };
type ReceiptPacket = {
  packetId: string;
  snapshot: { recordPublicId: string; agencyName: string; clientName: string; projectName: string; milestoneTitle: string; amountMinor: number; currency: string; sourceName?: string; sourceSha256?: string; revision: number; criteria: Criterion[]; run: { runId: string; buildLabel: string; buildUrl: string; results: Result[]; manifestSha256: string; browserVersion: string; runnerVersion: string; completedAt: string } };
  snapshotSha256: string;
  decision: "APPROVED" | "CHANGES_REQUESTED";
  reviewerName: string;
  reviewerEmail: string;
  reviewerNote?: string | null;
  decidedAt: string;
  receiptSha256: string;
  receiptAccessExpiresAt?: string | null;
  auditHead?: { sequence: number; eventHash: string; occurredAt: string } | null;
  viewerRole?: "OWNER" | "REVIEWER";
  invoice?: { status: string; invoice_number?: string | null; amount_due_minor: number; amount_paid_minor: number; currency: string; billing_email: string; due_at?: string | null; hosted_invoice_url?: string | null; invoice_pdf_url?: string | null; sent_at?: string | null; paid_at?: string | null } | null;
  invoiceJob?: { status: string; lastError?: string | null } | null;
  corrections?: Array<{ field_name: string; corrected_value: string; reason: string; created_at: string }> | null;
};

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);

type DemoReviewer = { reviewerName: string; reviewerEmail: string; reviewerNote: string; decidedAt: string };

function demoReceipt(reviewer: DemoReviewer = { reviewerName: "Sample Client", reviewerEmail: "client@example.test", reviewerNote: "Synthetic walkthrough approval.", decidedAt: new Date().toISOString() }): ReceiptPacket {
  return {
    packetId: "DEMO-NOT-RETAINED",
    snapshot: {
      recordPublicId: "DEMO-NOT-RETAINED",
      agencyName: demoMilestone.agency,
      clientName: demoMilestone.client,
      projectName: demoMilestone.project,
      milestoneTitle: demoMilestone.milestone,
      amountMinor: demoMilestone.amountMinor,
      currency: demoMilestone.currency,
      sourceName: "Acme × Northstar SOW.pdf",
      revision: demoMilestone.revision,
      criteria: demoCriteria.map((item) => ({ id: item.id, title: item.title })),
      run: { runId: "DEMO-RUN-RC2", buildLabel: "launch-rc2", buildUrl: "/fixture/rc2", results: seededDemoResults("rc2", reviewer.decidedAt), manifestSha256: "synthetic-walkthrough-no-hash", browserVersion: "Illustrative sample", runnerVersion: "walkthrough-1.0", completedAt: reviewer.decidedAt },
    },
    snapshotSha256: "synthetic-walkthrough-no-hash",
    decision: "APPROVED",
    reviewerName: reviewer.reviewerName,
    reviewerEmail: reviewer.reviewerEmail,
    reviewerNote: reviewer.reviewerNote,
    decidedAt: reviewer.decidedAt,
    receiptSha256: "synthetic-walkthrough-no-hash",
    auditHead: null,
  };
}

export function ApprovalReceipt({ packetId, demo = false }: { packetId: string; demo?: boolean }) {
  const dateTime = (value: string) => formatTimestamp(new Date(value), demo ? DEMO_TIME_ZONE : undefined);
  const dateStamp = (value: string) => new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(demo ? { timeZone: DEMO_TIME_ZONE } : {}),
  }).format(new Date(value)).toUpperCase();
  // Demo timestamps are intentionally client-only so the initial HTML and
  // hydration render remain deterministic.
  const [packet, setPacket] = useState<ReceiptPacket | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  useEffect(() => {
    if (demo) {
      const timer = window.setTimeout(() => {
        try {
          const stored = window.localStorage.getItem("greenlit-demo-decision");
          setPacket(stored ? demoReceipt(JSON.parse(stored) as DemoReviewer) : demoReceipt());
        } catch { setPacket(demoReceipt()); }
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
      if (token && !cancelled) {
        setPendingToken(token);
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      const response = await fetchWithTimeout(`/api/reviews/${encodeURIComponent(packetId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The approval record is unavailable.");
      if (payload.decision !== "APPROVED") throw new Error("This packet does not have an approval record.");
      if (!cancelled) setPacket(payload);
    })().catch((loadError) => { if (!cancelled) setError(clientRequestMessage(loadError, "The approval record is unavailable.")); });
    return () => { cancelled = true; };
  }, [demo, packetId]);

  const unlockReceipt = async (event: FormEvent) => {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    try {
      const redeemResponse = await fetchWithTimeout(`/api/reviews/${encodeURIComponent(packetId)}/receipt-redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: pendingToken, accessCode, recipientEmail }) });
      const redeemed = await redeemResponse.json();
      if (!redeemResponse.ok) throw new Error(redeemed.error ?? "This receipt link is invalid or expired.");
      const response = await fetchWithTimeout(`/api/reviews/${encodeURIComponent(packetId)}`);
      const payload = await response.json();
      if (!response.ok || payload.decision !== "APPROVED") throw new Error(payload.error ?? "The approval record is unavailable.");
      setPacket(payload);
      setPendingToken("");
    } catch (cause) {
      setError(clientRequestMessage(cause, "The approval record could not be unlocked."));
    } finally {
      setUnlocking(false);
    }
  };

  const savePdf = () => { setToast("Print dialog opened. Choose Save as PDF."); window.print(); window.setTimeout(() => setToast(""), 2800); };
  if (!packet && pendingToken) return <main className="receipt-shell"><section className="review-state review-unlock"><LockKeyhole size={36} /><h1>Unlock this approval record</h1><p>Enter the authorized recipient email and the separate code the agency shared with you. This receipt link works only once.</p><form className="review-unlock__form" onSubmit={unlockReceipt}><label htmlFor="receipt-access-email">Business email</label><input id="receipt-access-email" type="email" autoComplete="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} required /><label htmlFor="receipt-access-code">Access code</label><input id="receipt-access-code" autoComplete="one-time-code" value={accessCode} onChange={(event) => setAccessCode(event.target.value.toUpperCase())} minLength={8} maxLength={32} required />{error && <div className="analysis-error" role="alert">{error}</div>}<button className="button button--lime" disabled={unlocking || !recipientEmail.trim() || accessCode.trim().length < 8}>{unlocking ? "Unlocking…" : "Open approval record"} <ArrowRight size={15} /></button></form></section></main>;
  if (error) return <main className="receipt-shell"><section className="review-state"><FileWarning size={36} /><h1>Approval record unavailable</h1><p>{error}</p><Link className="button button--outline" href="/">Back to Greenlit</Link></section></main>;
  if (!packet) return <main className="receipt-shell"><section className="review-state"><div className="loader-orbit" /><h1>Opening approval record</h1><p>Verifying the decision and audit-chain head.</p></section></main>;

  const snapshot = packet.snapshot;
  const results = Object.fromEntries(snapshot.run.results.map((result) => [result.criterionId, result]));
  return (
    <main className="receipt-shell">
      <div className="receipt-toolbar"><Brand /><div className="receipt-toolbar__actions">{(demo || packet.viewerRole === "OWNER") && <Link className="button button--outline button--small" href="/workspace"><ArrowLeft size={13} /> Workspace</Link>}{packet.invoice?.hosted_invoice_url && <a className="button button--outline button--small" href={packet.invoice.hosted_invoice_url} target="_blank" rel="noreferrer"><CreditCard size={14} /> Open Stripe invoice <ExternalLink size={12} /></a>}{!demo && <a className="button button--outline button--small" href={`/api/reviews/${encodeURIComponent(packetId)}/export`}><FileJson2 size={14} /> Export JSON</a>}<button className="button button--ink button--small" onClick={savePdf}><Download size={14} /> Print / Save as PDF</button>{!demo && packet.viewerRole !== "OWNER" && <button className="text-action" onClick={async () => { await fetchWithTimeout(`/api/reviews/${encodeURIComponent(packetId)}/session`, { method: "DELETE" }, 10_000).catch(() => undefined); window.location.assign("/"); }}>End secure session</button>}</div></div>
      <article className="receipt-page" aria-label="Milestone approval record">
        {demo && <div className="analysis-notice"><FileWarning size={15} /><div><strong>Synthetic sample. Not a retained approval record</strong><span>This printable page illustrates the final format. It has no evidence hashes, audit chain, server-side decision, or legal-record status.</span></div></div>}
        <header className="receipt-head"><div><Brand /><h1>Milestone approval record</h1></div><div className="receipt-stamp"><span><Check size={23} strokeWidth={3} /><br />APPROVED<br />{dateStamp(packet.decidedAt)}</span></div></header>
        <section className="receipt-facts"><div><span>Agency</span><strong>{snapshot.agencyName}</strong></div><div><span>Client</span><strong>{snapshot.clientName}</strong></div><div><span>Project</span><strong>{snapshot.projectName}</strong></div><div><span>Milestone</span><strong>{snapshot.milestoneTitle}</strong></div><div><span>Milestone value</span><strong>{money(snapshot.amountMinor, snapshot.currency)}</strong></div><div><span>Verified target</span><strong>{snapshot.run.buildUrl}</strong></div>{packet.receiptAccessExpiresAt && <div><span>Secure access until</span><strong>{dateTime(packet.receiptAccessExpiresAt)}</strong></div>}</section>
        <span className="receipt-section-title">Approved scope · revision {snapshot.revision}</span>
        <div className="receipt-criteria">{snapshot.criteria.map((criterion) => { const result = results[criterion.id]; return <div className="receipt-criterion" key={criterion.id}><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><small>{result?.observed ?? "Accepted by the client as a human-reviewed promise"}</small></div><span className={`status-badge ${result ? "status-badge--pass" : "status-badge--neutral"}`}><Check size={10} /> {result ? "Passed" : "Client accepted"}</span></div>; })}</div>
        <section className="receipt-approval"><div><span className="receipt-section-title">Client decision</span><h3>Approved for invoicing</h3><p>{packet.reviewerName} · {packet.reviewerEmail} · {dateTime(packet.decidedAt)}</p>{packet.reviewerNote && <p>“{packet.reviewerNote}”</p>}</div><div className="receipt-sign">{packet.reviewerName}</div></section>
        {packet.invoice && <section className="receipt-invoice"><div><span className="receipt-section-title">Stripe invoice</span><h3>{packet.invoice.invoice_number ?? "Invoice"} · {packet.invoice.status}</h3><p>{packet.invoice.status.toUpperCase() === "DRAFT"
          ? `${money(packet.invoice.amount_due_minor, packet.invoice.currency)} draft created for ${packet.invoice.billing_email}; not emailed`
          : packet.invoice.status.toUpperCase() === "PAID"
            ? `${money(packet.invoice.amount_due_minor, packet.invoice.currency)} paid by ${packet.invoice.billing_email}`
            : packet.invoice.status.toUpperCase() === "OPEN"
              ? `${money(packet.invoice.amount_due_minor, packet.invoice.currency)} sent to ${packet.invoice.billing_email}`
              : `${money(packet.invoice.amount_due_minor, packet.invoice.currency)} for ${packet.invoice.billing_email} · ${packet.invoice.status.toLowerCase()}`}{packet.invoice.due_at ? ` · due ${dateTime(packet.invoice.due_at)}` : ""}{packet.invoice.paid_at ? ` · paid ${dateTime(packet.invoice.paid_at)}` : ""}</p></div>{packet.invoice.hosted_invoice_url && <a href={packet.invoice.hosted_invoice_url} target="_blank" rel="noreferrer">Open hosted invoice <ExternalLink size={12} /></a>}</section>}
        {!packet.invoice && packet.invoiceJob && ["PENDING", "PROCESSING", "FAILED"].includes(packet.invoiceJob.status.toUpperCase()) && <section className="receipt-invoice receipt-invoice--job"><div><span className="receipt-section-title">Stripe invoice</span><h3>{packet.invoiceJob.status.toUpperCase() === "FAILED" ? "Invoice job failed" : packet.invoiceJob.status.toUpperCase() === "PENDING" ? "Invoice job queued" : "Invoice being prepared"}</h3><p>{packet.invoiceJob.status.toUpperCase() === "FAILED" ? packet.invoiceJob.lastError ?? "The Stripe invoice could not be created. Nothing was emailed." : "No invoice has been created or emailed yet."}</p></div></section>}
        {!demo && (packet.corrections?.length ?? 0) > 0 && <section className="receipt-corrections"><span className="receipt-section-title">Amendment &amp; correction history</span><p className="receipt-corrections__note">The retained evidence and decision above are unchanged; these amendments document corrections recorded afterwards.</p><ol>{packet.corrections!.map((correction) => <li key={`${correction.field_name}-${correction.created_at}`}><strong>{correction.field_name.replaceAll("_", " ")}</strong> corrected to “{correction.corrected_value}”: {correction.reason}<span>{dateTime(correction.created_at)}</span></li>)}</ol></section>}
        <section className="hash-block"><div><span className="receipt-section-title">{demo ? "Illustrative outcomes" : "Evidence transaction"}</span><p>Run ID: {snapshot.run.runId}<br />Build: {snapshot.run.buildLabel}<br />Target: {snapshot.run.buildUrl}<br />{snapshot.run.browserVersion} · {snapshot.run.results.length} automated results<br />{demo ? "No manifest was generated" : `Evidence manifest SHA-256: ${snapshot.run.manifestSha256}`}</p></div><div><span className="receipt-section-title">{demo ? "Walkthrough status" : "Canonical source and record"}</span><p>{snapshot.recordPublicId} · criteria revision {snapshot.revision}<br />Source: {snapshot.sourceName ?? "Not named"}<br />Source SHA-256: {snapshot.sourceSha256 ?? "Unavailable"}<br />{demo ? "No snapshot, receipt, or audit hashes were generated" : <>Snapshot SHA-256: {packet.snapshotSha256}<br />Receipt SHA-256: {packet.receiptSha256}<br />Audit event {packet.auditHead?.sequence ?? "Unavailable"}: {packet.auditHead?.eventHash ?? "Unavailable"}</>}</p></div></section>
        <p className="receipt-disclaimer">{demo ? "This is a synthetic walkthrough artifact only. It is not evidence of a browser run, client approval, invoice, payment, signature, or retained transaction." : "This record documents acceptance evidence and a client business decision for the named project milestone. It is not an invoice, payment guarantee, notarization, legal e-signature, or certification of Web Content Accessibility Guidelines compliance. Evidence reflects only the specified build and checks at the recorded time. Retention and legal effect can vary by contract, industry, and jurisdiction."}</p>
        <footer className="receipt-page__foot"><span>Generated by Greenlit</span><span>{demo ? "DEMO · NOT RETAINED" : packet.packetId}</span></footer>
      </article>
      {demo && <section className="demo-conversion" aria-labelledby="demo-conversion-title"><span className="resource-kicker">Walkthrough complete</span><h2 id="demo-conversion-title">You followed one promise from SOW to approval.</h2><p>Restart the public walkthrough at any time. It uses synthetic data and requires no account.</p><Link className="button button--lime" href="/workspace?demo=guided">Restart the walkthrough <ArrowRight size={16} /></Link></section>}
      {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
    </main>
  );
}
