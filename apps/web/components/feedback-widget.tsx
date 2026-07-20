"use client";

import { FormEvent, useState } from "react";
import { Check, MessageSquareText, X } from "lucide-react";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("BUG");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, message, email, pagePath: window.location.pathname }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Feedback could not be sent.");
      setStatus(`Received as ${payload.feedbackId}`); setMessage("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Feedback could not be sent."); }
    finally { setBusy(false); }
  };

  return <div className={`feedback-widget ${open ? "is-open" : ""}`}>
    {open && <section className="feedback-card" role="dialog" aria-label="Beta feedback"><button className="dialog-close" aria-label="Close feedback" onClick={() => setOpen(false)}><X size={16} /></button><div className="legal-kicker">Closed beta feedback</div><h2>Tell us what got in your way.</h2><p>Include what you expected and what happened. Do not paste SOW content, credentials, or client data.</p><form onSubmit={submit}><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="BUG">Something broke</option><option value="CONFUSING">Something was confusing</option><option value="IDEA">Product idea</option><option value="OTHER">Other</option></select></label><label>What happened?<textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} required /></label><label>Email for follow-up (optional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{status && <div className="form-message" role="status">{status}</div>}<button className="button button--ink button--small" disabled={busy || message.trim().length < 10}>{busy ? "Sending…" : "Send feedback"}</button></form></section>}
    <button className="feedback-trigger" onClick={() => setOpen((value) => !value)}>{status.startsWith("Received") ? <Check size={15} /> : <MessageSquareText size={15} />}{open ? "Close" : "Beta feedback"}</button>
  </div>;
}
