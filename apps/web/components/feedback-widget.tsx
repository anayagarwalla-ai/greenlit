"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, MessageSquareText, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const closeTransitionMs = 180;

export function FeedbackWidget() {
  const pathname = usePathname();
  const hiddenForPath = pathname.startsWith("/review/") || pathname.startsWith("/receipt/");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [category, setCategory] = useState("BUG");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const emailIsValid = !email.trim() || emailPattern.test(email.trim());
  const messageLength = message.trim().length;

  const show = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setMounted(true);
    window.requestAnimationFrame(() => setOpen(true));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      closeTimerRef.current = null;
    }, reduceMotion ? 0 : closeTransitionMs);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setBusy(true); setStatus(null);
    try {
      const response = await fetchWithTimeout("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, message, email, pagePath: window.location.pathname }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Feedback could not be sent.");
      setStatus({ kind: "success", message: `Received as ${payload.feedbackId}. Thank you. We saved your report.` }); setMessage("");
      window.setTimeout(() => successHeadingRef.current?.focus({ preventScroll: true }), 0);
    } catch (error) { setStatus({ kind: "error", message: clientRequestMessage(error, "Feedback could not be sent.") }); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const focusTimer = window.setTimeout(() => (successHeadingRef.current ?? titleRef.current)?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled])"));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus({ preventScroll: true });
    };
  }, [close, mounted]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!hiddenForPath) return;
    const routeTimer = window.setTimeout(() => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setOpen(false);
      setMounted(false);
    }, 0);
    return () => window.clearTimeout(routeTimer);
  }, [hiddenForPath]);

  if (hiddenForPath) return null;
  const placement = pathname === "/" ? "feedback-widget--landing" : pathname === "/login" ? "feedback-widget--login" : pathname === "/request-demo" ? "feedback-widget--demo-request" : pathname === "/workspace" ? "" : "feedback-widget--offset";
  return <div className={`feedback-widget ${placement} ${mounted ? "is-mounted" : ""}`}>
    {mounted && <div className={`feedback-backdrop ${open ? "is-open" : "is-closing"}`} onMouseDown={(event) => { if (event.currentTarget === event.target && open) close(); }}>
      <section ref={dialogRef} className="feedback-card" role="dialog" aria-modal="true" aria-labelledby="feedback-title" aria-describedby={status?.kind === "success" ? undefined : "feedback-description"}>
        <button className="dialog-close" aria-label="Close feedback" onClick={close}><X size={16} /></button>
        {status?.kind === "success"
          ? <div className="feedback-success"><Check size={24} /><h2 ref={successHeadingRef} tabIndex={-1} id="feedback-title">Feedback received.</h2><p role="status">{status.message}</p><button className="button button--outline button--small" onClick={() => { setStatus(null); window.setTimeout(() => categoryRef.current?.focus(), 0); }}>Send another</button></div>
          : <div className="feedback-content"><div className="legal-kicker">Hackathon build feedback</div><h2 ref={titleRef} tabIndex={-1} id="feedback-title">Tell us what got in your way.</h2><p id="feedback-description">Include what you expected and what happened. Do not paste SOW content, credentials, or client data.</p><form aria-busy={busy} onSubmit={submit}><label>Category<select ref={categoryRef} value={category} onChange={(event) => setCategory(event.target.value)}><option value="BUG">Something broke</option><option value="CONFUSING">Something was confusing</option><option value="IDEA">Product idea</option><option value="OTHER">Other</option></select></label><label htmlFor="feedback-message">What happened?</label><textarea id="feedback-message" value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="feedback-message-help" minLength={10} maxLength={2_000} placeholder="What did you try, what did you expect, and what happened instead?" required /><div className={`feedback-field-meta ${message.length > 0 && messageLength < 10 ? "is-error" : ""}`} id="feedback-message-help"><span>10 characters minimum</span><span>{messageLength.toLocaleString()} / 2,000</span></div><label htmlFor="feedback-email">Email for follow-up (optional)</label><input id="feedback-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="feedback-email-help" aria-invalid={!emailIsValid} maxLength={320} /><div className={`feedback-field-meta ${emailIsValid ? "" : "is-error"}`} id="feedback-email-help"><span>{emailIsValid ? "Leave blank if you prefer no follow-up." : "Enter a valid email or leave this blank."}</span></div>{status?.kind === "error" && <div className="form-message form-message--error" role="alert">{status.message}</div>}<button className="button button--ink button--small" disabled={busy || messageLength < 10 || !emailIsValid}>{busy ? "Sending…" : "Send feedback"}</button></form></div>}
      </section>
    </div>}
    <button ref={triggerRef} className="feedback-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={mounted ? close : show}>{status?.kind === "success" ? <Check size={15} /> : <MessageSquareText size={15} />}<span>Feedback</span></button>
  </div>;
}
