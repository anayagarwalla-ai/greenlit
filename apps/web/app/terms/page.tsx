import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Beta terms", robots: { index: true, follow: true } };

export default function TermsPage() {
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const paidGemini = process.env.NEXT_PUBLIC_GEMINI_SERVICE_TIER === "paid";
  const operatorAddress = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS;
  const governingLaw = process.env.NEXT_PUBLIC_GOVERNING_LAW;
  const venue = process.env.NEXT_PUBLIC_VENUE;
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Effective July 20, 2026 · Closed agency beta</div>
        <h1>Terms of use</h1>
        <p className="legal-lede">Greenlit is a limited U.S. business beta for demonstrating evidence-backed milestone approval. By using it, you agree to these boundaries.</p>

        <h2>Eligibility and authority</h2>
        <p>You must be at least 18, use the Service for professional or business purposes, and have authority to submit the material and act for the organization you identify. The beta is not offered for consumer, medical, financial, employment, government, or child-directed use.</p>

        <h2>Your data and Gemini</h2>
        <p>Submit only material you are authorized to process and never submit secrets or regulated data. You authorize the disclosed processing needed to provide the Service. {paidGemini ? "This deployment identifies Gemini as a paid API service, whose current terms state prompts and responses are not used to improve Google products." : "Gemini’s unpaid API tier may allow Google to use inputs and outputs to improve its services and permit human review; only synthetic or explicitly non-confidential, non-personal material is allowed."} The analysis screen requires a separate acknowledgment before anything is sent.</p>

        <h2>Human control and verification</h2>
        <p>AI suggestions are drafts. You are responsible for reviewing source quotes, measurable outcomes, check mappings, and results. Browser evidence reflects only the recorded build, time, and typed checks and does not prove facts outside that scope.</p>

        <h2>Approval record—not a legal signature</h2>
        <p>The client decision is a business approval record. It is not a payment guarantee, accounting or tax ledger, notarization, certification, or substitute for a contract or formal electronic-signature product where one is required. Do not use Greenlit for documents excluded from electronic-transaction laws or requiring special signatures, witnessing, or notarization.</p>

        <h2>Optional Stripe invoicing</h2>
        <p>An agency may authorize Greenlit to create an invoice in its own connected Stripe account after approval. Automatic sending must be configured before client review and is disclosed to the reviewer; approval never charges a payment method by itself. In test mode, Greenlit creates only a Stripe test invoice and does not email the client. A live-mode deployment may email the invoice after approval when the operator has explicitly enabled live access. Stripe, not Greenlit, hosts payment collection. The agency is the merchant, owns the Stripe customer and invoice, and remains responsible for prices, taxes, refunds, disputes, invoice terms, accounting, and compliance. Disconnecting Greenlit does not cancel invoices already created in Stripe.</p>

        <h2>Guided walkthrough</h2>
        <p>The synthetic walkthrough is not a transaction-record service. Its seeded outcomes and local sample decision are for demonstration only and are not retained, hash-chained, exported, or represented as browser evidence.</p>

        <h2>Electronic records</h2>
        <p>Reviewers must affirm their intent, consent to receive and retain the record electronically, and provide their name and business email. Records can be viewed in a modern browser and printed or saved as PDF. Transaction events are timestamped and hash-chained to make later alteration detectable.</p>

        <h2>Acceptable use</h2>
        <p>Do not probe third-party sites without authorization, upload secrets or regulated data, bypass origin verification, falsify identity or authority, interfere with the Service, or use generated evidence to mislead another person. Custom verification is limited to public HTTPS staging origins whose one-time ownership token has been verified for the signed-in agency. Potential form mutations require a separate authorization.</p>

        <h2>Availability and responsibility</h2>
        <p>The beta is provided as-is and may be changed or withdrawn. You remain responsible for contracts, invoice accuracy and delivery, payments, refunds, disputes, taxes, accessibility compliance, legal notices, and decisions made from the output. To the maximum extent permitted by law, the Service disclaims implied warranties and liability for indirect or consequential losses.</p>

        <h2>Invitation removal</h2>
        <p>Closed-beta access may be removed at any time. Removing an invitation blocks future sign-in but does not silently delete retained transaction records or legally held evidence. The retention and deletion rules in the <Link href="/records">Records policy</Link> continue to apply, and a former user may still submit a request through the public privacy-request form.</p>

        <h2>Privacy and requests</h2>
        <p>The <Link href="/privacy">Privacy Notice</Link> describes collection, providers, security, and retention. Submit data-rights requests through the <Link href="/privacy-request">privacy request form</Link>.</p>

        <h2>Governing law and venue</h2>
        <p>{governingLaw && venue ? `These Terms are governed by ${governingLaw}, without regard to conflict-of-law rules, and disputes must be brought in ${venue}, except where applicable law requires otherwise.` : "Governing law and venue are pending adult-operator configuration. External beta invitations must not begin until these terms are completed."}</p>

        <h2>Operator and contact</h2>
        <p>{operator ? <><strong>Service provider:</strong> {operator}{operatorAddress ? `, ${operatorAddress}` : ""}.</> : <><strong>Operator legal identity is pending configuration.</strong> External beta invitations must not begin until it is published.</>} {supportEmail ? <>Questions may be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>Use the <Link href="/privacy-request">privacy request form</Link> until a support address is published.</>}</p>
      </article>
    </main>
  );
}
