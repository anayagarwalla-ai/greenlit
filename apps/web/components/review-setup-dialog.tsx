"use client";

import { FormEvent, RefObject, useEffect, useRef, useState } from "react";
import { CalendarClock, LockKeyhole, X } from "lucide-react";
import { formatTimestamp } from "@/lib/format";

export type ReviewExpiryHours = 24 | 48 | 72 | 120 | 168;

const expiryOptions: Array<{ value: ReviewExpiryHours; label: string }> = [
  { value: 24, label: "1 day" },
  { value: 48, label: "2 days" },
  { value: 72, label: "3 days" },
  { value: 120, label: "5 days" },
  { value: 168, label: "7 days" },
];

export function ReviewSetupDialog({
  initialEmail,
  busy,
  error,
  returnFocusRef,
  onClose,
  onSubmit,
}: {
  initialEmail: string;
  busy: boolean;
  error?: string;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSubmit: (details: { reviewerEmail: string; expiryHours: ReviewExpiryHours }) => void | Promise<void>;
}) {
  const [reviewerEmail, setReviewerEmail] = useState(() => initialEmail);
  const [expiryHours, setExpiryHours] = useState<ReviewExpiryHours>(72);
  const [openedAt] = useState(() => Date.now());
  const dialogRef = useRef<HTMLElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    window.setTimeout(() => emailRef.current?.focus(), 0);
    const node = dialogRef.current;
    const returnFocusTarget = returnFocusRef?.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      returnFocusTarget?.focus();
    };
  }, [returnFocusRef]);

  const dueAt = new Date(openedAt + expiryHours * 3_600_000);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reviewerEmail.trim() || busy) return;
    void onSubmit({ reviewerEmail: reviewerEmail.trim(), expiryHours });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section ref={dialogRef} className="dialog review-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="review-setup-title" aria-describedby="review-setup-description">
        <button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="Close review setup"><X size={17} /></button>
        <CalendarClock size={25} aria-hidden="true" />
        <h2 id="review-setup-title">Set the client decision window</h2>
        <p id="review-setup-description">Name one authorized reviewer and set a clear response deadline. The confirmed criteria revision stays frozen; a change request reopens the workflow without rewriting the original promise.</p>
        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="review-recipient-email">Authorized reviewer email</label>
            <input ref={emailRef} id="review-recipient-email" type="email" autoComplete="email" value={reviewerEmail} onChange={(event) => setReviewerEmail(event.target.value)} required />
          </div>
          <div className="form-field">
            <label htmlFor="review-response-window">Response window</label>
            <select id="review-response-window" value={expiryHours} onChange={(event) => setExpiryHours(Number(event.target.value) as ReviewExpiryHours)}>
              {expiryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="review-deadline-preview" role="status">
            <CalendarClock size={15} aria-hidden="true" />
            <span><strong>Decision due {formatTimestamp(dueAt)}</strong>The secure link expires at that deadline.</span>
          </div>
          <div className="review-setup-security"><LockKeyhole size={14} aria-hidden="true" /><span>Greenlit creates a one-time link and a separate access code. Share them through separate channels.</span></div>
          {error && <div className="analysis-error" role="alert">{error}</div>}
          <div className="dialog-actions">
            <button type="button" className="button button--outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="button button--ink" disabled={busy || !reviewerEmail.trim()}>{busy ? "Creating review…" : "Create secure review"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
