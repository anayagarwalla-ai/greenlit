"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { bindPendingAnonymousDraftClaim } from "@/lib/client-storage";

export function AuthPanel({ nextPath = "/dashboard", initialError = "" }: { nextPath?: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(initialError);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const inviteResponse = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, nextPath }),
      });
      const invite = await inviteResponse.json() as { accepted?: boolean; error?: string };
      if (!inviteResponse.ok || !invite.accepted) throw new Error(invite.error ?? "The sign-in request could not be accepted.");
      bindPendingAnonymousDraftClaim(email);
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The sign-in link could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Brand />
        {sent ? <>
          <span className="auth-mark"><CheckCircle2 size={30} /></span>
          <h1>Check your email</h1>
          <p role="status">We sent a secure sign-in link to <strong>{email}</strong>. It returns you to {nextPath.startsWith("/workspace") ? "your workspace" : "your agency dashboard"}.</p>
        </> : <>
          <span className="auth-mark"><ShieldCheck size={30} /></span>
          <div className="legal-kicker">Invite-only agency beta</div>
          <h1>Keep every milestone in one place.</h1>
          <p>Sign in with your business email to resume projects, see client decisions, and access retained approval records.</p>
          <form onSubmit={submit}>
            <label htmlFor="agency-email">Business email</label>
            <div className="auth-input"><Mail size={16} /><input id="agency-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" required placeholder="you@agency.com" aria-invalid={error ? true : undefined} aria-describedby={error ? "agency-email-error" : undefined} /></div>
            {error && <div className="analysis-error" id="agency-email-error" role="alert">{error}</div>}
            <button className="button button--lime" disabled={busy || !email.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{busy ? "Sending secure link…" : "Email me a sign-in link"}</button>
          </form>
          <small>Use only a pre-approved business email you control; signing in does not request an invitation. Before analysis, Greenlit shows the active Gemini data notice and requires confirmation that you are authorized to submit the SOW.</small>
        </>}
        <div className="auth-actions">
          {sent && <button type="button" className="text-action" onClick={() => setSent(false)}>Use a different email</button>}
          <Link href="/">Back to Greenlit</Link>
        </div>
      </section>
    </main>
  );
}
