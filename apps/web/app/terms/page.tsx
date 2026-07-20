import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Beta terms", robots: { index: true, follow: true } };

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Effective July 20, 2026 · Hackathon business beta</div>
        <h1>Terms of use</h1>
        <p className="legal-lede">MilestoneProof is a limited U.S. business beta for demonstrating evidence-backed milestone approval. By using it, you agree to these boundaries.</p>

        <h2>Eligibility and authority</h2>
        <p>You must be at least 18, use the Service for professional or business purposes, and have authority to submit the material and act for the organization you identify. The beta is not offered for consumer, medical, financial, employment, government, or child-directed use.</p>

        <h2>Your data and Gemini</h2>
        <p>Submit only synthetic or explicitly non-confidential, non-personal material. You authorize the disclosed processing needed to provide the Service. Gemini’s unpaid API tier may allow Google to use inputs and outputs to improve its services and permit human review; the analysis screen requires a separate acknowledgment before anything is sent.</p>

        <h2>Human control and verification</h2>
        <p>AI suggestions are drafts. You are responsible for reviewing source quotes, measurable outcomes, check mappings, and results. Browser evidence reflects only the recorded build, time, and typed checks and does not prove facts outside that scope.</p>

        <h2>Approval record—not a legal signature</h2>
        <p>The client decision is a business approval record. It is not an invoice, payment instruction, payment guarantee, notarization, certification, or substitute for a contract or formal electronic-signature product where one is required. Do not use MilestoneProof for documents excluded from electronic-transaction laws or requiring special signatures, witnessing, or notarization.</p>

        <h2>Electronic records</h2>
        <p>Reviewers must affirm their intent, consent to receive and retain the record electronically, and provide their name and business email. Records can be viewed in a modern browser and printed or saved as PDF. Transaction events are timestamped and hash-chained to make later alteration detectable.</p>

        <h2>Acceptable use</h2>
        <p>Do not probe third-party sites without authorization, upload secrets or regulated data, bypass origin verification, falsify identity or authority, interfere with the Service, or use generated evidence to mislead another person. Verification is limited to the included, owner-controlled staging fixture during this beta.</p>

        <h2>Availability and responsibility</h2>
        <p>The beta is provided as-is and may be changed or withdrawn. You remain responsible for contracts, invoices, taxes, accessibility compliance, legal notices, and decisions made from the output. To the maximum extent permitted by law, the Service disclaims implied warranties and liability for indirect or consequential losses.</p>

        <h2>Privacy and requests</h2>
        <p>The <Link href="/privacy">Privacy Notice</Link> describes collection, providers, security, and retention. Submit data-rights requests through the <Link href="/privacy-request">privacy request form</Link>.</p>
      </article>
    </main>
  );
}

