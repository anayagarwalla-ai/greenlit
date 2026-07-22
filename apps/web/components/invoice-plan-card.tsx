"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, LoaderCircle, Search, Send } from "lucide-react";

type StripeConnection = { configured: boolean; connection: null | { accountId: string; livemode: boolean; status: string; lastError?: string | null } };
type Customer = { id: string; name: string; email: string };
type SavedPlan = { billingName: string; billingEmail: string; daysUntilDue: number; memo: string; autoSend: boolean; stripeCustomerId?: string | null };

export function InvoicePlanCard({ recordId, clientName, amountMinor, currency, mode = "pre-review", onComplete }: { recordId: string; clientName: string; amountMinor: number; currency: string; mode?: "pre-review" | "approved"; onComplete?: () => void }) {
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/account/stripe", { cache: "no-store" }).then((response) => response.json()),
      fetch(`/api/account/records/${encodeURIComponent(recordId)}/invoice-plan`, { cache: "no-store" }).then((response) => response.json()),
    ]).then(([stripe, planPayload]) => {
      if (cancelled) return;
      setConnection(stripe as StripeConnection);
      const plan = planPayload.plan as SavedPlan | null;
      if (plan) {
        setBillingName(plan.billingName);
        setBillingEmail(plan.billingEmail);
        setDaysUntilDue(plan.daysUntilDue);
        setMemo(plan.memo);
        setAutoSend(plan.autoSend);
        setCustomerId(plan.stripeCustomerId ?? null);
      }
    }).catch(() => { if (!cancelled) setMessage({ kind: "error", text: "Invoice setup could not be loaded." }); });
    return () => { cancelled = true; };
  }, [recordId]);

  const matchCustomers = async () => {
    setBusy("customers"); setMessage(null);
    try {
      const response = await fetch(`/api/account/stripe/customers?email=${encodeURIComponent(billingEmail)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Stripe customers could not be checked.");
      const matches = payload.customers as Customer[];
      setCustomers(matches);
      setCustomerId(matches.length === 1 ? matches[0]!.id : null);
      setMessage({ kind: "success", text: matches.length === 0 ? "No match found. Stripe will create this customer when the invoice is sent." : matches.length === 1 ? `Matched ${matches[0]!.name || matches[0]!.email}.` : "Choose the correct Stripe customer." });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Stripe customers could not be checked." }); }
    finally { setBusy(""); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy("save"); setMessage(null);
    try {
      const response = await fetch(`/api/account/records/${encodeURIComponent(recordId)}/invoice-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ billingName, billingEmail, daysUntilDue, memo, autoSend: mode === "pre-review" ? autoSend : false, stripeCustomerId: customerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Invoice details could not be saved.");
      if (mode === "approved") {
        setBusy("send");
        const sendResponse = await fetch(`/api/account/records/${encodeURIComponent(recordId)}/invoice`, { method: "POST" });
        const sendPayload = await sendResponse.json();
        if (!sendResponse.ok) throw new Error(sendPayload.error ?? "The invoice could not be sent.");
        setMessage({ kind: "success", text: "Stripe sent the invoice and Greenlit saved its transaction record." });
        onComplete?.();
      } else {
        setMessage({ kind: "success", text: autoSend ? "Saved. Client approval will queue this Stripe invoice automatically." : "Saved. The dashboard will offer Send invoice after client approval." });
        onComplete?.();
      }
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Invoice setup failed." }); }
    finally { setBusy(""); }
  };

  const connected = connection?.connection?.status === "CONNECTED";
  const formattedAmount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
  return <section className="panel invoice-plan-card" aria-labelledby={`invoice-plan-${recordId}`}>
    <div className="panel-header"><div><h3 id={`invoice-plan-${recordId}`}><CreditCard size={17} /> Stripe invoice</h3><p>{formattedAmount} for this exact milestone. Greenlit never handles the client’s payment details.</p></div>{connected && <span className="status-badge status-badge--pass"><Check size={11} /> Test mode connected</span>}</div>
    {!connection ? <div className="invoice-connection-state"><LoaderCircle className="spin" size={17} /> Checking Stripe connection…</div> : !connection.configured ? <div className="analysis-notice"><div><strong>Stripe sandbox setup is not configured yet.</strong><span>Add the server-side Stripe app credentials before testers use invoicing.</span></div></div> : !connected ? <div className="invoice-connect"><div><strong>Connect the agency’s Stripe account</strong><p>Invoices belong to the agency and use Stripe’s hosted payment page.</p>{connection.connection?.lastError && <span>{connection.connection.lastError}</span>}</div><a className="button button--ink button--small" href="/api/stripe/install">Connect Stripe <ExternalLink size={13} /></a></div> : <form onSubmit={save}>
      <div className="invoice-fields">
        <label>Billing contact name<input value={billingName} onChange={(event) => setBillingName(event.target.value)} minLength={2} maxLength={160} autoComplete="organization" required /></label>
        <label>Billing email<input type="email" value={billingEmail} onChange={(event) => { setBillingEmail(event.target.value); setCustomerId(null); setCustomers([]); }} maxLength={320} autoComplete="email" required /></label>
        <label>Payment due<select value={daysUntilDue} onChange={(event) => setDaysUntilDue(Number(event.target.value))}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={45}>45 days</option><option value={60}>60 days</option></select></label>
      </div>
      <div className="invoice-customer-row"><button type="button" className="mini-action" onClick={() => void matchCustomers()} disabled={busy !== "" || !billingEmail.includes("@")}><Search size={12} /> {busy === "customers" ? "Checking…" : "Check for existing Stripe customer"}</button>{customers.length > 1 && <label>Stripe customer<select value={customerId ?? ""} onChange={(event) => setCustomerId(event.target.value || null)} required><option value="">Choose customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name || customer.email} · {customer.id}</option>)}</select></label>}</div>
      <label className="invoice-memo">Invoice memo (optional)<textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={500} placeholder="Approved milestone delivered according to the attached acceptance record." /></label>
      {mode === "pre-review" && <label className="decision-consent invoice-auto-send"><input type="checkbox" checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} /><span>Automatically send this invoice after the client approves. The client review will disclose this before the decision.</span></label>}
      {message && <div className={message.kind === "error" ? "form-message form-message--error" : "form-message"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
      <div className="invoice-actions"><small>{mode === "approved" ? "Sending creates and emails the Stripe invoice now." : "Details are hash-bound into the client-review snapshot."}</small><button className="button button--ink button--small" disabled={busy !== "" || !billingName.trim() || !billingEmail.trim()}>{busy === "save" || busy === "send" ? <LoaderCircle className="spin" size={13} /> : mode === "approved" ? <Send size={13} /> : <Check size={13} />}{busy === "send" ? "Sending…" : mode === "approved" ? "Save & send invoice" : "Save invoice details"}</button></div>
    </form>}
  </section>;
}
