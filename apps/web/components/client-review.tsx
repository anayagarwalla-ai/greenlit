"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, CreditCard, Download, ExternalLink, FileCheck2, LockKeyhole, MessageSquareText, ShieldCheck, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { demoCriteria, demoMilestone, seededDemoResults } from "@/lib/demo";
import { formatTimestamp } from "@/lib/format";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";

type ReviewResult = { criterionId: string; status: string; expected: string; observed: string; durationMs: number; timestamp: string };
type ReviewCriterion = { id: string; title: string; sourceQuote: string; supported?: boolean; checkType?: string };
type ReviewSnapshot = {
  packetPublicId: string;
  recordPublicId: string;
  agencyName: string;
  clientName: string;
  projectName: string;
  milestoneTitle: string;
  amountMinor: number;
  currency: string;
  sourceName: string;
  sourceSha256: string;
  revision: number;
  criteria: ReviewCriterion[];
  run: { runId: string; buildLabel: string; buildUrl?: string; results: ReviewResult[]; artifacts?: Array<{ criterionId: string; kind: string; sha256: string; byteSize?: number; url?: string | null }>; manifestSha256: string; completedAt: string; browserVersion: string; runnerVersion: string };
  invoicePlan?: { enabled: true; billingName: string; billingEmail: string; daysUntilDue: number; memo: string; autoSend: boolean; amountMinor: number; currency: string; planSha256: string };
  // Immutable at packet creation: how the invoice is delivered if the client
  // approves. TEST_DRAFT creates a Stripe test draft (no email); LIVE_EMAIL
  // emails the invoice; MANUAL_AFTER_APPROVAL means the agency may invoice later.
  invoiceDeliveryMode?: "TEST_DRAFT" | "LIVE_EMAIL" | "MANUAL_AFTER_APPROVAL";
  expiresAt: string;
};
type PacketResponse = { packetId: string; snapshot: ReviewSnapshot; snapshotSha256: string; expiresAt: string; decision?: "APPROVED" | "CHANGES_REQUESTED" | null; reviewerName?: string | null; reviewerEmail?: string | null; reviewerNote?: string | null; decidedAt?: string | null; receiptSha256?: string | null; invoice?: { status: string; invoice_number?: string | null; hosted_invoice_url?: string | null } | null; invoiceJob?: { status: string } | null };

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);

function demoPacket(): PacketResponse {
  // The walkthrough always shows a freshly completed run with the standard
  // 72-hour review window, so its dates never contradict the real flow.
  const completedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 3_600_000).toISOString();
  return {
    packetId: "DEMO-NOT-RETAINED",
    snapshotSha256: "synthetic-walkthrough-no-hash",
    expiresAt,
    snapshot: {
      packetPublicId: "DEMO-NOT-RETAINED",
      recordPublicId: "DEMO-NOT-RETAINED",
      agencyName: demoMilestone.agency,
      clientName: demoMilestone.client,
      projectName: demoMilestone.project,
      milestoneTitle: demoMilestone.milestone,
      amountMinor: demoMilestone.amountMinor,
      currency: demoMilestone.currency,
      sourceName: "Acme × Northstar — SOW.pdf",
      sourceSha256: "synthetic-walkthrough-no-hash",
      revision: demoMilestone.revision,
      criteria: demoCriteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.source })),
      run: { runId: "DEMO-RUN-RC2", buildLabel: "launch-rc2", results: seededDemoResults("rc2", completedAt), manifestSha256: "synthetic-walkthrough-no-hash", completedAt, browserVersion: "Illustrative sample", runnerVersion: "walkthrough-1.0" },
      expiresAt,
    },
  };
}

