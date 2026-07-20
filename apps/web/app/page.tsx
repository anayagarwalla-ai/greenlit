import Link from "next/link";
import { ArrowRight, Check, FileCheck2, MousePointerClick, Play, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

const proofRows = [
  ["AC-01", "Hero and CTA visible", "Passed"],
  ["AC-02", "CTA reaches /contact", "Passed"],
  ["AC-04", "Contact form creates lead", "Passed"],
  ["AC-06", "No mobile overflow", "Passed"],
];

export default function Home() {
  return (
    <main>
      <section className="hero-shell">
        <SiteHeader />
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> Acceptance-to-invoice proof</div>
            <h1>Turn your SOW{" "}<br />into <em>proof.</em></h1>
            <p className="hero-lede">MilestoneProof turns fuzzy acceptance criteria into verified browser evidence, a one-click client approval, and an invoice-ready record.</p>
            <div className="hero-actions">
              <Link className="button button--lime" href="/workspace">Try the guided demo <ArrowRight size={18} /></Link>
              <a className="text-link" href="#how-it-works"><Play size={16} fill="currentColor" /> See how it works</a>
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
                  <span className="micro-label">Milestone</span>
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
          <p>Your team knows the milestone is done. Your client sees a staging link and a wall of messages. MilestoneProof makes “done” concrete, reviewable, and auditable.</p>
        </div>
        <div className="steps-grid">
          <article><span>01</span><FileCheck2 /><h3>Import the promise</h3><p>Paste or upload a redacted, non-confidential SOW section. AI drafts measurable criteria with exact source citations.</p></article>
          <article><span>02</span><Play /><h3>Verify the build</h3><p>Run safe, typed browser checks against a staging site and capture evidence for every claim.</p></article>
          <article><span>03</span><ShieldCheck /><h3>Collect approval</h3><p>Send one client-ready proof page, capture the decision, and create an invoice-ready record.</p></article>
        </div>
      </section>

      <section className="cta-strip">
        <div><span>Closed agency beta</span><h2>One milestone. Clear promises.{" "}<br />Proof before the invoice.</h2></div>
        <Link className="button button--lime" href="/workspace">Run the proof flow <ArrowRight size={18} /></Link>
      </section>
    </main>
  );
}
