import type { Route } from "next";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, LockKeyhole, Server, ShieldCheck, TimerReset, UserCheck } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "What runs live",
  description: "What the public Greenlit judge walkthrough runs live, what is seeded, and how the full verification architecture works.",
  path: "/trust",
});

export default function TrustPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const securityEmail = process.env.NEXT_PUBLIC_SECURITY_EMAIL;

  return (
    <main className="resource-shell trust-page">
      <ResourceHeader />
      <section className="trust-hero">
        <span className="resource-kicker"><ShieldCheck size={15} /> What runs live</span>
        <h1>Clear demo.<br /><em>Clear boundaries.</em></h1>
        <p>The public judge walkthrough runs in this deployed app with no account. It uses a deterministic sample so every judge can see the complete story; the production architecture for Gemini import, queued browser verification, and retained records is explained below.</p>
        <div className="trust-hero__status"><span><span className="eyebrow-dot" /> Hackathon prototype</span><span>Updated July 28, 2026</span></div>
      </section>

      <section className="trust-grid" aria-label="Security overview">
        <article><LockKeyhole /><h2>Judge access</h2><p>The complete guided walkthrough is public and requires no sign-in. Account access is reserved for retained project work and owner-scoped records.</p></article>
        <article><Server /><h2>Architecture</h2><p>Vercel serves the app, Gemini supports source analysis, Cloudflare runs queued browser checks, Supabase stores private records, and Stripe supports the optional billing handoff.</p></article>
        <article><UserCheck /><h2>Human control</h2><p>AI drafts are tied to source quotes. The agency confirms criteria and mappings. The client, not the model, makes the milestone decision.</p></article>
        <article><TimerReset /><h2>Retention</h2><p>Current defaults retain screenshot evidence for 90 days and approval and audit records for four years, with privacy requests and legal-hold-aware deletion.</p></article>
      </section>

      <section className="trust-detail">
        <div className="trust-detail__nav">
          <strong>Trust topics</strong>
          <a href="#live">Live judge path</a>
          <a href="#data">Data handling</a>
          <a href="#verification">Verification</a>
          <a href="#records">Records</a>
          <a href="#providers">Providers</a>
          <a href="#limits">Claims and limits</a>
          <a href="#reporting">Reporting concerns</a>
        </div>
        <div className="trust-detail__content">
          <section id="live">
            <span className="resource-section__eyebrow">01</span>
            <h2>What the judge can run now</h2>
            <p>The public walkthrough runs the full interface, confirmation gates, failure reveal, corrected pass, client decision, and printable approval record in this production deployment. Its sample outcomes are seeded so the path stays reliable and creates no customer record.</p>
            <ul>
              <li><Check size={15} /> No account, invitation, or form submission is required.</li>
              <li><Check size={15} /> The included failure reproduces a visible success paired with an HTTP 500 response.</li>
              <li><Check size={15} /> The corrected sample reruns the same frozen criteria before client approval.</li>
              <li><Check size={15} /> Real project execution remains separate and requires authorized source material, a verified staging origin, and account-scoped storage.</li>
            </ul>
          </section>
          <section id="data">
            <span className="resource-section__eyebrow">02</span>
            <h2>Data handling</h2>
            <p>The judge walkthrough uses synthetic, non-confidential data. Any separate source import must use material the user is authorized to process and must not include secrets or regulated data.</p>
            <ul>
              <li><Check size={15} /> Original uploaded documents are extracted for analysis and are not retained server-side by the analysis route.</li>
              <li><Check size={15} /> Retained evidence is stored privately rather than placed in a public asset directory.</li>
              <li><Check size={15} /> Server credentials remain server-side; Stripe OAuth tokens are encrypted.</li>
              <li><Check size={15} /> Privacy requests support access, correction, export, and deletion review.</li>
            </ul>
          </section>
          <section id="verification">
            <span className="resource-section__eyebrow">03</span>
            <h2>Authorized staging verification</h2>
            <p>Custom checks are limited to public HTTPS staging origins controlled by the signed-in agency. The ownership flow binds the origin before retained checks can run. The runner uses typed checks, restrictive network rules, queued jobs, and authenticated callbacks.</p>
            <p>A result applies only to the frozen criteria, identified build, observed state, and recorded time. It does not prove performance, compliance, security, or business outcomes outside the captured scope.</p>
          </section>
          <section id="records">
            <span className="resource-section__eyebrow">04</span>
            <h2>Evidence and decisions</h2>
            <p>Expected and observed results, source language, evidence metadata, reviewer consent, decision time, and audit events travel together. Transaction events are hash-chained to make later alteration detectable.</p>
            <p>The client record is printable and designed for later access. It remains a business approval record, not a notarization, certification, accounting ledger, payment guarantee, or universal replacement for a formal signature product.</p>
          </section>
          <section id="providers">
            <span className="resource-section__eyebrow">05</span>
            <h2>Providers and subprocessors</h2>
            <div className="resource-table-wrap" role="region" aria-label="Providers and subprocessors table" tabIndex={0}>
              <table className="resource-table">
                <thead><tr><th>Provider</th><th>Purpose</th><th>Data boundary</th></tr></thead>
                <tbody>
                  <tr><td>Vercel</td><td>Web and API hosting</td><td>Application requests and operational delivery data</td></tr>
                  <tr><td>Cloudflare</td><td>Queued browser verification</td><td>Authorized staging targets, typed checks, and signed result callbacks in the retained project path</td></tr>
                  <tr><td>Supabase</td><td>Authentication, database, and private evidence storage</td><td>Agency, review, record, evidence, and operations data</td></tr>
                  <tr><td>Google</td><td>Source analysis in account-based import</td><td>The submitted source text and generated response under the displayed service mode</td></tr>
                  <tr><td>Stripe</td><td>Optional invoice creation and status</td><td>Agency authorization, customer and invoice metadata; no card or bank details are stored by Greenlit</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section id="limits">
            <span className="resource-section__eyebrow">06</span>
            <h2>What Greenlit does not claim</h2>
            <ul>
              <li><AlertTriangle size={15} /> No SOC 2, ISO, PCI, accessibility, legal-signature, or industry certification is claimed for Greenlit.</li>
              <li><AlertTriangle size={15} /> No guarantee that evidence prevents a dispute or requires payment.</li>
              <li><AlertTriangle size={15} /> No claim that AI output is correct without agency confirmation.</li>
              <li><AlertTriangle size={15} /> No claim that every staging site, protected preview, external asset, or user journey is supported.</li>
              <li><AlertTriangle size={15} /> No use for health, financial-account, government-identifier, child, employment, or other regulated data.</li>
            </ul>
          </section>
          <section id="reporting">
            <span className="resource-section__eyebrow">07</span>
            <h2>Report a privacy or security concern</h2>
            <p>Use the <Link href={"/privacy-request" as Route}>privacy-request form</Link> for privacy or data questions and the in-product feedback control for product issues. {supportEmail && <>Account questions may also be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. </>}{securityEmail && <>Report security vulnerabilities to <a href={`mailto:${securityEmail}`}>{securityEmail}</a>. </>}Do not include credentials, access codes, complete SOW text, or regulated information.</p>
          </section>
        </div>
      </section>

      <section className="trust-links">
        <Link href={"/privacy" as Route}>Privacy notice <ExternalLink size={14} /></Link>
        <Link href={"/terms" as Route}>Prototype terms <ExternalLink size={14} /></Link>
        <Link href={"/records" as Route}>Recordkeeping <ExternalLink size={14} /></Link>
        <Link href={"/privacy-request" as Route}>Privacy request <ExternalLink size={14} /></Link>
      </section>
    </main>
  );
}
