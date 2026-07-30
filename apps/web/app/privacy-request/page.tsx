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

export default async function PrivacyRequestPage({ searchParams }: { searchParams: Promise<{ verification?: string; requestId?: string; type?: string }> }) {
  const params = await searchParams;
  const verification = (["success", "expired", "invalid"] as const).includes(params.verification as VerificationStatus)
    ? params.verification as VerificationStatus
    : undefined;
  const requestId = params.requestId?.trim().slice(0, 100);
  const isSecurityReport = params.type === "security";
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/privacy">Read privacy notice</Link></header>
      <article>
        <div className="legal-kicker">{isSecurityReport ? "Coordinated security reporting" : "Access · export · correction · deletion"}</div>
        <h1>{isSecurityReport ? "Report a security concern" : "Privacy request"}</h1>
        <p className="legal-lede">{isSecurityReport ? "Send Greenlit a security report through the operator request queue. Include the affected feature, impact, and safe reproduction steps, but never include credentials, access codes, client material, or regulated information." : "Submit a request concerning personal information in a Greenlit review or approval record. Identity verification may be required before records are disclosed or changed."}</p>
        {verification === "success" && <div className="form-message" role="status"><strong>Identity verified.</strong> {requestId ? `Request ${requestId} can now be processed.` : "Your privacy request can now be processed."}</div>}
        {verification === "expired" && <div className="form-message is-error" role="alert"><strong>Verification link expired.</strong> Submit a new privacy request below to receive a fresh link.</div>}
        {verification === "invalid" && <div className="form-message is-error" role="alert"><strong>Verification was not completed.</strong> The link may already have been used or may not match the request. Submit a new request if you still need help.</div>}
        <PrivacyRequestForm mode={isSecurityReport ? "security" : "privacy"} />
        <h2>What happens next</h2>
        <p>{isSecurityReport ? "The report is recorded with a tracking number in Greenlit’s operator queue. Greenlit uses email verification to confirm a follow-up channel before investigating or requesting more information." : "The request is recorded with a tracking number. Greenlit will verify that the requester is entitled to the record before acting. Some information may be retained where necessary for security, a completed transaction, a legal obligation, or the establishment or defense of legal claims."}</p>
      </article>
    </main>
  );
}
