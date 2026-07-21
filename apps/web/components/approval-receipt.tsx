"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, FileJson2, FileWarning } from "lucide-react";
import { Brand } from "@/components/brand";
import { demoCriteria, demoMilestone, seededDemoResults } from "@/lib/demo";
import { formatTimestamp } from "@/lib/format";

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
  auditHead?: { sequence: number; eventHash: string; occurredAt: string } | null;
};

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);

type DemoReviewer = { reviewerName: string; reviewerEmail: string; reviewerNote: string; decidedAt: string };

function demoReceipt(reviewer: DemoReviewer = { reviewerName: "Sample Client", reviewerEmail: "client@example.test", reviewerNote: "Synthetic walkthrough approval.", decidedAt: "2026-07-20T17:00:00.000Z" }): ReceiptPacket {
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
  const dateTime = (value: string) => formatTimestamp(new Date(value), demo ? "America/Los_Angeles" : undefined);
  const dateStamp = (value: string) => new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(demo ? { timeZone: "America/Los_Angeles" } : {}),
  }).format(new Date(value)).toUpperCase();
  const [packet, setPacket] = useState<ReceiptPacket | null>(() => demo ? demoReceipt() : null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (demo) {
      const timer = window.setTimeout(() => {
        try {
          const stored = window.localStorage.getItem("milestoneproof-demo-decision");
          if (stored) setPacket(demoReceipt(JSON.parse(stored) as DemoReviewer));
        } catch { /* optional walkthrough convenience */ }
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void fetch(`/api/reviews/${encodeURIComponent(packetId)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The approval record is unavailable.");
      if (payload.decision !== "APPROVED") throw new Error("This packet does not have an approval record.");
      if (!cancelled) setPacket(payload);
    }).catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The approval record is unavailable."); });
    return () => { cancelled = true; };
  }, [demo, packetId]);

  const savePdf = () => { setToast("Print dialog opened — choose Save as PDF"); window.print(); window.setTimeout(() => setToast(""), 2800); };
  if (error) return <main className="receipt-shell"><section className="review-state"><FileWarning size={36} /><h1>Approval record unavailable</h1><p>{error}</p><Link className="button button--outline" href="/workspace">Return to workspace</Link></section></main>;
  if (!packet) return <main className="receipt-shell"><section className="review-state"><div className="loader-orbit" /><h1>Opening approval record</h1><p>Verifying the decision and audit-chain head.</p></section></main>;

  const snapshot = packet.snapshot;
  const results = Object.fromEntries(snapshot.run.results.map((result) => [result.criterionId, result]));
  return (
    <main className="receipt-shell">
      <div className="receipt-toolbar"><Brand /><div className="receipt-toolbar__actions"><Link className="button button--outline button--small" href="/workspace"><ArrowLeft size={13} /> Workspace</Link>{!demo && <a className="button button--outline button--small" href={`/api/reviews/${encodeURIComponent(packetId)}/export`}><FileJson2 size={14} /> Export JSON</a>}<button className="button button--ink button--small" onClick={savePdf}><Download size={14} /> Print / Save as PDF</button></div></div>
      <article className="receipt-page" aria-label="Milestone approval record">
        {demo && <div className="analysis-notice"><FileWarning size={15} /><div><strong>Synthetic sample — not a retained approval record</strong><span>This printable page illustrates the final format. It has no evidence hashes, audit chain, server-side decision, or legal-record status.</span></div></div>}
        <header className="receipt-head"><div><Brand /><h1>Milestone approval record</h1></div><div className="receipt-stamp"><span><Check size={23} strokeWidth={3} /><br />APPROVED<br />{dateStamp(packet.decidedAt)}</span></div></header>
        <section className="receipt-facts"><div><span>Agency</span><strong>{snapshot.agencyName}</strong></div><div><span>Client</span><strong>{snapshot.clientName}</strong></div><div><span>Project</span><strong>{snapshot.projectName}</strong></div><div><span>Milestone</span><strong>{snapshot.milestoneTitle}</strong></div><div><span>Milestone value</span><strong>{money(snapshot.amountMinor, snapshot.currency)}</strong></div><div><span>Verified target</span><strong>{snapshot.run.buildUrl}</strong></div></section>
        <span className="receipt-section-title">Approved scope · revision {snapshot.revision}</span>
        <div className="receipt-criteria">{snapshot.criteria.map((criterion) => { const result = results[criterion.id]; return <div className="receipt-criterion" key={criterion.id}><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><small>{result?.observed ?? "Accepted by the client as a human-reviewed promise"}</small></div><span className={`status-badge ${result ? "status-badge--pass" : "status-badge--neutral"}`}><Check size={10} /> {result ? "Passed" : "Client accepted"}</span></div>; })}</div>
        <section className="receipt-approval"><div><span className="receipt-section-title">Client decision</span><h3>Approved for invoicing</h3><p>{packet.reviewerName} · {packet.reviewerEmail} · {dateTime(packet.decidedAt)}</p>{packet.reviewerNote && <p>“{packet.reviewerNote}”</p>}</div><div className="receipt-sign">{packet.reviewerName}</div></section>
        <section className="hash-block"><div><span className="receipt-section-title">{demo ? "Illustrative outcomes" : "Evidence transaction"}</span><p>Run ID: {snapshot.run.runId}<br />Build: {snapshot.run.buildLabel}<br />Target: {snapshot.run.buildUrl}<br />{snapshot.run.browserVersion} · {snapshot.run.results.length} automated results<br />{demo ? "No manifest was generated" : `Evidence manifest SHA-256: ${snapshot.run.manifestSha256}`}</p></div><div><span className="receipt-section-title">{demo ? "Walkthrough status" : "Canonical source and record"}</span><p>{snapshot.recordPublicId} · criteria revision {snapshot.revision}<br />Source: {snapshot.sourceName ?? "Not named"}<br />Source SHA-256: {snapshot.sourceSha256 ?? "Unavailable"}<br />{demo ? "No snapshot, receipt, or audit hashes were generated" : <>Snapshot SHA-256: {packet.snapshotSha256}<br />Receipt SHA-256: {packet.receiptSha256}<br />Audit event {packet.auditHead?.sequence ?? "—"}: {packet.auditHead?.eventHash ?? "Unavailable"}</>}</p></div></section>
        <p className="receipt-disclaimer">{demo ? "This is a synthetic walkthrough artifact only. It is not evidence of a browser run, client approval, invoice, payment, signature, or retained transaction." : "This record documents acceptance evidence and a client business decision for the named project milestone. It is not an invoice, payment guarantee, notarization, legal e-signature, or certification of Web Content Accessibility Guidelines compliance. Evidence reflects only the specified build and checks at the recorded time. Retention and legal effect can vary by contract, industry, and jurisdiction."}</p>
        <footer className="receipt-page__foot"><span>Generated by MilestoneProof</span><span>{demo ? "DEMO · NOT RETAINED" : packet.packetId}</span><span className="print-page-number">Page</span></footer>
      </article>
      {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
    </main>
  );
}
