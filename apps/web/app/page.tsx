import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Bug, Check, FileCheck2, FileText, Globe2, Play, ScanSearch, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { geminiServiceConfiguration } from "@/lib/gemini-service";

export default function Home() {
  const paidGemini = geminiServiceConfiguration().paidService;
  return (
    <main>
      <section className="hero-shell">
        <SiteHeader />
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> Evidence-backed milestone approval</div>
            <h1>The client says<br /><em>prove it.</em></h1>
            <p className="hero-lede"><strong>The agency says it&apos;s done. The client says prove it. Greenlit turns the SOW into the proof.</strong> Follow one promise from contract language to browser evidence, approval, and an invoice-ready record.</p>
            <div className="hero-actions">
              <Link className="button button--lime" href="/workspace?demo=guided">Start the 3-minute walkthrough <ArrowRight size={18} /></Link>
              <Link className="text-link" href="#how-it-works"><Play size={16} fill="currentColor" /> See the story first</Link>
            </div>
            <div className="trust-line">
              <span><Globe2 size={16} /> No sign-in required</span>
              <span><Bug size={16} /> Includes the false-success bug</span>
            </div>
          </div>

          <div className="proof-composition" id="proof-chain" aria-label="One statement of work promise becoming client-approved proof">
            <div className="proof-accent proof-accent--top" />
            <div className="proof-chain-card">
              <div className="proof-chain-card__header">
                <div>
                  <span className="micro-label">One promise · complete chain</span>
                  <h2>SOW to sign-off</h2>
                </div>
                <span className="proof-live-pill"><span /> Live walkthrough</span>
              </div>

              <div className="proof-chain">
                <div className="proof-chain__step proof-chain__step--source">
                  <div className="proof-chain__label"><span>01</span><FileText size={15} /> SOW clause</div>
                  <blockquote>“Submitting the contact form must create a lead and show a success confirmation.”</blockquote>
                </div>
                <div className="proof-chain__connector"><ArrowRight size={15} /></div>
                <div className="proof-chain__step">
                  <div className="proof-chain__label"><span>02</span><ShieldCheck size={15} /> Confirmed criterion</div>
                  <div className="proof-chain__criterion"><strong>AC-04</strong><span>Contact form creates a lead</span></div>
                </div>
                <div className="proof-chain__connector"><ArrowRight size={15} /></div>
                <div className="proof-chain__step proof-chain__step--browser">
                  <div className="proof-chain__label"><span>03</span><ScanSearch size={15} /> Browser evidence</div>
                  <div className="mini-browser-proof">
                    <div><i /><i /><i /><span>/fixture/contact</span></div>
                    <p><strong>POST /api/fixture/leads</strong><span>200 OK · lead created</span></p>
                  </div>
                  <span className="pass-pill"><Check size={12} /> Passed</span>
                </div>
              </div>

              <div className="proof-chain-card__outcome">
                <div className="avatar-stack" aria-label="Approved by Mara Chen"><span>NS</span><span>MC</span></div>
                <div><span>Client decision</span><strong>Mara approved the milestone</strong></div>
                <div><span>Billing handoff</span><strong>$12,000 · invoice ready</strong></div>
              </div>
            </div>
            <div className="proof-accent proof-accent--bottom" />
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span>SOW QUOTE</span><i /> <span>CONFIRMED CRITERION</span><i /> <span>BROWSER EVIDENCE</span><i /> <span>CLIENT APPROVAL</span><i /> <span>INVOICE READY</span>
        </div>
      </section>

      <section className="problem-section" id="how-it-works">
        <div className="section-kicker">The three-minute story</div>
        <div className="problem-heading">
          <h2>Watch “done” become<br /><em>something provable.</em></h2>
          <p>The walkthrough follows one frozen SOW through AI-assisted criteria, a deceptive staging failure, the fixed build, and the client&apos;s final decision.</p>
        </div>
        <div className="steps-grid">
          <article><span>01</span><FileCheck2 /><h3>Read the promise</h3><p>{paidGemini ? "Gemini" : "The AI-assisted import"} turns exact SOW language into measurable criteria. A human confirms what “done” means.</p></article>
          <article><span>02</span><Bug /><h3>Catch the fake success</h3><p>The page shows success, but the lead request returns HTTP 500. Greenlit marks the promise as failed instead of trusting the UI.</p></article>
          <article><span>03</span><ShieldCheck /><h3>Prove the fix</h3><p>The same frozen criterion passes on the corrected build, then travels to a focused client decision and approval record.</p></article>
        </div>
      </section>

      <section className="judge-story-section" aria-labelledby="judge-story-title">
        <div className="judge-story-heading">
          <div><span className="section-kicker">The memorable moment</span><h2 id="judge-story-title">The page says success.<br />The network says 500.</h2></div>
          <p>A screenshot alone can look convincing. Greenlit checks the browser outcome behind it and attaches that observation to the exact promise the client signed.</p>
        </div>
        <div className="false-success-comparison">
          <article className="false-success-comparison__surface">
            <span>What the page claims</span>
            <div><Check size={29} /><strong>Thanks! Your trip request was sent.</strong><small>Looks finished</small></div>
          </article>
          <article className="false-success-comparison__proof">
            <span>What Greenlit observes</span>
            <div><Bug size={29} /><strong>POST /api/fixture/leads</strong><small>HTTP 500 · promise failed</small></div>
          </article>
        </div>
        <Link className="button button--lime" href="/workspace?demo=guided">See Greenlit catch it <ArrowRight size={18} /></Link>
      </section>

      <section className="cta-strip">
        <div><span>From promise to approval</span><h2>One promise. One failure.{" "}<br />One proof a client can approve.</h2></div>
        <div className="cta-strip__actions">
          <Link className="text-link text-link--inverse" href={"/trust" as Route}>What runs live</Link>
          <Link className="button button--lime" href="/workspace?demo=guided">Start the walkthrough <ArrowRight size={18} /></Link>
        </div>
      </section>
    </main>
  );
}
