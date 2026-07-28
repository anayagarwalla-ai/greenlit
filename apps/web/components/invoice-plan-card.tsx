"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, CreditCard, ExternalLink, LoaderCircle, Search, Send, X } from "lucide-react";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

type StripeConnection = { configured: boolean; connection: null | { accountId: string; livemode: boolean; status: string; lastError?: string | null } };
type Customer = { id: string; name: string; email: string };
type SavedPlan = { billingName: string; billingEmail: string; daysUntilDue: number; memo: string; autoSend: boolean; stripeCustomerId?: string | null };

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? fallback);
  if (!payload) throw new Error(fallback);
  return payload;
}

export function InvoicePlanCard({ recordId, clientName, projectName, milestoneTitle, amountMinor, currency, mode = "pre-review", onComplete }: { recordId: string; clientName: string; projectName?: string; milestoneTitle?: string; amountMinor: number; currency: string; mode?: "pre-review" | "approved"; onComplete?: () => void }) {
  const [connection, setConnection] = useState<StripeConnection | null>(null);
  const [billingName, setBillingName] = useState(clientName);
  const [billingEmail, setBillingEmail] = useState("");
  const [daysUntilDue, setDaysUntilDue] = useState(14);
  const [memo, setMemo] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<"send" | "enable-auto" | null>(null);
  const [confirmOpenedAt, setConfirmOpenedAt] = useState(0);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const confirmDialogRef = useRef<HTMLElement>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);
  const confirmBusyRef = useRef(false);
  useEffect(() => { confirmBusyRef.current = confirmBusy; }, [confirmBusy]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchWithTimeout("/api/account/stripe", { cache: "no-store" }).then((response) => readApiResponse<StripeConnection>(response, "The Stripe connection could not be loaded.")),
      fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}/invoice-plan`, { cache: "no-store" }).then((response) => readApiResponse<{ plan: SavedPlan | null }>(response, "The saved invoice details could not be loaded.")),
    ]).then(([stripe, planPayload]) => {
      if (cancelled) return;
      setConnection(stripe as StripeConnection);
      setLoadState("ready");
      const plan = planPayload.plan as SavedPlan | null;
      if (plan) {
        setBillingName(plan.billingName);
        setBillingEmail(plan.billingEmail);
        setDaysUntilDue(plan.daysUntilDue);
        setMemo(plan.memo);
        setAutoSend(plan.autoSend);
        setCustomerId(plan.stripeCustomerId ?? null);
      }
    }).catch(() => { if (!cancelled) { setLoadState("error"); setMessage({ kind: "error", text: "Invoice setup could not be loaded. Nothing was changed." }); } });
    return () => { cancelled = true; };
  }, [recordId, loadAttempt]);

  // Confirmation-dialog accessibility: initial focus on the heading, Tab
  // trapped inside, Escape closes, and focus returns to the opener. Capture
  // phase (with stopPropagation) keeps an enclosing dialog, such as the
  // dashboard invoice modal, from also reacting to Escape/Tab.
  useEffect(() => {
    if (!confirming) return;
    const node = confirmDialogRef.current;
    node?.querySelector<HTMLElement>("h2")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!confirmBusyRef.current) setConfirming(null);
        return;
      }
      if (event.key !== "Tab" || !node) return;
      event.stopPropagation();
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      const heading = node.querySelector<HTMLElement>("h2");
      const active = document.activeElement;
      event.preventDefault();
      if (active === heading) {
        (event.shiftKey ? last : first).focus();
        return;
      }
      const activeIndex = controls.findIndex((control) => control === active);
      if (activeIndex < 0) {
        (event.shiftKey ? last : first).focus();
        return;
      }
      const nextIndex = event.shiftKey
        ? (activeIndex - 1 + controls.length) % controls.length
        : (activeIndex + 1) % controls.length;
      controls[nextIndex]?.focus();
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); confirmTriggerRef.current?.focus(); };
  }, [confirming]);

  const matchCustomers = async () => {
    setBusy("customers"); setMessage(null);
    try {
      const response = await fetchWithTimeout(`/api/account/stripe/customers?email=${encodeURIComponent(billingEmail)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Stripe customers could not be checked.");
      const matches = payload.customers as Customer[];
      setCustomers(matches);
      setCustomerId(matches.length === 1 ? matches[0]!.id : null);
      setMessage({ kind: "success", text: matches.length === 0 ? "No match found. Stripe will create this customer when the invoice is created." : matches.length === 1 ? `Matched ${matches[0]!.name || matches[0]!.email}.` : "Choose the correct Stripe customer." });
    } catch (error) { setMessage({ kind: "error", text: clientRequestMessage(error, "Stripe customers could not be checked. Nothing was changed.") }); }
    finally { setBusy(""); }
  };

  const savePlan = async (withAutoSend: boolean) => {
    const response = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}/invoice-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ billingName, billingEmail, daysUntilDue, memo, autoSend: mode === "pre-review" ? withAutoSend : false, stripeCustomerId: customerId }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Invoice details could not be saved.");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Creating or emailing an invoice, and arming automatic invoicing, always
    // goes through the explicit confirmation dialog first.
    if (mode === "approved" || autoSend) {
      confirmTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmError("");
      setConfirmOpenedAt(Date.now());
      setConfirming(mode === "approved" ? "send" : "enable-auto");
      return;
    }
    setBusy("save"); setMessage(null);
    try {
      await savePlan(false);
      setMessage({ kind: "success", text: "Saved. Nothing is sent automatically. After client approval, you can create the invoice from the dashboard." });
      onComplete?.();
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error && !(error instanceof TypeError) ? error.message : "The save could not be confirmed because of a network problem. Reopen this step to check the saved details before trying again." }); }
    finally { setBusy(""); }
  };

  const confirmAction = async () => {
    if (!confirming) return;
    setConfirmBusy(true); setConfirmError("");
    try {
      // Re-validate the required fields and the selected Stripe customer
      // immediately before acting because the form may have gone stale.
      const trimmedName = billingName.trim();
      const normalizedEmail = billingEmail.trim().toLowerCase();
      if (trimmedName.length < 2 || !EMAIL_PATTERN.test(normalizedEmail)) throw new Error("Enter the billing contact name and a valid billing email before continuing.");
      if (confirming === "enable-auto" && !customerId) throw new Error("Automatic invoicing requires a confirmed existing Stripe customer. Close this dialog and use “Check for existing Stripe customer”.");
      if (customerId) {
        const response = await fetchWithTimeout(`/api/account/stripe/customers?email=${encodeURIComponent(normalizedEmail)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "The selected Stripe customer could not be re-checked.");
        const matches = payload.customers as Customer[];
        if (!matches.some((candidate) => candidate.id === customerId)) {
          setCustomers(matches);
          setCustomerId(null);
          if (confirming === "enable-auto") setAutoSend(false);
          throw new Error("The selected Stripe customer no longer matches this billing email. Close this dialog and choose the customer again.");
        }
      }
      await savePlan(confirming === "enable-auto");
      if (confirming === "send") {
        const sendResponse = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}/invoice`, { method: "POST" }, 20_000);
        const sendPayload = await sendResponse.json().catch(() => ({}));
        if (!sendResponse.ok) throw new Error((sendPayload as { error?: string }).error ?? "The invoice could not be created.");
        setMessage({ kind: "success", text: livemode ? `Stripe sent the ${formattedAmount} invoice to ${normalizedEmail} and Greenlit saved its transaction record.` : `Stripe created a ${formattedAmount} test draft invoice. Test mode sends no email to the client.` });
      } else {
        setMessage({ kind: "success", text: livemode ? `Saved. Client approval will automatically create and email the ${formattedAmount} Stripe invoice to ${normalizedEmail}. The client review discloses this before the decision.` : `Saved. Client approval will automatically create a ${formattedAmount} draft invoice in the connected Stripe test account. Test mode sends no email. The client review discloses this before the decision.` });
      }
      setConfirming(null);
      onComplete?.();
    } catch (error) {
      setConfirmError(error instanceof Error && !(error instanceof TypeError)
        ? `${error.message} Check the Greenlit dashboard and Stripe before retrying so you do not create a duplicate.`
        : "The result could not be confirmed because of a network problem. Check the Greenlit dashboard and Stripe before retrying so you do not create a duplicate.");
    } finally { setConfirmBusy(false); }
  };

  const connected = connection?.connection?.status === "CONNECTED";
  const livemode = Boolean(connection?.connection?.livemode);
  const formattedAmount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
  const lineItemLabel = milestoneTitle ? (projectName ? `${projectName}: ${milestoneTitle}` : milestoneTitle) : "Approved milestone";
  const estimatedDue = confirmOpenedAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(confirmOpenedAt + daysUntilDue * 86_400_000)) : "";
  const finalCta = confirming === "send"
    ? livemode ? `Send ${formattedAmount} invoice` : `Create ${formattedAmount} test invoice`
    : livemode ? `Enable automatic ${formattedAmount} invoice` : `Enable automatic ${formattedAmount} test invoice`;

  if (amountMinor <= 0) {
    // A no-charge milestone has nothing to invoice; say so plainly and keep
    // every invoice action hidden.
    return <section className="panel invoice-plan-card" aria-labelledby={`invoice-plan-${recordId}`}>
      <div className="panel-header"><div><h3 id={`invoice-plan-${recordId}`}><CreditCard size={17} /> Stripe invoice</h3><p>No charge for this milestone.</p></div><span className="status-badge status-badge--neutral">No charge</span></div>
      <div className="no-charge-note">This milestone is valued at {formattedAmount}, so there is no invoice to create or send. Client approval still produces the full retained approval record.</div>
    </section>;
  }

  return <section className="panel invoice-plan-card" aria-labelledby={`invoice-plan-${recordId}`}>
    <div className="panel-header"><div><h3 id={`invoice-plan-${recordId}`}><CreditCard size={17} /> Stripe invoice</h3><p>{formattedAmount} for this exact milestone. Greenlit never handles the client’s payment details.</p></div>{connected && <span className={`status-badge ${livemode ? "status-badge--fail" : "status-badge--pass"}`}><Check size={11} /> {livemode ? "Live mode connected" : "Test mode connected"}</span>}</div>
    {loadState === "loading" ? <div className="invoice-connection-state"><LoaderCircle className="spin" size={17} /> Checking Stripe connection…</div> : loadState === "error" ? <div className="analysis-error" role="alert"><span>{message?.text ?? "Invoice setup could not be loaded."}</span><button type="button" className="mini-action" onClick={() => { setLoadState("loading"); setMessage(null); setLoadAttempt((value) => value + 1); }}>Retry</button></div> : !connection?.configured ? <div className="analysis-notice"><div><strong>Stripe sandbox setup is not configured yet.</strong><span>Add the server-side Stripe app credentials before testers use invoicing.</span></div></div> : !connected ? <div className="invoice-connect"><div><strong>Connect the agency’s Stripe account</strong><p>Invoices belong to the agency and use Stripe’s hosted payment page.</p>{connection.connection?.lastError && <span>{connection.connection.lastError}</span>}</div><a className="button button--ink button--small" href="/api/stripe/install">Connect Stripe <ExternalLink size={13} /></a></div> : <form onSubmit={submit}>
      {!livemode && <p className="invoice-mode-note">Test mode: invoices are created as Stripe test drafts and are never emailed to the client.</p>}
      <div className="invoice-fields">
        <label>Billing contact name<input value={billingName} onChange={(event) => setBillingName(event.target.value)} minLength={2} maxLength={160} autoComplete="organization" required /></label>
        <label>Billing email<input type="email" value={billingEmail} onChange={(event) => { setBillingEmail(event.target.value); setCustomerId(null); setCustomers([]); setAutoSend(false); }} maxLength={320} autoComplete="email" required /></label>
        <label>Payment due<select value={daysUntilDue} onChange={(event) => setDaysUntilDue(Number(event.target.value))}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={45}>45 days</option><option value={60}>60 days</option></select></label>
      </div>
      <div className="invoice-customer-row"><button type="button" className="mini-action" onClick={() => void matchCustomers()} disabled={busy !== "" || !billingEmail.includes("@")}><Search size={12} /> {busy === "customers" ? "Checking…" : "Check for existing Stripe customer"}</button>{customers.length > 1 && <label>Stripe customer<select value={customerId ?? ""} onChange={(event) => { setCustomerId(event.target.value || null); if (!event.target.value) setAutoSend(false); }} required><option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.email} · {customer.id}</option>)}</select></label>}</div>
      <label className="invoice-memo">Invoice memo (optional)<textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={500} placeholder="Approved milestone delivered according to the attached acceptance record." /></label>
      {mode === "pre-review" && <label className="decision-consent invoice-auto-send"><input type="checkbox" checked={autoSend} disabled={!customerId} onChange={(event) => setAutoSend(event.target.checked)} /><span>{livemode ? "Automatically create and email this Stripe invoice after the client approves. The client review will disclose this before the decision." : "Automatically create this invoice as a Stripe test draft after the client approves. Test mode sends no email. The client review will disclose this before the decision."}{!customerId && <em className="invoice-auto-send-hint"> Automatic invoicing requires a confirmed existing Stripe customer: use “Check for existing Stripe customer” and select the match first.</em>}</span></label>}
      {message && <div className={message.kind === "error" ? "form-message form-message--error" : "form-message"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
      <div className="invoice-actions"><small>{mode === "approved" ? livemode ? "Continuing opens a final confirmation before Stripe creates and emails the invoice." : "Continuing opens a final confirmation before Stripe creates a test draft invoice. No email is sent in test mode." : autoSend ? "Continuing opens a final confirmation before automatic invoicing is enabled. Details are hash-bound into the client-review snapshot." : "Details are hash-bound into the client-review snapshot. Nothing is created or sent until you choose to."}</small><button className="button button--ink button--small" disabled={busy !== "" || confirmBusy || !billingName.trim() || !billingEmail.trim()}>{busy === "save" ? <LoaderCircle className="spin" size={13} /> : mode === "approved" ? <Send size={13} /> : <Check size={13} />}{mode === "approved" ? (livemode ? "Review & send invoice" : "Review & create test invoice") : autoSend ? "Review automatic invoicing" : "Save invoice details"}</button></div>
    </form>}
    {confirming && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !confirmBusy) setConfirming(null); }}>
      <section ref={confirmDialogRef} className="dialog invoice-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={`invoice-confirm-title-${recordId}`}>
        <button className="dialog-close" onClick={() => { if (!confirmBusy) setConfirming(null); }} aria-label="Close invoice confirmation"><X size={17} /></button>
        <h2 id={`invoice-confirm-title-${recordId}`} tabIndex={-1}>{confirming === "send" ? (livemode ? "Send this invoice now?" : "Create this test invoice?") : "Enable automatic invoicing?"}</h2>
        <p>{confirming === "send"
          ? livemode ? "Stripe will create this invoice and email it to the client immediately." : "Stripe will create a draft invoice in the connected test account. Test mode sends no email to the client."
          : livemode ? "After the client approves, Stripe will create and email this invoice automatically. The client review discloses this before the decision." : "After the client approves, Stripe will create this invoice as a test draft automatically. Test mode sends no email. The client review discloses this before the decision."}</p>
        <dl className="invoice-confirm-facts">
          <div><dt>Invoice mode</dt><dd>{confirming === "enable-auto" ? (livemode ? "Automatic · live (emails the client)" : "Automatic · test draft (no email)") : livemode ? "Live (emails the client)" : "Test draft (no email)"}</dd></div>
          <div><dt>Stripe account</dt><dd>{connection?.connection?.accountId} ({livemode ? "live" : "test"} mode)</dd></div>
          <div><dt>Client</dt><dd>{clientName}</dd></div>
          <div><dt>Billing contact</dt><dd>{billingName}</dd></div>
          <div><dt>Billing email</dt><dd>{billingEmail}</dd></div>
          <div><dt>Amount</dt><dd>{formattedAmount} {currency.toUpperCase()}</dd></div>
          <div><dt>Due</dt><dd>{daysUntilDue} days after creation (about {estimatedDue})</dd></div>
          <div><dt>Line item</dt><dd>{lineItemLabel}</dd></div>
          {memo.trim() && <div><dt>Memo</dt><dd>{memo}</dd></div>}
          {customerId && <div><dt>Stripe customer</dt><dd>{customers.find((candidate) => candidate.id === customerId)?.email ?? billingEmail} · {customerId}</dd></div>}
        </dl>
        {confirmError && <div className="analysis-error" role="alert">{confirmError}</div>}
        <div className="dialog-actions">
          <button type="button" className="button button--outline" onClick={() => setConfirming(null)} disabled={confirmBusy}>Cancel</button>
          <button type="button" className="button button--ink" onClick={() => void confirmAction()} disabled={confirmBusy}>{confirmBusy ? <><LoaderCircle className="spin" size={13} /> Re-checking &amp; {confirming === "send" ? "creating…" : "saving…"}</> : finalCta}</button>
        </div>
      </section>
    </div>}
  </section>;
}
