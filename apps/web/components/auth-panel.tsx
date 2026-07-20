"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthPanel({ nextPath = "/dashboard" }: { nextPath?: "/dashboard" | "/workspace" }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Agency sign-in is not configured yet.");
      const { error: signInError } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`, shouldCreateUser: true },
      });
      if (signInError) throw signInError;
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
          <p>We sent a secure sign-in link to <strong>{email}</strong>. It returns you to {nextPath === "/workspace" ? "your workspace" : "your agency dashboard"}.</p>
          <button className="text-action" onClick={() => setSent(false)}>Use a different email</button>
        </> : <>
          <span className="auth-mark"><ShieldCheck size={30} /></span>
          <div className="legal-kicker">Invite-only agency beta</div>
          <h1>Keep every milestone in one place.</h1>
          <p>Sign in with your business email to resume projects, see client decisions, and access retained approval records.</p>
          <form onSubmit={submit}>
            <label htmlFor="agency-email">Business email</label>
            <div className="auth-input"><Mail size={16} /><input id="agency-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@agency.com" /></div>
            {error && <div className="analysis-error" role="alert">{error}</div>}
            <button className="button button--lime" disabled={busy || !email.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{busy ? "Sending secure link…" : "Email me a sign-in link"}</button>
          </form>
          <small>Use only a pre-approved business email you control; signing in does not request an invitation. The beta currently accepts redacted or expressly non-confidential SOW sections.</small>
        </>}
        <Link href="/">Back to MilestoneProof</Link>
      </section>
    </main>
  );
}
