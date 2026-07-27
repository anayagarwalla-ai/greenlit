import Link from "next/link";
import { Brand } from "@/components/brand";
import { geminiServiceConfiguration } from "@/lib/gemini-service";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Privacy notice",
  description: "How Greenlit handles SOW input, agency accounts, client review records, evidence, providers, retention, and privacy requests.",
  path: "/privacy",
});

export default function PrivacyPage() {
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const paidGemini = geminiServiceConfiguration().paidService;
  const notificationProvider = process.env.NEXT_PUBLIC_NOTIFICATION_PROVIDER;
  const operatorAddress = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS;
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Effective July 26, 2026 · Closed agency beta</div>
        <h1>Privacy notice</h1>
        <p className="legal-lede">This notice explains what Greenlit collects, why it is needed, which providers process it, and how long each category is retained. The beta does not sell personal information or use behavioral advertising.</p>

        <h2>Data you provide</h2>
        <ul>
          <li><strong>SOW input:</strong> {paidGemini ? "text the user is authorized to submit for analysis" : "synthetic or expressly non-confidential text selected for analysis"}. Greenlit does not upload the original document to its database or evidence store. To prevent loss during sign-in or reload, the extracted text and unfinished draft are saved in this browser’s local storage until you choose New import or clear site data.</li>
          <li><strong>Business record:</strong> agency, client, project, milestone value, confirmed criteria, target build, verification results, and evidence metadata.</li>
          <li><strong>Reviewer record:</strong> reviewer name, business email, optional note, approval or change request, consent statements, and decision time.</li>
          <li><strong>Agency account:</strong> business email, account identifier, owned milestone records, in-app notifications, and review-link controls.</li>
          <li><strong>Optional invoicing:</strong> billing name and email, due terms, invoice memo, Stripe account/customer/invoice identifiers, hosted-invoice links, amounts, status, and timestamps. Greenlit does not receive or store card or bank-account details.</li>
          <li><strong>Demo or design-partner request:</strong> your name, business email, agency, role, agency size and location, milestone volume, typical approval delay, staging model, requested next step, current approval process, consent record, and request status. Greenlit uses this information only to evaluate fit, manage beta capacity, and respond to the request.</li>
          <li><strong>Beta operations:</strong> feedback, page path, service errors, capacity counters, and privacy requests needed to operate and improve the beta.</li>
          <li><strong>Security context:</strong> country code and a keyed, one-way hash derived from request metadata. The beta does not intentionally retain a raw IP address in its transaction record.</li>
        </ul>

        <h2>Gemini provider notice</h2>
        <p>{paidGemini ? "Greenlit is configured for Gemini’s paid API service. Google’s current terms state that paid-service prompts and responses are not used to improve its products. The beta still prohibits secrets, regulated data, and material the user is not authorized to process." : "When Gemini’s unpaid API tier is used, Google’s current terms permit Google to use submitted content and generated responses to provide, improve, and develop its services, and human reviewers may process that content. Do not submit confidential, proprietary, sensitive, regulated, or personal information. In regions where Google requires paid API service, Greenlit uses its local source-grounded fallback instead."} See <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Google’s Gemini API terms</a>.</p>

        <h2>Purposes and providers</h2>
        <p>Data is used only to evaluate and respond to demo or design-partner requests, draft acceptance criteria, run confirmed checks, produce evidence, create a review packet, record a decision, optionally create and reconcile an agency-authorized invoice, prevent abuse, and maintain a reproducible audit trail. Infrastructure providers are Google (AI when eligible), Vercel (web hosting), Cloudflare (configured queued browser verification when the runner is deployed and healthy), Supabase (database and private evidence storage), and Stripe when an agency enables invoicing (customer, invoice, hosted payment, and payment-status processing).{notificationProvider ? ` ${notificationProvider} delivers transactional decision notices and receives the agency address, reviewer business email, decision type, packet ID, and decision time needed for that notice. It may also receive a generic new-request alert containing only Greenlit’s request reference, not the requester’s contact or agency details.` : " Decision notices remain in-app, and new requests remain in the operator queue, unless a disclosed notification provider is configured."} Each provider receives only the data needed for its role.</p>

        <h2>Synthetic walkthrough</h2>
        <p>The guided walkthrough uses only the included synthetic SOW and seeded outcomes. It does not call the Cloudflare browser runner, create evidence artifacts, append transaction events, send its sample decision to the server, or create a downloadable transaction export. A reviewer name and email entered in that walkthrough remain only in local browser storage for the sample receipt.</p>

        <h2>Retention</h2>
        <div className="legal-table">
          <div><strong>Original SOW content</strong><span>Not retained server-side; unfinished extracted text remains in local browser storage until New import or site-data deletion</span></div>
          <div><strong>Recipient-bound review invitation</strong><span>One-time link plus a separately shared code; 72 hours by default, with a 14-day hard limit</span></div>
          <div><strong>Reviewer receipt session</strong><span>30 days after a final decision; the original review bearer link still expires</span></div>
          <div><strong>Screenshot evidence</strong><span>90 days unless a legal hold applies</span></div>
          <div><strong>Approval and audit record</strong><span>Four years by default, configurable when a different legal or contractual period applies</span></div>
          <div><strong>Invoice metadata and audit events</strong><span>With the related approval record for four years by default; the agency’s Stripe account may retain the underlying invoice under its own settings and obligations</span></div>
          <div><strong>Stripe OAuth credentials</strong><span>Encrypted while connected; cleared when the agency disconnects or the account is deleted</span></div>
          <div><strong>Demo / design-partner request</strong><span>12 months from submission, or earlier after a verified deletion request</span></div>
          <div><strong>Privacy-request record</strong><span>24 months, then purged even if the workflow was not closed unless an active legal hold or retained correction record still requires it</span></div>
          <div><strong>Privacy email verification</strong><span>A verification-only account is queued for cleanup when created and becomes eligible for deletion when the 30-minute link expires if it is never used; the minimized cleanup receipt is purged seven days after completion</span></div>
          <div><strong>Account-deletion receipt</strong><span>The plaintext email is erased when Auth deletion completes, and the minimized operational receipt is purged after 30 days</span></div>
          <div><strong>Removed beta-access tombstone</strong><span>Operator context is minimized after 30 days; the normalized email is retained only to prevent accidental re-admission for up to four years, then purged</span></div>
          <div><strong>Beta feedback / operational events</strong><span>24 months for feedback; 90 days for operational events; account notifications up to 180 days</span></div>
        </div>
        <p>Greenlit applies data minimization and does not retain information longer than reasonably necessary for the disclosed purpose. A legal hold may suspend deletion for a specific dispute or legal obligation.</p>

        <h2>Your choices</h2>
        <p>You may request access, export, correction, or deletion through the <Link href="/privacy-request">privacy request form</Link>. A deletion request may be limited where retention is necessary to complete a transaction, protect security, comply with law, or establish or defend legal claims. Greenlit does not sell or share personal information for cross-context behavioral advertising, so Global Privacy Control and Do Not Track do not change that practice.</p>

        <h2>Security and limits</h2>
        <p>Greenlit uses TLS, private storage, server-only credentials, AES-256-GCM encryption for Stripe OAuth tokens, signed Stripe webhooks, HMAC-authenticated runner callbacks, expiring review sessions, restrictive browser headers, and append-only hash-chained audit events. No service can guarantee absolute security. Do not use this beta for health, financial-account, government-identifier, child, employment, or other regulated data.</p>

        <h2>Scope and changes</h2>
        <p>The beta is directed to U.S. business users aged 18 or older. Material changes will update the effective date and be presented before new collection where required.</p>

        <h2>Operator and contact</h2>
        <p>{operator ? <><strong>{operator}</strong> operates Greenlit{operatorAddress ? ` at ${operatorAddress}` : ""}.</> : <><strong>Operator legal identity is pending configuration.</strong> External beta invitations must not begin until it is published here.</>} {supportEmail ? <>Privacy and support questions may be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>Until a support address is published, use the <Link href="/privacy-request">privacy request form</Link>.</>}</p>
      </article>
    </main>
  );
}
