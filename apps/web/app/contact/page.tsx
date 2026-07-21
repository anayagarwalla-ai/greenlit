import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Contact", robots: { index: true, follow: true } };

export default function ContactPage() {
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Closed agency beta</div>
        <h1>Contact MilestoneProof</h1>
        <p className="legal-lede">{operator ? <><strong>{operator}</strong> operates MilestoneProof.</> : <><strong>Operator legal identity is pending configuration.</strong> External beta invitations must not begin until it is published here.</>} {supportEmail ? <>Reach the beta operator at <a href={`mailto:${supportEmail}`}>{supportEmail}</a> for support, privacy, or account questions.</> : <>Until a monitored support address is published, use the <Link href="/privacy-request">privacy request form</Link> for privacy or data questions, or the in-app <strong>Beta feedback</strong> button for product issues.</>}</p>
        <p>See the <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy Notice</Link>, and <Link href="/records">recordkeeping notice</Link> for how retained milestone records, evidence, and client decisions are handled.</p>
      </article>
    </main>
  );
}
