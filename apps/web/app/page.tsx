import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, CalendarClock, Check, CreditCard, FileCheck2, GitCompareArrows, MousePointerClick, Play, ScanSearch, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { geminiServiceConfiguration } from "@/lib/gemini-service";

const proofRows = [
  ["AC-01", "Hero and CTA visible", "Passed"],
  ["AC-02", "CTA reaches contact section", "Passed"],
  ["AC-04", "Contact form creates lead", "Passed"],
  ["AC-06", "No mobile overflow", "Passed"],
];

export default function Home() {
  const paidGemini = geminiServiceConfiguration().paidService;
  return (
    <main>
      <section className="hero-shell">
        <SiteHeader />
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> For U.S. web agencies · design-partner beta</div>
            <h1>Turn your SOW{" "}<br />into <em>proof.</em></h1>
            <p className="hero-lede">Greenlit turns fuzzy acceptance criteria into verified browser evidence, a focused client decision, and an invoice-ready record.</p>
            <div className="hero-actions">
              <Link className="button button--lime" href="/workspace?demo=guided">Explore the synthetic walkthrough <ArrowRight size={18} /></Link>
              <Link className="text-link" href={"/request-demo" as Route}><Play size={16} fill="currentColor" /> Request a conversation</Link>
            </div>
            <div className="trust-line">
              <span><ShieldCheck size={16} /> Human-confirmed checks</span>
              <span><Check size={16} /> No generated test scripts</span>
            </div>
          </div>

          <div className="proof-composition" aria-label="Example verified milestone record">
            <div className="proof-accent proof-accent--top" />
            <div className="proof-card">
              <div className="proof-card__header">
                <div>
                  <span className="micro-label">Illustrative example · Milestone</span>
                  <h2>Spring launch</h2>
                </div>
                <span className="seal"><Check size={17} strokeWidth={3} /> VERIFIED</span>
              </div>
              <div className="proof-meta">
                <div><span>Client</span><strong>Acme Outdoors</strong></div>
                <div><span>Value</span><strong>$12,000</strong></div>
              </div>
              <div className="proof-list">
                {proofRows.map(([id, label, status]) => (
                  <div className="proof-row" key={id}>
                    <span className="proof-id">{id}</span>
                    <span>{label}</span>
                    <span className="pass-pill"><Check size={12} /> {status}</span>
                  </div>
                ))}
              </div>
              <div className="proof-card__footer">
                <div className="avatar-stack" aria-label="Approved by Mara Chen"><span>NS</span><span>MC</span></div>
                <div><span>Approved by Mara Chen</span><strong>Evidence record MP-2048</strong></div>
                <FileCheck2 size={29} aria-hidden="true" />
              </div>
            </div>
            <div className="proof-note"><MousePointerClick size={18} /><span>Client approved</span><strong>Invoice ready</strong></div>
            <div className="proof-accent proof-accent--bottom" />
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span>PROVE THE WORK</span><i /> <span>GET THE SIGN-OFF</span><i /> <span>UNLOCK THE INVOICE</span><i /> <span>NO MORE “IS IT DONE?”</span>
        </div>
      </section>

      <section className="problem-section" id="how-it-works">
        <div className="section-kicker">The last mile problem</div>
        <div className="problem-heading">
          <h2>Finished work should not sit{" "}<br />in <em>approval limbo.</em></h2>
          <p>Your team knows the milestone is done. Your client sees a staging link and a wall of messages. Greenlit makes “done” concrete, reviewable, and auditable.</p>
        </div>
        <div className="steps-grid">
          <article><span>01</span><FileCheck2 /><h3>Freeze the promise</h3><p>Paste or upload {paidGemini ? "a SOW section you are authorized to process" : "a redacted, non-confidential SOW section"}. AI drafts measurable criteria with exact source citations; your team confirms the revision.</p></article>
          <article><span>02</span><Play /><h3>Verify the build</h3><p>Run safe, typed browser checks against a staging site and capture evidence for every supported claim.</p></article>
          <article><span>03</span><ShieldCheck /><h3>Collect a decision</h3><p>Give one named client reviewer a clear deadline, a focused proof page, and an approve-or-request-changes choice.</p></article>
        </div>
      </section>

      <section className="agency-pains-section" aria-labelledby="agency-pains-title">
        <div className="agency-pains-heading">
          <div><span className="section-kicker">Built around agency bottlenecks</span><h2 id="agency-pains-title">Keep the last mile from eating the margin.</h2></div>
          <p>Greenlit keeps the agreed scope, staging evidence, client decision, and billing handoff in one traceable workflow.</p>
        </div>
        <div className="agency-pain-grid">
          <article><FileCheck2 /><div><h3>Make “done” measurable</h3><p>Exact SOW quotes stay attached to the confirmed acceptance criteria.</p></div></article>
          <article><GitCompareArrows /><div><h3>Separate fixes from new scope</h3><p>Clients identify whether a request corrects an agreed criterion or adds work outside the frozen milestone.</p></div></article>
          <article><CalendarClock /><div><h3>Put approval on a clock</h3><p>Assign one reviewer and a visible response deadline instead of chasing decisions across messages.</p></div></article>
          <article><ScanSearch /><div><h3>Show the proof</h3><p>Expected and observed results, exact source language, screenshots, and hashes travel together.</p></div></article>
          <article><CreditCard /><div><h3>Move approval into billing</h3><p>An approved record can trigger the configured Stripe invoice or remain ready for the agency’s billing process.</p></div></article>
        </div>
      </section>

      <section className="cta-strip">
        <div><span>Invitation-only design-partner beta</span><h2>One milestone. Clear promises.{" "}<br />Proof before the invoice.</h2></div>
        <div className="cta-strip__actions">
          <Link className="text-link text-link--inverse" href={"/resources" as Route}>Browse agency resources</Link>
          <Link className="button button--lime" href={"/request-demo" as Route}>Request a conversation <ArrowRight size={18} /></Link>
        </div>
      </section>
    </main>
  );
}
