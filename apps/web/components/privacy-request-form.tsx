"use client";

import { FormEvent, useState } from "react";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PrivacyRequestForm() {
  const [status, setStatus] = useState<{ state: "idle" | "sending" | "done" | "error"; message?: string }>({ state: "idle" });
  const [email, setEmail] = useState("");
  const emailIsValid = emailPattern.test(email.trim());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !emailIsValid) return;
    const data = new FormData(form);
    setStatus({ state: "sending" });
    try {
      const response = await fetch("/api/privacy-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestType: data.get("requestType"), email: data.get("email"), details: data.get("details") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The request could not be submitted.");
      form.reset();
      setEmail("");
      setStatus({ state: "done", message: payload.identityVerified
        ? `Request ${payload.requestId} was received and verified through your signed-in session. Keep this number for your records.`
        : `Request ${payload.requestId} was received. Open the verification link sent to ${data.get("email")} before Greenlit can export, correct, or delete data.` });
    } catch (error) {
      setStatus({ state: "error", message: error instanceof Error ? error.message : "The request could not be submitted." });
    }
  };

  return (
    <form className="legal-form" onSubmit={submit}>
      <label>Request type<select name="requestType" defaultValue="ACCESS"><option value="ACCESS">Access my data</option><option value="EXPORT">Export my data</option><option value="CORRECTION">Correct my data</option><option value="DELETION">Delete my data</option><option value="OTHER">Other privacy request</option></select></label>
      <label>Business email<input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Details<textarea name="details" maxLength={2_000} placeholder="Include a packet or receipt ID if available. Do not include passwords, API keys, or sensitive information." /></label>
      <button className="button button--ink" disabled={status.state === "sending" || !emailIsValid}>{status.state === "sending" ? "Submitting…" : "Submit privacy request"}</button>
      {status.message && <p className={status.state === "error" ? "form-message is-error" : "form-message"} role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
    </form>
  );
}
