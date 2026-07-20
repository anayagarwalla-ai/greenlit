import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { PrivacyRequestForm } from "@/components/privacy-request-form";

export const metadata: Metadata = { title: "Privacy request", robots: { index: true, follow: true } };

export default function PrivacyRequestPage() {
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/privacy">Read privacy notice</Link></header>
      <article>
        <div className="legal-kicker">Access · export · correction · deletion</div>
        <h1>Privacy request</h1>
        <p className="legal-lede">Submit a request concerning personal information in a MilestoneProof review or approval record. Identity verification may be required before records are disclosed or changed.</p>
        <PrivacyRequestForm />
        <h2>What happens next</h2>
        <p>The request is recorded with a tracking number. MilestoneProof will verify that the requester is entitled to the record before acting. Some information may be retained where necessary for security, a completed transaction, a legal obligation, or the establishment or defense of legal claims.</p>
      </article>
    </main>
  );
}

