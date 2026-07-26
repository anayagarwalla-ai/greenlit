import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CircleDot } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Product changelog",
  description: "Current Greenlit closed-beta changes and known operating boundaries.",
  path: "/resources/changelog",
});

const releases = [
  {
    date: "July 24, 2026",
    title: "External beta safety and recovery",
    state: "Current",
    changes: [
      "Hardened retained verification, recipient-bound reviews, evidence recovery, and invoice-state handling.",
      "Simplified the agency proof workflow and clarified fix-versus-new-scope decisions.",
      "Expanded responsive and accessibility checks across agency and client paths.",
      "Added the public resource center, onboarding guides, templates, trust overview, troubleshooting, and approval-delay calculator.",
    ],
  },
  {
    date: "July 22, 2026",
    title: "Closed beta controls",
    state: "Shipped",
    changes: [
      "Added invitation allowlists, agency accounts, revocable review links, privacy-request operations, and beta feedback triage.",
      "Added retention, backup, incident-response, and production-signoff runbooks.",
      "Introduced beta release checks for authentication, reviewer sessions, records, and capacity limits.",
    ],
  },
  {
    date: "July 20, 2026",
    title: "Agency proof workflow",
    state: "Shipped",
    changes: [
      "Added SOW import, source-grounded criteria, typed staging checks, client review, approval records, and invoice planning.",
      "Added the reliable synthetic demo for times when optional providers or browser capacity are unavailable.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="resource-shell">
      <ResourceHeader back />
      <article className="guide">
        <header className="guide-hero">
          <span className="resource-kicker">Closed beta</span>
          <h1>Product changelog</h1>
          <p>A concise record of meaningful changes that affect agency setup, client review, evidence, or billing handoff.</p>
          <div className="guide-meta"><span>Current as of July 24, 2026</span><span>Beta releases</span></div>
        </header>
        <div className="changelog">
          {releases.map((release) => (
            <section className="changelog-entry" key={`${release.date}-${release.title}`}>
              <div className="changelog-entry__date"><CircleDot size={17} /><span>{release.date}</span></div>
              <div>
                <span className="status-badge status-badge--pass">{release.state}</span>
                <h2>{release.title}</h2>
                <ul>{release.changes.map((change) => <li key={change}><Check size={15} /> {change}</li>)}</ul>
              </div>
            </section>
          ))}
        </div>
        <section className="resource-callout resource-callout--warning">
          <strong>Still a closed beta</strong>
          <p>Current limitations include invitation-only access, deliberately limited verification capacity, restricted staging-origin support, and deployment-specific Gemini and Stripe modes. See the Trust page and in-product notices before using real client material.</p>
        </section>
        <footer className="guide-next"><Link href={"/resources" as Route}><ArrowLeft size={16} /> All resources</Link></footer>
      </article>
    </main>
  );
}
