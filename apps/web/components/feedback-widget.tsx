"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, MessageSquareText, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("BUG");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  const emailIsValid = !email.trim() || emailPattern.test(email.trim());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setBusy(true); setStatus(null);
    try {
      const response = await fetchWithTimeout("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, message, email, pagePath: window.location.pathname }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Feedback could not be sent.");
      setStatus({ kind: "success", message: `Received as ${payload.feedbackId}. Thank you—we saved your report.` }); setMessage("");
      window.setTimeout(() => successHeadingRef.current?.focus({ preventScroll: true }), 0);
    } catch (error) { setStatus({ kind: "error", message: clientRequestMessage(error, "Feedback could not be sent.") }); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.querySelector<HTMLElement>("button,select,input,textarea")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled])"));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); trigger?.focus(); };
  }, [open]);

  if (pathname.startsWith("/review/") || pathname.startsWith("/receipt/")) return null;
  const close = () => setOpen(false);
  const placement = pathname === "/" ? "feedback-widget--landing" : pathname === "/login" ? "feedback-widget--login" : pathname === "/workspace" ? "" : "feedback-widget--offset";
  return <div className={`feedback-widget ${placement} ${open ? "is-open" : ""}`}>
    {open && <div className="feedback-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><section ref={dialogRef} className="feedback-card" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><button className="dialog-close" aria-label="Close feedback" onClick={close}><X size={16} /></button>{status?.kind === "success" ? <div className="feedback-success"><Check size={24} /><h2 ref={successHeadingRef} tabIndex={-1} id="feedback-title">Feedback received.</h2><p role="status">{status.message}</p><button className="button button--outline button--small" onClick={() => setStatus(null)}>Send another</button></div> : <><div className="legal-kicker">Closed beta feedback</div><h2 id="feedback-title">Tell us what got in your way.</h2><p>Include what you expected and what happened. Do not paste SOW content, credentials, or client data.</p><form onSubmit={submit}><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="BUG">Something broke</option><option value="CONFUSING">Something was confusing</option><option value="IDEA">Product idea</option><option value="OTHER">Other</option></select></label><label>What happened?<textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} required /></label><label>Email for follow-up (optional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{status?.kind === "error" && <div className="form-message form-message--error" role="alert">{status.message}</div>}<button className="button button--ink button--small" disabled={busy || message.trim().length < 10 || !emailIsValid}>{busy ? "Sending…" : "Send feedback"}</button></form></>}</section></div>}
    <button ref={triggerRef} className="feedback-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>{status?.kind === "success" ? <Check size={15} /> : <MessageSquareText size={15} />}{open ? "Close" : "Beta feedback"}</button>
  </div>;
}
