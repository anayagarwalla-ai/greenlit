import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CircleDot } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Product build log",
  description: "Greenlit's public development timeline and meaningful product changes.",
  path: "/resources/changelog",
});

const releases = [
  {
    date: "July 28, 2026",
    title: "Public walkthrough and resource alignment",
    state: "Current",
    changes: [
      "Gave the no-account guided walkthrough its own startup message and kept the complete proof story available.",
      "Removed public agency sign-in prompts while preserving account-backed workspace, record, review, and invoicing capabilities for a later release.",
      "Updated the quick-start and FAQ to match the currently available workflow and published support routes.",
      "Confirmed that the research form's anti-spam field remains outside the visible and keyboard-accessible interface.",
    ],
  },
  {
    date: "July 24, 2026",
    title: "External beta safety and recovery",
    state: "Shipped",
    changes: [
      "Hardened retained verification, recipient-bound reviews, evidence recovery, and invoice-state handling.",
      "Simplified the agency proof workflow and clarified fix-versus-new-scope decisions.",
      "Expanded responsive and accessibility checks across agency and client paths.",
      "Added the public resource center, onboarding guides, templates, trust overview, troubleshooting, and approval-delay calculator.",
    ],
  },
  {
    date: "July 22, 2026",
    title: "Account and safety controls",
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
          <span className="resource-kicker">Product updates</span>
          <h1>Build log</h1>
          <p>A public timeline of development, from the first repository commit through the current deployment.</p>
          <div className="guide-meta"><span>First commit July 19, 2026</span><span>Current build July 28, 2026</span></div>
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
          <strong>Walkthrough and retained project paths are separate</strong>
          <p>The public walkthrough requires no account and uses deterministic sample outcomes. Retained staging verification is restricted to authorized source material, supported public origins, and account-scoped records. See What runs live for the exact boundary.</p>
        </section>
        <footer className="guide-next"><Link href={"/resources" as Route}><ArrowLeft size={16} /> All resources</Link></footer>
      </article>
    </main>
  );
}
