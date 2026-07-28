"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

type RequestState = { requestId: string } | null;

export function DemoRequestForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RequestState>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const formRef = useRef<HTMLFormElement>(null);
  const bookingUrl = process.env.NEXT_PUBLIC_DEMO_BOOKING_URL?.trim();

  const continueToFitQuestions = () => {
    const form = formRef.current;
    if (!form) return;
    const firstStepControls = ["name", "email", "agencyName", "role"]
      .map((name) => form.elements.namedItem(name))
      .filter((item): item is HTMLInputElement => item instanceof HTMLInputElement);
    const invalid = firstStepControls.find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    setStep(2);
    window.requestAnimationFrame(() => form.querySelector<HTMLElement>('[data-demo-step="2"] select, [data-demo-step="2"] input, [data-demo-step="2"] textarea')?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetchWithTimeout("/api/demo-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { requestId?: string; error?: string };
      if (!response.ok || !body.requestId) throw new Error(body.error ?? "Your request could not be recorded.");
      setResult({ requestId: body.requestId });
    } catch (cause) {
      setError(clientRequestMessage(cause, "Your request could not be recorded."));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <section className="demo-request-success" role="status" aria-live="polite">
        <CheckCircle2 size={34} />
        <span className="resource-kicker">Request received</span>
        <h2>We have your agency context.</h2>
        <p>Your request is in the operator queue. If the use case fits the current beta, the next message will propose a focused discovery time. Keep reference <strong>{result.requestId}</strong> for your records.</p>
        <div>
          {bookingUrl
            ? <a className="button button--lime" href={bookingUrl} target="_blank" rel="noreferrer">Choose a discovery time <ArrowRight size={16} /></a>
            : <Link className="button button--lime" href="/workspace?demo=guided">Explore the synthetic walkthrough <ArrowRight size={16} /></Link>}
          <Link className="text-link" href="/trust">Review trust boundaries</Link>
        </div>
      </section>
    );
  }

  return (
    <form ref={formRef} className="demo-request-form" aria-busy={submitting} onSubmit={submit}>
      <div className="demo-request-form__head">
        <span className="resource-kicker"><ShieldCheck size={14} /> Optional product research</span>
        <h2>Tell us where approval gets stuck.</h2>
        <p>Use business information only. Do not paste a SOW, credentials, client data, access codes, or regulated information.</p>
        <div className="demo-request-progress" aria-label={`Step ${step} of 2`}>
          <span className={step >= 1 ? "is-active" : ""} aria-current={step === 1 ? "step" : undefined}>1. About you</span>
          <span className={step >= 2 ? "is-active" : ""} aria-current={step === 2 ? "step" : undefined}>2. Workflow fit</span>
        </div>
      </div>
      <div className="demo-request-fields">
        <fieldset data-demo-step="1" hidden={step !== 1}>
          <legend className="sr-only">About you</legend>
          <label>
            Your name
            <input name="name" autoComplete="name" minLength={2} maxLength={120} required />
          </label>
          <label>
            Business email
            <input name="email" type="email" autoComplete="email" maxLength={320} required />
          </label>
          <label>
            Agency name
            <input name="agencyName" autoComplete="organization" minLength={2} maxLength={160} required />
          </label>
          <label>
            Your role
            <input name="role" autoComplete="organization-title" minLength={2} maxLength={120} placeholder="Owner, COO, Head of Delivery…" required />
          </label>
        </fieldset>
        <fieldset data-demo-step="2" hidden={step !== 2}>
          <legend className="sr-only">Workflow fit</legend>
          <label>
          Agency size
          <select name="agencySize" defaultValue="" required>
            <option value="" disabled>Select a range</option>
            <option value="2-10">2–10 people</option>
            <option value="11-25">11–25 people</option>
            <option value="26-50">26–50 people</option>
          </select>
          </label>
          <label>
            Primary location
            <input name="location" autoComplete="country-name" minLength={2} maxLength={120} placeholder="City, state, country" required />
          </label>
          <label>
            Client milestones per month
            <select name="monthlyMilestoneVolume" defaultValue="" required>
              <option value="" disabled>Select a range</option>
              <option value="1-2">1–2</option>
              <option value="3-5">3–5</option>
              <option value="6-10">6–10</option>
              <option value="11-25">11–25</option>
              <option value="26+">26+</option>
            </select>
          </label>
          <label>
            Typical approval delay, days
            <input name="approvalDelayDays" type="number" min={0} max={365} inputMode="numeric" required />
          </label>
          <label>
            Staging model
            <select name="stagingModel" defaultValue="" required>
              <option value="" disabled>Select the closest fit</option>
              <option value="public-https">Public HTTPS staging</option>
              <option value="password-protected">Password-protected preview</option>
              <option value="platform-protected">Platform deployment protection</option>
              <option value="client-environment">Client-controlled environment</option>
              <option value="other">Other or mixed</option>
            </select>
          </label>
          <label>
            Desired next step
            <select name="desiredNextStep" defaultValue="discovery-call" required>
              <option value="discovery-call">Short discovery call</option>
              <option value="synthetic-demo">Synthetic product demo</option>
              <option value="design-partner">Discuss a future pilot</option>
            </select>
          </label>
          <label className="demo-request-fields__wide">
            How do approvals work today?
            <textarea name="currentProcess" minLength={20} maxLength={2_000} placeholder="Where the decision happens, who chases it, and what usually delays invoicing…" required />
          </label>
        </fieldset>
        <label className="sr-only" aria-hidden="true">
          Fax number
          <input name="faxNumber" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {step === 2 && <label className="attestation demo-request-consent">
          <input name="consent" type="checkbox" value="true" required />
          <span><strong>I am 18+ and acting for a business.</strong> Greenlit may use this information to evaluate and respond to this request under the <Link href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</Link>.</span>
        </label>}
      {error && <div className="analysis-error" role="alert">{error}</div>}
      {step === 1
        ? <button className="button button--lime" type="button" onClick={continueToFitQuestions}>Continue to workflow fit <ArrowRight size={16} /></button>
        : <div className="demo-request-actions">
            <button className="button button--outline" type="button" disabled={submitting} onClick={() => setStep(1)}>Back</button>
            <button className="button button--lime" disabled={submitting}>
              {submitting ? <><LoaderCircle className="spin" size={16} /> Recording request…</> : <>Request a conversation <ArrowRight size={16} /></>}
            </button>
          </div>}
    </form>
  );
}
