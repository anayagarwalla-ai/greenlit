"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, FileJson2, FileWarning } from "lucide-react";
import { Brand } from "@/components/brand";

type Result = { criterionId: string; status: string; expected: string; observed: string };
type Criterion = { id: string; title: string };
type ReceiptPacket = {
  packetId: string;
  snapshot: { recordPublicId: string; agencyName: string; clientName: string; projectName: string; milestoneTitle: string; amountMinor: number; currency: string; revision: number; criteria: Criterion[]; run: { runId: string; buildLabel: string; buildUrl: string; results: Result[]; manifestSha256: string; browserVersion: string; runnerVersion: string; completedAt: string } };
  snapshotSha256: string;
  decision: "APPROVED" | "CHANGES_REQUESTED";
  reviewerName: string;
  reviewerEmail: string;
  reviewerNote?: string | null;
  decidedAt: string;
  receiptSha256: string;
  auditHead?: { sequence: number; eventHash: string; occurredAt: string } | null;
};

const money = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZoneName: "short" }).format(new Date(value));

export function ApprovalReceipt({ packetId }: { packetId: string }) {
  const [packet, setPacket] = useState<ReceiptPacket | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/reviews/${encodeURIComponent(packetId)}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The approval record is unavailable.");
      if (payload.decision !== "APPROVED") throw new Error("This packet does not have an approval record.");
      if (!cancelled) setPacket(payload);
    }).catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The approval record is unavailable."); });
    return () => { cancelled = true; };
  }, [packetId]);

  const savePdf = () => { setToast("Print dialog opened — choose Save as PDF"); window.print(); window.setTimeout(() => setToast(""), 2800); };
  if (error) return <main className="receipt-shell"><section className="review-state"><FileWarning size={36} /><h1>Approval record unavailable</h1><p>{error}</p><Link className="button button--outline" href="/workspace">Return to workspace</Link></section></main>;
  if (!packet) return <main className="receipt-shell"><section className="review-state"><div className="loader-orbit" /><h1>Opening approval record</h1><p>Verifying the decision and audit-chain head.</p></section></main>;

  const snapshot = packet.snapshot;
  const results = Object.fromEntries(snapshot.run.results.map((result) => [result.criterionId, result]));
  return (
    <main className="receipt-shell">
      <div className="receipt-toolbar"><Brand /><div className="receipt-toolbar__actions"><Link className="button button--outline button--small" href="/workspace"><ArrowLeft size={13} /> Workspace</Link><a className="button button--outline button--small" href={`/api/reviews/${encodeURIComponent(packetId)}/export`}><FileJson2 size={14} /> Export JSON</a><button className="button button--ink button--small" onClick={savePdf}><Download size={14} /> Save PDF</button></div></div>
      <article className="receipt-page" aria-label="Milestone approval record">
        <header className="receipt-head"><div><Brand /><h1>Milestone approval record</h1></div><div className="receipt-stamp"><span><Check size={23} strokeWidth={3} /><br />APPROVED<br />{new Date(packet.decidedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}</span></div></header>
        <section className="receipt-facts"><div><span>Agency</span><strong>{snapshot.agencyName}</strong></div><div><span>Client</span><strong>{snapshot.clientName}</strong></div><div><span>Milestone value</span><strong>{money(snapshot.amountMinor, snapshot.currency)}</strong></div></section>
        <span className="receipt-section-title">Approved scope · revision {snapshot.revision}</span>
        <div className="receipt-criteria">{snapshot.criteria.map((criterion) => <div className="receipt-criterion" key={criterion.id}><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><small>{results[criterion.id]?.observed ?? "Recorded result"}</small></div><span className="status-badge status-badge--pass"><Check size={10} /> Passed</span></div>)}</div>
        <section className="receipt-approval"><div><span className="receipt-section-title">Client decision</span><h3>Approved for invoicing</h3><p>{packet.reviewerName} · {packet.reviewerEmail} · {dateTime(packet.decidedAt)}</p>{packet.reviewerNote && <p>“{packet.reviewerNote}”</p>}</div><div className="receipt-sign">{packet.reviewerName}</div></section>
        <section className="hash-block"><div><span className="receipt-section-title">Evidence snapshot</span><p>{snapshot.run.runId} · {snapshot.run.buildLabel}<br />{snapshot.run.browserVersion} · {snapshot.run.results.length} results<br />Manifest SHA-256: {snapshot.run.manifestSha256}</p></div><div><span className="receipt-section-title">Canonical record</span><p>{snapshot.recordPublicId} · revision {snapshot.revision}<br />Snapshot SHA-256: {packet.snapshotSha256}<br />Receipt SHA-256: {packet.receiptSha256}<br />Audit event {packet.auditHead?.sequence ?? "—"}: {packet.auditHead?.eventHash ?? "Unavailable"}</p></div></section>
        <p className="receipt-disclaimer">This record documents acceptance evidence and a client business decision for the named project milestone. It is not an invoice, payment guarantee, notarization, legal e-signature, or certification of Web Content Accessibility Guidelines compliance. Evidence reflects only the specified build and checks at the recorded time. Retention and legal effect can vary by contract, industry, and jurisdiction.</p>
        <footer className="receipt-page__foot"><span>Generated by MilestoneProof</span><span>{packet.packetId}</span><span>Page 1 of 1</span></footer>
      </article>
      {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
    </main>
  );
}
