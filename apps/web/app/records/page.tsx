import Link from "next/link";
import { Brand } from "@/components/brand";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Recordkeeping",
  description: "How Greenlit records verification evidence, client decisions, audit events, retention, and transaction exports.",
  path: "/records",
});

export default function RecordsPage() {
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Record integrity · version 2026-07-26</div>
        <h1>How transaction records work</h1>
        <p className="legal-lede">Greenlit keeps the minimum record needed to reproduce who confirmed the scope, what build was checked, what the browser observed, and what decision the reviewer made.</p>

        <h2>Recorded events</h2>
        <ol>
          <li>The owner freezes source-grounded acceptance criteria.</li>
          <li>The service records the target build and queues typed checks.</li>
          <li>The isolated runner records results, timestamps, evidence hashes, and its manifest hash.</li>
          <li>The service snapshots the passing run into a single-decision review packet that expires in 72 hours by default and can be revoked or extended by the agency within a 14-day hard limit.</li>
          <li>The reviewer records approval or requested changes with explicit intent and electronic-record consent.</li>
          <li>The final receipt binds the snapshot, decision, and audit-chain hash.</li>
          <li>If the agency enabled Stripe invoicing, Greenlit records the frozen invoice plan, delivery job, Stripe invoice identifier, amount, status changes, and payment-status webhook events. The approval record and invoice remain distinct records.</li>
        </ol>

        <h2>Tamper evidence and attribution</h2>
        <p>Each event includes a monotonically increasing sequence, UTC time, previous-event hash, event payload, and SHA-256 event hash. Events are append-only in the database. Request context is represented by a keyed one-way actor hash instead of storing raw IP addresses in the record.</p>

        <h2>Accessibility and reproduction</h2>
        <p>The client record remains viewable in a modern browser and can be printed or saved as PDF. Electronic-record laws can be fact-specific; this design supports accuracy, later access, and reproduction but does not guarantee that a particular record satisfies every industry or transaction-specific requirement.</p>

        <h2>Retention</h2>
        <p>Approval and audit records default to four years; evidence screenshots default to 90 days; review tokens expire within 72 hours unless the agency extends them, with a 14-day hard limit. A legal hold can suspend deletion for a specific dispute. Customers should obtain counsel before changing retention for regulated industries or contracts governed by another jurisdiction.</p>

        <h2>Important boundary</h2>
        <p>Greenlit records milestone approval and can create an invoice in the agency’s connected Stripe account. It does not replace a formal signature platform, notarization, accounting or tax records, or legal advice. The Stripe invoice is not proof of payment until Stripe reports it paid. Keep the exported approval record alongside the governing contract, Stripe invoice, proof of payment, and general-ledger entry for the period required by your tax adviser, contract, industry, and jurisdiction.</p>

        <h2>Synthetic walkthrough</h2>
        <p>The guided walkthrough is a presentation fallback that uses clearly labeled seeded outcomes. It does not run a browser, save screenshots, append audit events, retain a reviewer decision, or create a transaction export. Only the real verification and secure-review flow creates the records described above.</p>
      </article>
    </main>
  );
}