export function ClientReview({ packetId, demo = false }: { packetId: string; demo?: boolean }) {
  const dateTime = (value: string) => formatTimestamp(new Date(value), demo ? "America/Los_Angeles" : undefined);
  const [packet, setPacket] = useState<PacketResponse | null>(() => demo ? demoPacket() : null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"approve" | "changes" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [intent, setIntent] = useState(false);
  const [recordsConsent, setRecordsConsent] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const decisionHeadingRef = useRef<HTMLHeadingElement>(null);
  const packetRef = useRef<PacketResponse | null>(packet);

  useEffect(() => {
    packetRef.current = packet;
    if (packet?.decision) decisionHeadingRef.current?.focus({ preventScroll: true });
  }, [packet, packet?.decision]);

  useEffect(() => {
    // Evidence screenshot URLs are short-lived signed URLs (5 minutes) so the
    // private storage bucket is never exposed directly. Refresh them in the
    // background — without disturbing the rest of the page — so a client who
    // lingers on this page doesn't see broken images before making a decision.
    if (demo) return;
    const interval = window.setInterval(() => {
      if (!packetRef.current || packetRef.current.decision) return;
      void fetch(`/api/reviews/${encodeURIComponent(packetId)}`).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as PacketResponse;
        setPacket((current) => current && !current.decision ? { ...current, snapshot: { ...current.snapshot, run: { ...current.snapshot.run, artifacts: payload.snapshot.run.artifacts ?? current.snapshot.run.artifacts ?? [] } } } : current);
      }).catch(() => undefined);
    }, 3.5 * 60_000);
    return () => window.clearInterval(interval);
  }, [demo, packetId]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    const load = async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const token = hash.get("t");
        const response = await fetch(token ? `/api/reviews/${encodeURIComponent(packetId)}/redeem` : `/api/reviews/${encodeURIComponent(packetId)}`, token ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) } : undefined);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "This review is unavailable.");
        if (token) window.history.replaceState({}, "", window.location.pathname);
        if (!cancelled) setPacket(payload);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "This review is unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [demo, packetId]);

  useEffect(() => {
    if (!dialog) return;
    const node = dialogRef.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDialog(null); return; }
      if (event.key !== "Tab" || !node) return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); triggerRef.current?.focus(); };
  }, [dialog]);

  const openDialog = (kind: "approve" | "changes", trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setName(""); setEmail(""); setNote(""); setIntent(false); setRecordsConsent(false); setLegalAccepted(false); setError(""); setDialog(kind);
  };

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!dialog) return;
    setSubmitting(true); setError("");
    try {
      if (demo) {
        const decidedAt = new Date().toISOString();
        const decision = dialog === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
        setPacket((current) => current ? { ...current, decision, reviewerName: name, reviewerEmail: email, reviewerNote: note, decidedAt, receiptSha256: "synthetic-walkthrough-no-hash" } : current);
        setDialog(null);
        if (decision === "APPROVED") {
          // Demo-only, ephemeral hand-off between the two synthetic
          // walkthrough pages — never a real bearer token or account data.
          try { window.localStorage.setItem("greenlit-demo-decision", JSON.stringify({ reviewerName: name, reviewerEmail: email, reviewerNote: note, decidedAt })); } catch { /* optional walkthrough convenience */ }
        }
        return;
      }
      const response = await fetch(`/api/reviews/${encodeURIComponent(packetId)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: dialog === "approve" ? "APPROVED" : "CHANGES_REQUESTED", reviewerName: name, reviewerEmail: email, reviewerNote: note, intentConfirmed: intent, electronicRecordsConsent: recordsConsent, legalTermsAccepted: legalAccepted, noticeVersion: RECORD_NOTICE_VERSION }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The decision could not be recorded.");
      setPacket((current) => current ? { ...current, decision: payload.decision, reviewerName: name, reviewerEmail: email, reviewerNote: note, decidedAt: payload.decidedAt, receiptSha256: payload.receiptSha256 } : current);
      setDialog(null);
      if (payload.decision === "APPROVED") {
        // Best-effort refresh so the decided view reports the real invoice/job
        // state instead of assuming what the queue did.
        void fetch(`/api/reviews/${encodeURIComponent(packetId)}`).then(async (statusResponse) => {
          if (!statusResponse.ok) return;
          const refreshed = await statusResponse.json() as PacketResponse;
          setPacket((current) => current?.decision ? { ...current, invoice: refreshed.invoice ?? current.invoice ?? null, invoiceJob: refreshed.invoiceJob ?? current.invoiceJob ?? null } : current);
        }).catch(() => undefined);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The decision could not be recorded.");
    } finally { setSubmitting(false); }
  };

  if (loading) return <main className="review-shell"><header className="review-header"><Brand /><span className="review-header__secure"><LockKeyhole size={13} /> Opening secure review…</span></header><section className="review-state"><div className="loader-orbit" /><h1>Verifying the review link</h1><p>Loading the exact evidence snapshot tied to this packet.</p></section></main>;
  if (!packet) return <main className="review-shell"><header className="review-header"><Brand /></header><section className="review-state"><X size={34} /><h1>Review unavailable</h1><p>{error}</p><Link className="button button--outline" href="/">Back to Greenlit</Link></section></main>;

  const snapshot = packet.snapshot;
  const results = Object.fromEntries(snapshot.run.results.map((result) => [result.criterionId, result]));
  const approved = packet.decision === "APPROVED";
  const changes = packet.decision === "CHANGES_REQUESTED";
  const manualCount = snapshot.criteria.filter((criterion) => !results[criterion.id]).length;
  // The immutable snapshot decides what approval does with the invoice; a
  // packet minted before delivery modes existed falls back to neutral wording
  // (except that a non-auto plan is always manual-after-approval).
  const deliveryMode = snapshot.invoiceDeliveryMode ?? (snapshot.invoicePlan && !snapshot.invoicePlan.autoSend ? "MANUAL_AFTER_APPROVAL" : undefined);
  const invoiceStatus = packet.invoice?.status?.toUpperCase();
  const jobStatus = packet.invoiceJob?.status?.toUpperCase();
  // Truthful post-decision invoice state. A DRAFT invoice was created, never
  // "sent"; job states are reported as-is.
  const invoiceDecisionNote = invoiceStatus === "DRAFT"
    ? "A draft invoice was created in Stripe — nothing has been emailed to you."
    : invoiceStatus === "OPEN"
      ? `The invoice was sent to ${snapshot.invoicePlan?.billingEmail ?? "the billing contact"}.`
      : invoiceStatus === "PAID"
        ? "The invoice has been paid."
        : invoiceStatus
          ? `The Stripe invoice is currently ${invoiceStatus.toLowerCase()}.`
          : jobStatus === "PENDING"
            ? "The Stripe invoice job is queued and has not run yet."
            : jobStatus === "PROCESSING"
              ? "The Stripe invoice is being prepared."
              : jobStatus === "FAILED"
                ? "The Stripe invoice could not be created. The agency can review and retry — nothing was emailed."
                : snapshot.invoicePlan?.autoSend
                  ? deliveryMode === "TEST_DRAFT"
                    ? "A Stripe test draft invoice was queued — test mode sends no email."
                    : `The Stripe invoice was queued for ${snapshot.invoicePlan.billingEmail}.`
                  : null;

  return (
    <main className="review-shell">
      <header className="review-header"><Brand /><span className="review-header__secure"><LockKeyhole size={13} /> {demo ? "Synthetic walkthrough · not retained" : `Secure client review · expires ${dateTime(packet.expiresAt)}`}</span></header>
      <div className="review-main">
        {!packet.decision ? <>
          {demo && <div className="analysis-notice"><ShieldCheck size={15} /><div><strong>Interactive sample — no legal record is created</strong><span>This page uses seeded outcomes to demonstrate the decision experience when free browser capacity is unavailable.</span></div></div>}
          <div className="review-hero"><div><span>{snapshot.agencyName} submitted for approval</span><h1>{snapshot.milestoneTitle}</h1><p>{snapshot.projectName} · {demo ? "Sample outcomes for" : "Evidence captured from"} {snapshot.run.buildLabel}</p></div><div className="review-amount"><span>Milestone value</span><strong>{money(snapshot.amountMinor, snapshot.currency)}</strong></div></div>
          {snapshot.invoicePlan && <section className="invoice-disclosure" aria-label="Invoice disclosure"><CreditCard size={18} /><div><strong>{deliveryMode === "LIVE_EMAIL" ? "Approval sends the invoice" : deliveryMode === "TEST_DRAFT" ? "Approval creates a test draft invoice — no email" : deliveryMode === "MANUAL_AFTER_APPROVAL" ? "The agency may invoice after approval" : "Approval queues a Stripe invoice"}</strong><p>{deliveryMode === "LIVE_EMAIL"
            ? `${snapshot.agencyName} has instructed Greenlit to email a ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} Stripe invoice to ${snapshot.invoicePlan.billingEmail} after approval. Payment is handled on Stripe’s hosted page and is separate from this approval decision.`
            : deliveryMode === "TEST_DRAFT"
              ? `${snapshot.agencyName}’s Stripe account is in test mode: approving creates a ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} draft invoice in their Stripe test account. No email is sent to you and nothing is charged by this approval.`
              : deliveryMode === "MANUAL_AFTER_APPROVAL"
                ? `${snapshot.agencyName} may create and send a ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} Stripe invoice after approval — nothing is sent automatically. This approval does not itself charge a payment method.`
                : `${snapshot.agencyName} has instructed Greenlit to queue a ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} Stripe invoice after approval. Payment is handled on Stripe’s hosted page and is separate from this approval decision.`}</p></div></section>}
          <section className="panel review-proof">
            <div className="review-proof__head"><div><h2>What was promised—and what we observed</h2><p>{demo ? "Every result below is a seeded illustration of a passing run." : manualCount ? `${snapshot.run.results.length} promises have browser evidence; ${manualCount} require your judgment.` : "Every result below comes from the same verified staging run."}</p></div><span className="seal"><Check size={16} /> {demo ? "SAMPLE PASS" : manualCount ? "READY TO REVIEW" : "ALL VERIFIED"}</span></div>
            <div className="review-summary"><div><span>Result</span><strong>{snapshot.run.results.filter((result) => result.status === "PASS").length} of {snapshot.run.results.length} passed</strong></div><div><span>Verified</span><strong>{dateTime(snapshot.run.completedAt)}</strong></div><div><span>Build</span><strong>{snapshot.run.buildLabel}</strong></div><div><span>Source</span><strong>Revision {snapshot.revision}</strong></div></div>
            <div className="review-list">{snapshot.criteria.map((criterion) => {
              const result = results[criterion.id]; const manual = !result;
              const artifact = snapshot.run.artifacts?.find((item) => item.criterionId === criterion.id);
              return <article className={`review-row ${manual ? "is-manual" : ""}`} key={criterion.id}>
                <span className="criterion-id">{criterion.id}</span>
                <div><h3 aria-describedby={`${criterion.id}-source`}>{criterion.title}</h3><blockquote id={`${criterion.id}-source`} className="review-source-quote" aria-label={`Exact cited source for ${criterion.id}`}><span className="sr-only">Exact cited source: </span>“{criterion.sourceQuote}”</blockquote><p>{manual ? "Client judgment is required; no automated result is claimed." : <><strong>Expected:</strong> {result.expected}<br /><strong>Observed:</strong> {result.observed}</>}</p>{!manual && <details className="review-evidence"><summary>Inspect evidence for {criterion.id}: {criterion.title}</summary>{artifact?.url ? <><a className="evidence-image-link" href={artifact.url} target="_blank" rel="noreferrer" aria-label={`Open full-resolution evidence for ${criterion.id}: ${criterion.title}`}><Image unoptimized width={1280} height={720} src={artifact.url} alt={`Captured evidence for ${criterion.id}: ${criterion.title}`} /></a><div className="evidence-actions"><a className="text-action evidence-download" href={artifact.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open full resolution</a><a className="text-action evidence-download" href={artifact.url} download={`${criterion.id}-evidence`}><Download size={13} /> Download evidence</a></div></> : <p>Evidence unavailable. No screenshot can be displayed.</p>}<code>Artifact SHA-256: {artifact?.sha256 ?? "Unavailable"}</code><code>Run manifest SHA-256: {snapshot.run.manifestSha256}</code></details>}</div>
                <span className={`status-badge ${manual ? "status-badge--neutral" : "status-badge--pass"}`}>{manual ? <MessageSquareText size={11} aria-hidden="true" /> : <CheckCircle2 size={11} aria-hidden="true" />}{manual ? "Manual review" : "Pass: verified"}</span>
              </article>;
            })}</div>
          </section>
          <div className="review-footer"><p><ShieldCheck size={12} /> {demo ? "This local sample decision is not sent to the server, retained, hash-chained, or usable as a transaction record." : `Your decision is timestamped and bound to snapshot ${packet.snapshotSha256.slice(0, 12)}…. It is a business approval record, not a legal e-signature or payment guarantee.`}</p><div className="review-footer__actions"><button className="button button--outline" aria-expanded={dialog === "changes"} onClick={(event) => openDialog("changes", event.currentTarget)}><MessageSquareText size={14} /> Request changes</button><button className="button button--lime" aria-expanded={dialog === "approve"} onClick={(event) => openDialog("approve", event.currentTarget)}><Check size={15} /> Approve milestone</button></div></div>
        </> : <section className="panel approval-success" role="status" aria-live="polite"><div className="success-mark">{approved ? <Check size={30} strokeWidth={3} /> : <MessageSquareText size={28} />}</div><span className={`status-badge ${approved ? "status-badge--pass" : "status-badge--fail"}`}>{demo ? "Sample decision" : "Decision recorded"}</span><h2 ref={decisionHeadingRef} tabIndex={-1}>{approved ? "Milestone approved." : "Changes requested."}</h2><p>Thanks, {packet.reviewerName}. {demo ? "This decision exists only in your browser as part of the synthetic walkthrough." : "The decision is bound to this evidence snapshot and its append-only audit chain."}</p>{approved && !demo && invoiceDecisionNote && <p className="invoice-decision-note" role="status"><CreditCard size={14} /> {invoiceDecisionNote} No payment method was charged by this approval.{packet.invoice?.hosted_invoice_url && <> <a className="text-action" href={packet.invoice.hosted_invoice_url} target="_blank" rel="noreferrer">Open the hosted Stripe invoice <ExternalLink size={12} /></a></>}</p>}{approved && <Link className="button button--lime" href={demo ? "/receipt/demo" : `/receipt/${packetId}`}>View {demo ? "sample" : "approval"} record <ArrowRight size={16} /></Link>}{!demo && <a className="text-action decision-export" href={`/api/reviews/${encodeURIComponent(packetId)}/export`}>Download transaction JSON</a>}<div className="receipt-id">{demo ? "DEMO-NOT-RETAINED · NO TRANSACTION EXPORT" : `${snapshot.recordPublicId} · RECEIPT ${packet.receiptSha256?.slice(0, 16)}…`}</div></section>}
      </div>

      {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialog(null); }}><section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title"><button className="dialog-close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={17} /></button><FileCheck2 size={25} /><h2 id="decision-title">{dialog === "approve" ? `Approve ${snapshot.milestoneTitle}?` : "Request changes"}</h2><p>{demo ? "This is a local-only sample decision and will not create a retained record." : dialog === "approve" ? `This records approval against revision ${snapshot.revision} and ${snapshot.run.buildLabel}.${snapshot.invoicePlan ? deliveryMode === "LIVE_EMAIL" ? ` It will also email the disclosed ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} Stripe invoice to ${snapshot.invoicePlan.billingEmail}; approval itself does not charge a payment method.` : deliveryMode === "TEST_DRAFT" ? ` It will also create the disclosed ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} invoice as a Stripe test draft — no email is sent.` : deliveryMode === "MANUAL_AFTER_APPROVAL" ? ` ${snapshot.agencyName} may invoice the disclosed ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} later; nothing is sent automatically.` : ` It will also queue the disclosed ${money(snapshot.invoicePlan.amountMinor, snapshot.invoicePlan.currency)} Stripe invoice to ${snapshot.invoicePlan.billingEmail}; approval itself does not charge a payment method.` : ""}` : "Describe what still needs attention. The current evidence remains unchanged."}</p><form onSubmit={submitDecision}>
        <div className="form-field"><label htmlFor="reviewer-name">Your full name</label><input id="reviewer-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus required /></div>
        <div className="form-field"><label htmlFor="reviewer-email">Business email</label><input id="reviewer-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
        <div className="form-field"><label htmlFor="review-note">Note {dialog === "approve" ? "(optional)" : ""}</label><textarea id="review-note" placeholder={dialog === "approve" ? "Looks ready to launch." : "Describe the requested change…"} value={note} onChange={(event) => setNote(event.target.value)} required={dialog === "changes"} /></div>
        <label className="decision-consent"><input type="checkbox" checked={intent} onChange={(event) => setIntent(event.target.checked)} /><span>I intend to {dialog === "approve" ? "approve this milestone" : "request these changes"} for {snapshot.clientName}, and I am authorized to make this decision.</span></label>
        <label className="decision-consent"><input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} /><span>I accept the <Link href="/terms" target="_blank">Terms</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy notice</Link>, version {RECORD_NOTICE_VERSION}.</span></label>
        <label className="decision-consent"><input type="checkbox" checked={recordsConsent} onChange={(event) => setRecordsConsent(event.target.checked)} /><span>{demo ? "I understand this is a synthetic walkthrough and no transaction record will be retained." : <>I consent to receive and retain this record electronically. I can print or save the final record as PDF. <Link href="/records" target="_blank">Record details</Link></>}</span></label>
        {error && <div className="analysis-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="button button--outline" onClick={() => setDialog(null)}>Cancel</button><button className={`button ${dialog === "approve" ? "button--ink" : "button--danger"}`} disabled={submitting || !name.trim() || !email.trim() || !intent || !legalAccepted || !recordsConsent || (dialog === "changes" && !note.trim())}>{submitting ? "Recording…" : `Confirm ${dialog === "approve" ? "approval" : "request"}`}</button></div>
      </form></section></div>}
      {changes && <div className="toast" role="status">Change request recorded for {snapshot.agencyName}.</div>}
    </main>
  );
}
