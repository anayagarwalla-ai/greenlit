import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Privacy notice", robots: { index: true, follow: true } };

export default function PrivacyPage() {
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const paidGemini = process.env.NEXT_PUBLIC_GEMINI_SERVICE_TIER === "paid";
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Effective July 20, 2026 · Closed agency beta</div>
        <h1>Privacy notice</h1>
        <p className="legal-lede">This notice explains what MilestoneProof collects, why it is needed, which providers process it, and how long each category is retained. The beta does not sell personal information or use behavioral advertising.</p>

        <h2>Data you provide</h2>
        <ul>
          <li><strong>SOW input:</strong> synthetic or expressly non-confidential text selected for analysis. MilestoneProof does not upload the original document to its database or evidence store. To prevent loss during sign-in or reload, the extracted text and unfinished draft are saved in this browser’s local storage until you choose New import or clear site data.</li>
          <li><strong>Business record:</strong> agency, client, project, milestone value, confirmed criteria, target build, verification results, and evidence metadata.</li>
          <li><strong>Reviewer record:</strong> reviewer name, business email, optional note, approval or change request, consent statements, and decision time.</li>
          <li><strong>Agency account:</strong> business email, account identifier, owned milestone records, in-app notifications, and review-link controls.</li>
          <li><strong>Beta operations:</strong> feedback, page path, service errors, capacity counters, and privacy requests needed to operate and improve the beta.</li>
          <li><strong>Security context:</strong> country code and a keyed, one-way hash derived from request metadata. The beta does not intentionally retain a raw IP address in its transaction record.</li>
        </ul>

        <h2>Gemini provider notice</h2>
        <p>{paidGemini ? "MilestoneProof is configured for Gemini’s paid API service. Google’s current terms state that paid-service prompts and responses are not used to improve its products. The beta still prohibits secrets, regulated data, and material the user is not authorized to process." : "When Gemini’s unpaid API tier is used, Google’s current terms permit Google to use submitted content and generated responses to provide, improve, and develop its services, and human reviewers may process that content. Do not submit confidential, proprietary, sensitive, regulated, or personal information. In regions where Google requires paid API service, MilestoneProof uses its local source-grounded fallback instead."} See <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Google’s Gemini API terms</a>.</p>

        <h2>Purposes and providers</h2>
        <p>Data is used only to draft acceptance criteria, run confirmed checks, produce evidence, create a review packet, record a decision, prevent abuse, and maintain a reproducible audit trail. Infrastructure providers are Google (AI when eligible), Vercel (web hosting), Cloudflare (queued browser verification), and Supabase (database and private evidence storage). Each receives only the data needed for its role.</p>

        <h2>Synthetic walkthrough</h2>
        <p>The guided walkthrough uses only the included synthetic SOW and seeded outcomes. It does not call the Cloudflare browser runner, create evidence artifacts, append transaction events, send its sample decision to the server, or create a downloadable transaction export. A reviewer name and email entered in that walkthrough remain only in local browser storage for the sample receipt.</p>

        <h2>Retention</h2>
        <div className="legal-table">
          <div><strong>Original SOW content</strong><span>Not retained server-side; unfinished extracted text remains in local browser storage until New import or site-data deletion</span></div>
          <div><strong>Review bearer token</strong><span>72 hours by default; an agency may extend it, up to 14 days from creation</span></div>
          <div><strong>Screenshot evidence</strong><span>90 days unless a legal hold applies</span></div>
          <div><strong>Approval and audit record</strong><span>Four years by default, configurable when a different legal or contractual period applies</span></div>
          <div><strong>Privacy-request record</strong><span>24 months</span></div>
          <div><strong>Beta feedback / operational events</strong><span>24 months for feedback; 90 days for operational events; account notifications up to 180 days</span></div>
        </div>
        <p>MilestoneProof applies data minimization and does not retain information longer than reasonably necessary for the disclosed purpose. A legal hold may suspend deletion for a specific dispute or legal obligation.</p>

        <h2>Your choices</h2>
        <p>You may request access, export, correction, or deletion through the <Link href="/privacy-request">privacy request form</Link>. A deletion request may be limited where retention is necessary to complete a transaction, protect security, comply with law, or establish or defend legal claims. MilestoneProof does not sell or share personal information for cross-context behavioral advertising, so Global Privacy Control and Do Not Track do not change that practice.</p>

        <h2>Security and limits</h2>
        <p>MilestoneProof uses TLS, private storage, server-only credentials, HMAC-authenticated runner callbacks, expiring review sessions, restrictive browser headers, and append-only hash-chained audit events. No service can guarantee absolute security. Do not use this beta for health, financial-account, government-identifier, child, employment, or other regulated data.</p>

        <h2>Scope and changes</h2>
        <p>The beta is directed to U.S. business users aged 18 or older. Material changes will update the effective date and be presented before new collection where required.</p>

        <h2>Operator and contact</h2>
        <p>{operator ? <><strong>{operator}</strong> operates MilestoneProof.</> : <><strong>Operator legal identity is pending configuration.</strong> External beta invitations must not begin until it is published here.</>} {supportEmail ? <>Privacy and support questions may be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>Until a support address is published, use the <Link href="/privacy-request">privacy request form</Link>.</>}</p>
      </article>
    </main>
  );
}
