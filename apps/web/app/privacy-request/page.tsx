import Link from "next/link";
import { Brand } from "@/components/brand";
import { PrivacyRequestForm } from "@/components/privacy-request-form";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Privacy request",
  description: "Request access, export, correction, or deletion review for personal information in a Greenlit record.",
  path: "/privacy-request",
});

type VerificationStatus = "success" | "expired" | "invalid";

export default async function PrivacyRequestPage({ searchParams }: { searchParams: Promise<{ verification?: string; requestId?: string }> }) {
  const params = await searchParams;
  const verification = (["success", "expired", "invalid"] as const).includes(params.verification as VerificationStatus)
    ? params.verification as VerificationStatus
    : undefined;
  const requestId = params.requestId?.trim().slice(0, 100);
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/privacy">Read privacy notice</Link></header>
      <article>
        <div className="legal-kicker">Access · export · correction · deletion</div>
        <h1>Privacy request</h1>
        <p className="legal-lede">Submit a request concerning personal information in a Greenlit review or approval record. Identity verification may be required before records are disclosed or changed.</p>
        {verification === "success" && <div className="form-message" role="status"><strong>Identity verified.</strong> {requestId ? `Request ${requestId} can now be processed.` : "Your privacy request can now be processed."}</div>}
        {verification === "expired" && <div className="form-message is-error" role="alert"><strong>Verification link expired.</strong> Submit a new privacy request below to receive a fresh link.</div>}
        {verification === "invalid" && <div className="form-message is-error" role="alert"><strong>Verification was not completed.</strong> The link may already have been used or may not match the request. Submit a new request if you still need help.</div>}
        <PrivacyRequestForm />
        <h2>What happens next</h2>
        <p>The request is recorded with a tracking number. Greenlit will verify that the requester is entitled to the record before acting. Some information may be retained where necessary for security, a completed transaction, a legal obligation, or the establishment or defense of legal claims.</p>
      </article>
    </main>
  );
}
