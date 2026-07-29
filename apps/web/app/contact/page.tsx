import Link from "next/link";
import { Brand } from "@/components/brand";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Contact",
  description: "Contact the Greenlit beta operator about agency access, support, privacy, or security.",
  path: "/contact",
});

export default function ContactPage() {
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const securityEmail = process.env.NEXT_PUBLIC_SECURITY_EMAIL;
  return (
    <main className="legal-page">
      <header><Brand /><Link href="/">Back to product</Link></header>
      <article>
        <div className="legal-kicker">Closed agency beta</div>
        <h1>Contact Greenlit</h1>
        {(operator || supportEmail || securityEmail) && <p className="legal-lede">{operator && <><strong>{operator}</strong> operates Greenlit. </>} {supportEmail && <>Reach Greenlit at <a href={`mailto:${supportEmail}`}>{supportEmail}</a> for support, privacy, or account questions. </>} {securityEmail && <>Report security vulnerabilities separately to <a href={`mailto:${securityEmail}`}>{securityEmail}</a>; do not include credentials, access codes, or client material.</>}</p>}
        <p>Use the <Link href="/privacy-request">privacy request form</Link> for privacy or data questions, or the in-app <strong>Feedback</strong> button for product issues.</p>
        <p>See the <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy Notice</Link>, and <Link href="/records">recordkeeping notice</Link> for how retained milestone records, evidence, and client decisions are handled.</p>
      </article>
    </main>
  );
}
