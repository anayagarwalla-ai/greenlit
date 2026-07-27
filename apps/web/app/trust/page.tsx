import type { Route } from "next";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, LockKeyhole, Server, ShieldCheck, TimerReset, UserCheck } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { geminiServiceConfiguration } from "@/lib/gemini-service";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Trust and security",
  description: "How Greenlit handles access, staging verification, evidence, retention, providers, and closed-beta limitations.",
  path: "/trust",
});

export default function TrustPage() {
  const paidGemini = geminiServiceConfiguration().paidService;
  const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  const securityEmail = process.env.NEXT_PUBLIC_SECURITY_EMAIL;

  return (
    <main className="resource-shell trust-page">
      <ResourceHeader />
      <section className="trust-hero">
        <span className="resource-kicker"><ShieldCheck size={15} /> Trust center</span>
        <h1>Proof needs<br /><em>boundaries.</em></h1>
        <p>Greenlit is designed to keep an agreed milestone, authorized staging observation, named reviewer decision, and retained record connected without pretending the beta proves more than it does.</p>
        <div className="trust-hero__status"><span><span className="eyebrow-dot" /> Closed beta</span><span>Updated July 26, 2026</span></div>
      </section>

      <section className="trust-grid" aria-label="Security overview">
        <article><LockKeyhole /><h2>Access</h2><p>Invitation-only agency accounts, owner-scoped records, recipient-bound client reviews, expiring sessions, revocable links, and a separately shared access code.</p></article>
        <article><Server /><h2>Infrastructure</h2><p>Vercel serves the web application, Supabase stores private retained data, Google provides eligible analysis, and configured Cloudflare and Stripe services handle queued browser verification and invoicing when those integrations are deployed and healthy.</p></article>
        <article><UserCheck /><h2>Human control</h2><p>AI drafts are tied to source quotes. The agency confirms criteria and mappings. The client, not the model, makes the milestone decision.</p></article>
        <article><TimerReset /><h2>Retention</h2><p>Current defaults retain screenshot evidence for 90 days and approval and audit records for four years, with privacy requests and legal-hold-aware deletion.</p></article>
      </section>

      <section className="trust-detail">
        <div className="trust-detail__nav">
          <strong>Trust topics</strong>
          <a href="#data">Data handling</a>
          <a href="#verification">Verification</a>
          <a href="#records">Records</a>
          <a href="#providers">Providers</a>
          <a href="#limits">Claims and limits</a>
          <a href="#reporting">Reporting concerns</a>
        </div>
        <div className="trust-detail__content">
          <section id="data">
            <span className="resource-section__eyebrow">01</span>
            <h2>Data handling</h2>
            <p>{paidGemini ? "This deployment identifies Gemini as a paid API service. Users must still submit only material they are authorized to process and must not submit secrets or regulated data." : "This deployment remains in the unpaid or unconfirmed Gemini mode. Only synthetic, redacted, or expressly non-confidential source material is permitted, as stated on the analysis screen."}</p>
            <ul>
              <li><Check size={15} /> Original uploaded documents are extracted for analysis and are not retained server-side by the analysis route.</li>
              <li><Check size={15} /> Retained evidence is stored privately rather than placed in a public asset directory.</li>
              <li><Check size={15} /> Server credentials remain server-side; Stripe OAuth tokens are encrypted.</li>
              <li><Check size={15} /> Privacy requests support access, correction, export, and deletion review.</li>
            </ul>
          </section>
          <section id="verification">
            <span className="resource-section__eyebrow">02</span>
            <h2>Authorized staging verification</h2>
            <p>Custom checks are limited to public HTTPS staging origins controlled by the signed-in agency. The ownership flow binds the origin before retained checks can run. The runner uses typed checks, restrictive network rules, queued jobs, and authenticated callbacks.</p>
            <p>A result applies only to the frozen criteria, identified build, observed state, and recorded time. It does not prove performance, compliance, security, or business outcomes outside the captured scope.</p>
          </section>
          <section id="records">
            <span className="resource-section__eyebrow">03</span>
            <h2>Evidence and decisions</h2>
            <p>Expected and observed results, source language, evidence metadata, reviewer consent, decision time, and audit events travel together. Transaction events are hash-chained to make later alteration detectable.</p>
            <p>The client record is printable and designed for later access. It remains a business approval record, not a notarization, certification, accounting ledger, payment guarantee, or universal replacement for a formal signature product.</p>
          </section>
          <section id="providers">
            <span className="resource-section__eyebrow">04</span>
            <h2>Providers and subprocessors</h2>
            <div className="resource-table-wrap" role="region" aria-label="Providers and subprocessors table" tabIndex={0}>
              <table className="resource-table">
                <thead><tr><th>Provider</th><th>Purpose</th><th>Data boundary</th></tr></thead>
                <tbody>
                  <tr><td>Vercel</td><td>Web and API hosting</td><td>Application requests and operational delivery data</td></tr>
                  <tr><td>Cloudflare</td><td>Configured queued browser verification</td><td>Authorized staging targets, typed checks, and result callbacks when the runner is deployed and healthy</td></tr>
                  <tr><td>Supabase</td><td>Authentication, database, and private evidence storage</td><td>Agency, review, record, evidence, and operations data</td></tr>
                  <tr><td>Google</td><td>Gemini analysis when eligible</td><td>The submitted source text and generated response under the displayed service mode</td></tr>
                  <tr><td>Stripe</td><td>Configured invoice creation and status</td><td>Agency authorization, customer and invoice metadata; no card or bank details are stored by Greenlit</td></tr>
                </tbody>
              </table>
            </div>
          </section>
          <section id="limits">
            <span className="resource-section__eyebrow">05</span>
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
            <span className="resource-section__eyebrow">06</span>
            <h2>Report a privacy or security concern</h2>
            <p>{supportEmail ? <>Send account and privacy concerns to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : <>A monitored support email is still pending configuration. Until it is published, use the <Link href={"/privacy-request" as Route}>privacy-request form</Link> for privacy or data questions and the in-product feedback control for product issues.</>} {securityEmail && <>Report security vulnerabilities to <a href={`mailto:${securityEmail}`}>{securityEmail}</a>.</>} Do not include credentials, access codes, complete SOW text, or regulated information.</p>
            {!operator && <aside className="resource-callout resource-callout--warning"><strong>Operator identity still required</strong><p>The production operator&apos;s legal identity and contact configuration must be completed before external beta invitations begin.</p></aside>}
          </section>
        </div>
      </section>

      <section className="trust-links">
        <Link href={"/privacy" as Route}>Privacy notice <ExternalLink size={14} /></Link>
        <Link href={"/terms" as Route}>Beta terms <ExternalLink size={14} /></Link>
        <Link href={"/records" as Route}>Recordkeeping <ExternalLink size={14} /></Link>
        <Link href={"/privacy-request" as Route}>Privacy request <ExternalLink size={14} /></Link>
      </section>
    </main>
  );
}
