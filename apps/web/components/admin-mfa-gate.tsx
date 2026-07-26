"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { Brand } from "@/components/brand";
import { clientRequestMessage, fetchWithTimeout } from "@/lib/client-request";

type MfaState = { aal2?: boolean; verifiedFactors?: Array<{ id: string; friendlyName: string }>; error?: string };

export function AdminMfaGate() {
  const [state, setState] = useState<MfaState | null>(null);
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setState(null);
    try {
      const response = await fetchWithTimeout("/api/admin/mfa", { cache: "no-store" });
      const payload = await response.json() as MfaState;
      if (!response.ok) throw new Error(payload.error ?? "Multi-factor status is unavailable.");
      setState(payload);
      if (payload.verifiedFactors?.[0]) setFactorId(payload.verifiedFactors[0].id);
    } catch (cause) {
      setError(clientRequestMessage(cause, "Multi-factor status is unavailable."));
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const enroll = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetchWithTimeout("/api/admin/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enroll" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Enrollment could not be started.");
      setFactorId(payload.factorId);
      setQrCode(payload.qrCode ?? "");
      setSecret(payload.secret ?? "");
    } catch (cause) { setError(clientRequestMessage(cause, "Enrollment could not be started.")); }
    finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetchWithTimeout("/api/admin/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", factorId, code }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The authenticator code was not accepted.");
      window.location.reload();
    } catch (cause) { setError(clientRequestMessage(cause, "The authenticator code was not accepted.")); }
    finally { setBusy(false); }
  };

  const hasFactor = Boolean(factorId || state?.verifiedFactors?.length);
  return <main className="auth-shell"><section className="auth-card admin-mfa-card"><Brand /><span className="auth-mark"><ShieldCheck size={30} /></span><div className="legal-kicker">Operator security</div><h1>Verify with your authenticator.</h1><p>The operator console can export or delete retained data, so every session requires a second factor.</p>{!state && !error ? <LoaderCircle className="spin" /> : !hasFactor && state ? <button className="button button--lime" disabled={busy} onClick={() => void enroll()}>{busy ? "Starting…" : "Set up authenticator app"} <ArrowRight size={16} /></button> : null}{qrCode && <div className="mfa-enrollment"><Image unoptimized width={220} height={220} src={qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf8,${encodeURIComponent(qrCode)}`} alt="Authenticator QR code" /><p>Scan this in your authenticator app. Manual key: <code>{secret}</code></p></div>}{hasFactor && <form onSubmit={verify}><label htmlFor="mfa-code">Six-digit code</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /><button className="button button--ink" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Open operator console"}</button></form>}{error && <><div className="analysis-error" role="alert">{error}</div><button className="button button--outline" type="button" onClick={() => void load()}><RefreshCw size={15} /> Retry status check</button></>}</section></main>;
}
