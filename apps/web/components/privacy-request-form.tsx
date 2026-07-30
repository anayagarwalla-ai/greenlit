"use client";

import { FormEvent, useState } from "react";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PrivacyRequestForm({ mode = "privacy" }: { mode?: "privacy" | "security" }) {
  const [status, setStatus] = useState<{ state: "idle" | "sending" | "done" | "error"; message?: string }>({ state: "idle" });
  const [email, setEmail] = useState("");
  const emailIsValid = emailPattern.test(email.trim());
  const isSecurityReport = mode === "security";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !emailIsValid) return;
    const data = new FormData(form);
    const details = String(data.get("details") ?? "").trim();
    setStatus({ state: "sending" });
    try {
      const response = await fetchWithTimeout("/api/privacy-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestType: data.get("requestType"),
          email: data.get("email"),
          details: isSecurityReport ? `Security concern:\n${details}` : details,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The request could not be submitted.");
      form.reset();
      setEmail("");
      setStatus({ state: "done", message: payload.identityVerified
        ? `Request ${payload.requestId} was received and verified through your signed-in session. Keep this number for your records.`
        : isSecurityReport
          ? `Report ${payload.requestId} was received. Open the verification link sent to ${data.get("email")} so Greenlit can verify a follow-up channel for this report.`
          : `Request ${payload.requestId} was received. Open the verification link sent to ${data.get("email")} before Greenlit can export, correct, or delete data.` });
    } catch (error) {
      setStatus({ state: "error", message: clientRequestMessage(error, "The request could not be submitted.") });
    }
  };

  return (
    <form className="legal-form" onSubmit={submit}>
      <label>Request type<select name="requestType" defaultValue={isSecurityReport ? "OTHER" : "ACCESS"}>{isSecurityReport ? <option value="OTHER">Security concern</option> : <><option value="ACCESS">Access my data</option><option value="EXPORT">Export my data</option><option value="CORRECTION">Correct my data</option><option value="DELETION">Delete my data</option><option value="OTHER">Other privacy request</option></>}</select></label>
      <label>Business email<input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Details<textarea name="details" minLength={isSecurityReport ? 10 : undefined} maxLength={isSecurityReport ? 1_980 : 2_000} required={isSecurityReport} placeholder={isSecurityReport ? "Describe the affected feature, impact, and safe reproduction steps. Do not include credentials, access codes, or client data." : "Include a packet or receipt ID if available. Do not include passwords, API keys, or sensitive information."} /></label>
      <button className="button button--ink" disabled={status.state === "sending" || !emailIsValid}>{status.state === "sending" ? "Submitting…" : isSecurityReport ? "Submit security report" : "Submit privacy request"}</button>
      {status.message && <p className={status.state === "error" ? "form-message is-error" : "form-message"} role={status.state === "error" ? "alert" : "status"}>{status.message}</p>}
    </form>
  );
}
