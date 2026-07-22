"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CheckCircle2, CircleDot, Clipboard, ExternalLink, LoaderCircle, LockKeyhole, Play, ShieldCheck } from "lucide-react";
import { checkSpecSchema, type CheckSpec } from "@greenlit/contracts";
import type { AnalysisCriterion } from "@/lib/analysis";

export type CheckDraft = {
  path: string;
  elementRef: string;
  assertion: "visible" | "enabled" | "count";
  expectedCount: string;
  expectedPath: string;
  fields: string;
  submitRef: string;
  successText: string;
  successPath: string;
  expectedPostPath: string;
  expectedStatus: string;
  mutationAcknowledged: boolean;
  viewports: "mobile" | "desktop" | "both";
  maxOverflow: string;
};

export type CustomRunConfiguration = {
  targetUrl: string;
  originReceipt: string;
  buildLabel: string;
  checks: CheckSpec[];
};

export function initialDraft(): CheckDraft {
  return {
    path: "/",
    elementRef: "button:",
    assertion: "visible",
    expectedCount: "1",
    expectedPath: "/",
    fields: "Email=qa+greenlit@example.com",
    submitRef: "button:Submit",
    successText: "",
    successPath: "",
    expectedPostPath: "",
    expectedStatus: "200",
    mutationAcknowledged: false,
    viewports: "both",
    maxOverflow: "1",
  };
}

function draftFromCheck(check: CheckSpec): CheckDraft {
  const draft = initialDraft();
  draft.path = check.path;
  if (check.type === "element_state") { draft.elementRef = check.elementRef; draft.assertion = check.assertion; draft.expectedCount = String(check.expectedCount ?? 1); }
  if (check.type === "link_destination") { draft.elementRef = check.elementRef; draft.expectedPath = check.expectedPath; }
  if (check.type === "form_submission") {
    draft.fields = check.fields.map((field) => `${field.label}=${field.value}`).join("\n");
    draft.submitRef = check.submitRef; draft.successText = check.successText ?? ""; draft.successPath = check.successPath ?? ""; draft.expectedPostPath = check.expectedPostPath ?? ""; draft.expectedStatus = String(check.expectedStatus ?? 200); draft.mutationAcknowledged = true;
  }
  if (check.type === "viewport_layout") {
    draft.viewports = check.viewports.length > 1 ? "both" : check.viewports[0]?.width === 390 ? "mobile" : "desktop";
    draft.maxOverflow = String(check.maxHorizontalOverflowPx);
  }
  if (check.type === "axe_scan") { draft.submitRef = check.submitRef ?? ""; draft.mutationAcknowledged = Boolean(check.ownerAcknowledgedMutation); }
  return draft;
}

function safePath(value: string, label: string, optional = false) {
  const trimmed = value.trim();
  if (optional && !trimmed) return undefined;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) throw new Error(`${label} must be a same-origin path beginning with /.`);
  return trimmed;
}

export function buildCheck(criterion: AnalysisCriterion, draft: CheckDraft, index: number): CheckSpec {
  const base = {
    id: `CHK-${String(index + 1).padStart(2, "0")}`,
    criterionId: criterion.id,
    path: safePath(draft.path, `${criterion.id} page path`),
    sourceQuote: criterion.sourceQuote,
    confirmedByHuman: true as const,
  };
  let candidate: unknown;
  if (criterion.checkType === "element_state") {
    if (!draft.elementRef.trim()) throw new Error(`${criterion.id} element reference is required.`);
    if (draft.assertion === "count" && (!Number.isInteger(Number(draft.expectedCount)) || Number(draft.expectedCount) < 0 || Number(draft.expectedCount) > 100)) throw new Error(`${criterion.id} expected count must be a whole number from 0 to 100.`);
    candidate = {
      ...base,
      type: "element_state",
      elementRef: draft.elementRef.trim(),
      assertion: draft.assertion,
      ...(draft.assertion === "count" ? { expectedCount: Number(draft.expectedCount) } : {}),
    };
  } else if (criterion.checkType === "link_destination") {
    if (!draft.elementRef.trim()) throw new Error(`${criterion.id} element reference is required.`);
    candidate = { ...base, type: "link_destination", elementRef: draft.elementRef.trim(), expectedPath: safePath(draft.expectedPath, `${criterion.id} expected destination`) };
  } else if (criterion.checkType === "form_submission") {
    const fields = draft.fields.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const split = line.indexOf("=");
      if (split < 1) throw new Error(`${criterion.id} form values must use one Label=value pair per line.`);
      const label = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      if (!label || !value) throw new Error(`${criterion.id} form values require both a label and value on every line.`);
      return { label, value };
    });
    if (fields.length === 0) throw new Error(`${criterion.id} form values require at least one Label=value pair.`);
    if (!draft.submitRef.trim()) throw new Error(`${criterion.id} submit element is required.`);
    const expectedPostPath = safePath(draft.expectedPostPath, `${criterion.id} POST path`, true);
    const successText = draft.successText.trim() || undefined;
    const successPath = safePath(draft.successPath, `${criterion.id} success path`, true);
    if (!successText && !successPath && !expectedPostPath) throw new Error(`${criterion.id} needs a success message, success path, or expected POST path so it cannot pass without evidence.`);
    if (expectedPostPath && (!Number.isInteger(Number(draft.expectedStatus)) || Number(draft.expectedStatus) < 200 || Number(draft.expectedStatus) > 399)) throw new Error(`${criterion.id} expected status must be between 200 and 399.`);
    if (!draft.mutationAcknowledged) throw new Error(`${criterion.id} requires confirmation that the staging form may receive the test submission.`);
    candidate = {
      ...base,
      type: "form_submission",
      fields,
      submitRef: draft.submitRef.trim(),
      successText,
      successPath,
      expectedPostPath,
      ...(expectedPostPath && draft.expectedStatus ? { expectedStatus: Number(draft.expectedStatus) } : {}),
      ownerAcknowledgedMutation: true,
    };
  } else if (criterion.checkType === "viewport_layout") {
    if (!Number.isFinite(Number(draft.maxOverflow)) || Number(draft.maxOverflow) < 0 || Number(draft.maxOverflow) > 20) throw new Error(`${criterion.id} maximum horizontal overflow must be from 0 to 20 pixels.`);
    const viewports = draft.viewports === "mobile"
      ? [{ width: 390, height: 844, label: "Mobile" }]
      : draft.viewports === "desktop"
        ? [{ width: 1280, height: 720, label: "Desktop" }]
        : [{ width: 390, height: 844, label: "Mobile" }, { width: 1280, height: 720, label: "Desktop" }];
    candidate = { ...base, type: "viewport_layout", viewports, maxHorizontalOverflowPx: Number(draft.maxOverflow) };
  } else if (criterion.checkType === "axe_scan") {
    if (draft.submitRef.trim() && !draft.mutationAcknowledged) throw new Error(`${criterion.id} requires confirmation before the accessibility check submits a form.`);
    candidate = {
      ...base,
      type: "axe_scan",
      tags: ["wcag2a", "wcag2aa", "wcag22aa"],
      failImpacts: ["critical", "serious"],
      ...(draft.submitRef.trim() ? { submitRef: draft.submitRef.trim(), ownerAcknowledgedMutation: true } : {}),
    };
  } else {
    throw new Error(`${criterion.id} is marked for human review and should not have a browser mapping.`);
  }
  const parsed = checkSpecSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`${criterion.id} mapping is incomplete: ${parsed.error.issues[0]?.message ?? "check the values"}.`);
  return parsed.data;
}

function MappingFields({ criterion, draft, update, error }: { criterion: AnalysisCriterion; draft: CheckDraft; update: (patch: Partial<CheckDraft>) => void; error: string }) {
  const errorId = `${criterion.id}-mapping-error`;
  const invalid = (...markers: string[]) => Boolean(error) && markers.some((marker) => error.toLowerCase().includes(marker));
  const describedBy = (...markers: string[]) => invalid(...markers) ? errorId : undefined;
  return (
    <div className="mapping-fields">
      {error && <p className="analysis-error mapping-wide" id={errorId} role="alert">{error}</p>}
      <label>{criterion.id} page path<input aria-label={`${criterion.id} page path`} aria-invalid={invalid("page path")} aria-describedby={describedBy("page path")} value={draft.path} onChange={(event) => update({ path: event.target.value })} placeholder="/contact" /></label>
      {(criterion.checkType === "element_state" || criterion.checkType === "link_destination") && <label>{criterion.id} element reference<input aria-label={`${criterion.id} element reference`} aria-invalid={invalid("element reference")} aria-describedby={describedBy("element reference")} value={draft.elementRef} onChange={(event) => update({ elementRef: event.target.value })} placeholder="button:Get started" /><small>Exact accessible role:name, such as link:Contact us.</small></label>}
      {criterion.checkType === "element_state" && <><label>{criterion.id} assertion<select aria-label={`${criterion.id} assertion`} aria-invalid={invalid("assertion")} aria-describedby={describedBy("assertion")} value={draft.assertion} onChange={(event) => update({ assertion: event.target.value as CheckDraft["assertion"] })}><option value="visible">Visible</option><option value="enabled">Enabled</option><option value="count">Exact count</option></select></label>{draft.assertion === "count" && <label>{criterion.id} expected count<input aria-label={`${criterion.id} expected count`} aria-invalid={invalid("expected count")} aria-describedby={describedBy("expected count")} type="number" min="0" max="100" value={draft.expectedCount} onChange={(event) => update({ expectedCount: event.target.value })} /></label>}</>}
      {criterion.checkType === "link_destination" && <label>{criterion.id} expected same-origin path<input aria-label={`${criterion.id} expected same-origin path`} aria-invalid={invalid("expected destination")} aria-describedby={describedBy("expected destination")} value={draft.expectedPath} onChange={(event) => update({ expectedPath: event.target.value })} placeholder="/contact" /></label>}
      {criterion.checkType === "form_submission" && <>
        <label className="mapping-wide">{criterion.id} test values<textarea aria-label={`${criterion.id} test values`} aria-invalid={invalid("form values")} aria-describedby={describedBy("form values")} value={draft.fields} onChange={(event) => update({ fields: event.target.value })} placeholder={"Email=qa@example.com\nMessage=Greenlit beta test"} /><small>One accessible field label and test value per line.</small></label>
        <label>{criterion.id} submit element<input aria-label={`${criterion.id} submit element`} aria-invalid={invalid("submit element")} aria-describedby={describedBy("submit element")} value={draft.submitRef} onChange={(event) => update({ submitRef: event.target.value })} placeholder="button:Send" /></label>
        <label>{criterion.id} success message<input aria-label={`${criterion.id} success message`} aria-invalid={invalid("success message")} aria-describedby={describedBy("success message")} value={draft.successText} onChange={(event) => update({ successText: event.target.value })} placeholder="Thanks, we received it" /></label>
        <label>{criterion.id} success page path<input aria-label={`${criterion.id} success page path`} aria-invalid={invalid("success path")} aria-describedby={describedBy("success path")} value={draft.successPath} onChange={(event) => update({ successPath: event.target.value })} placeholder="/thank-you (optional)" /></label>
        <label>{criterion.id} expected POST path<input aria-label={`${criterion.id} expected POST path`} aria-invalid={invalid("post path")} aria-describedby={describedBy("post path")} value={draft.expectedPostPath} onChange={(event) => update({ expectedPostPath: event.target.value })} placeholder="/api/leads (optional)" /></label>
        <label>{criterion.id} expected status<input aria-label={`${criterion.id} expected status`} aria-invalid={invalid("expected status")} aria-describedby={describedBy("expected status")} type="number" min="200" max="399" value={draft.expectedStatus} disabled={!draft.expectedPostPath.trim()} onChange={(event) => update({ expectedStatus: event.target.value })} /></label>
        <label className="mapping-consent mapping-wide"><input type="checkbox" checked={draft.mutationAcknowledged} onChange={(event) => update({ mutationAcknowledged: event.target.checked })} /><span>I own or am authorized to test this staging form and accept the labeled test submission.</span></label>
      </>}
      {criterion.checkType === "viewport_layout" && <><label>{criterion.id} viewports<select aria-label={`${criterion.id} viewports`} aria-invalid={invalid("viewport")} aria-describedby={describedBy("viewport")} value={draft.viewports} onChange={(event) => update({ viewports: event.target.value as CheckDraft["viewports"] })}><option value="both">Mobile + desktop</option><option value="mobile">Mobile only</option><option value="desktop">Desktop only</option></select></label><label>{criterion.id} maximum horizontal overflow (px)<input aria-label={`${criterion.id} maximum horizontal overflow`} aria-invalid={invalid("maximum horizontal overflow")} aria-describedby={describedBy("maximum horizontal overflow")} type="number" min="0" max="20" value={draft.maxOverflow} onChange={(event) => update({ maxOverflow: event.target.value })} /></label></>}
      {criterion.checkType === "axe_scan" && <><label>{criterion.id} optional submit element<input aria-label={`${criterion.id} optional submit element`} aria-invalid={invalid("submit element")} aria-describedby={describedBy("submit element")} value={draft.submitRef} onChange={(event) => update({ submitRef: event.target.value })} placeholder="Leave blank for a page scan" /><small>Use only to expose validation messages before scanning.</small></label>{draft.submitRef.trim() && <label className="mapping-consent mapping-wide"><input type="checkbox" checked={draft.mutationAcknowledged} onChange={(event) => update({ mutationAcknowledged: event.target.checked })} /><span>I authorize this staging interaction.</span></label>}</>}
    </div>
  );
}

export function VerificationSetup({ criteria, sourceName, signedInEmail, initialConfiguration, onBack, onDemo, onRun }: {
  criteria: AnalysisCriterion[];
  sourceName: string;
  signedInEmail: string;
  initialConfiguration?: CustomRunConfiguration | null;
  onBack: () => void;
  onDemo: () => void;
  onRun: (configuration: CustomRunConfiguration) => void;
}) {
  const automated = useMemo(() => criteria.filter((item) => item.supported && item.checkType !== "manual"), [criteria]);
  const [target, setTarget] = useState(initialConfiguration?.targetUrl ?? "");
  const [token, setToken] = useState("");
  const [receipt, setReceipt] = useState(initialConfiguration?.originReceipt ?? "");
  const [verifiedOrigin, setVerifiedOrigin] = useState(initialConfiguration?.originReceipt ? initialConfiguration.targetUrl : "");
  const [buildLabel, setBuildLabel] = useState(initialConfiguration?.buildLabel ?? "beta-rc1");
  const [drafts, setDrafts] = useState<Record<string, CheckDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [evidenceConsent, setEvidenceConsent] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setToken(`mp_${crypto.randomUUID().replaceAll("-", "")}`);
      const saved = new Map(initialConfiguration?.checks.map((check) => [check.criterionId, check]));
      setDrafts(Object.fromEntries(automated.map((item) => [item.id, saved.get(item.id) ? draftFromCheck(saved.get(item.id)!) : initialDraft()])));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automated, initialConfiguration]);

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/verify-origin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, token }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The staging origin could not be verified.");
      setReceipt(payload.receipt);
      setVerifiedOrigin(payload.origin);
    } catch (cause) {
      setReceipt("");
      setVerifiedOrigin("");
      setError(cause instanceof Error ? cause.message : "The staging origin could not be verified.");
    } finally { setBusy(false); }
  };

  const run = () => {
    setError("");
    setFieldErrors({});
    try {
      if (!signedInEmail) throw new Error("Sign in with your business email before creating retained evidence.");
      if (!receipt || !verifiedOrigin) throw new Error("Verify this staging origin first.");
      if (!evidenceConsent) throw new Error("Confirm the staging evidence and retention notice before running checks.");
      if (!buildLabel.trim()) throw new Error("Add a build label so this evidence can be tied to a release.");
      if (automated.length === 0) throw new Error("This scope has no browser-verifiable criteria. Keep the manual items for client review, then add at least one objective browser check before running evidence.");
      if (automated.length > 6) throw new Error("The closed beta supports at most six browser checks per run. Move additional promises to client review or split the milestone.");
      const checks: CheckSpec[] = [];
      const errors: Record<string, string> = {};
      automated.forEach((criterion, index) => {
        try { checks.push(buildCheck(criterion, drafts[criterion.id] ?? initialDraft(), index)); }
        catch (cause) { errors[criterion.id] = cause instanceof Error ? cause.message : "Complete this mapping."; }
      });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        const count = Object.keys(errors).length;
        throw new Error(`${count} check mapping${count > 1 ? "s" : ""} need${count > 1 ? "" : "s"} attention below.`);
      }
      onRun({ targetUrl: verifiedOrigin, originReceipt: receipt, buildLabel: buildLabel.trim(), checks });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Complete the verification mapping."); }
  };

  return (
    <div className="verification-setup-grid">
      <section className="panel setup-main">
        <div className="setup-heading"><span className="handoff-mark"><ShieldCheck size={26} /></span><div><div className="intake-kicker">Scope frozen · connect staging</div><h2>Map the promises to evidence.</h2><p>{criteria.length} confirmed promises from <strong>{sourceName}</strong>; {automated.length} can be checked safely and {criteria.length - automated.length} remain client-reviewed.</p></div></div>
        {!signedInEmail && <div className="setup-auth"><LockKeyhole size={18} /><div><strong>Agency sign-in required</strong><span>Retained runs and client decisions belong to an agency account, so they remain accessible across devices.</span></div><Link className="button button--ink button--small" href={"/login?next=/workspace" as Route}>Sign in <ArrowRight size={13} /></Link></div>}
        {signedInEmail && <div className="setup-signed-in"><CheckCircle2 size={14} /> Retained evidence will belong to {signedInEmail}</div>}
        {error && <div className="analysis-error" role="alert">{error}</div>}

        <div className="setup-section">
          <div className="setup-section__head"><span>1</span><div><h3>Prove staging ownership</h3><p>Only public HTTPS staging sites are supported. Login screens, localhost, and private networks are blocked.</p></div></div>
          <div className="setup-fields"><label>Staging URL<input type="url" value={target} onChange={(event) => { setTarget(event.target.value); setReceipt(""); setVerifiedOrigin(""); }} placeholder="https://staging.example.com" /></label><label>Build label<input value={buildLabel} onChange={(event) => setBuildLabel(event.target.value)} placeholder="client-launch-rc3" /></label></div>
          <div className="token-instruction"><div><strong>Serve this exact text at</strong><code>/.well-known/greenlit.txt</code></div><code>{token || "Generating one-time token…"}</code><button type="button" className="mini-action" onClick={async () => { try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setCopied(false); setError("Clipboard access is unavailable. Select the token text and copy it manually."); } }}>{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? "Copied" : "Copy token"}</button></div>
          <button className="button button--outline" type="button" disabled={busy || !signedInEmail || !target || !token} onClick={() => void verify()}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}{busy ? "Checking token…" : "Verify staging origin"}</button>
          {verifiedOrigin && <div className="origin-verified"><CheckCircle2 size={15} /><span><strong>{verifiedOrigin}</strong> verified for this account for 30 minutes.</span></div>}
          <label className="mapping-consent evidence-consent"><input type="checkbox" checked={evidenceConsent} onChange={(event) => setEvidenceConsent(event.target.checked)} /><span>I am authorized to capture this public staging build. It contains no confidential data or real personal data. Screenshots will be shared with the reviewer and retained privately for 90 days. Cross-origin scripts, images, and fonts are blocked, so this staging build must render with same-origin resources.</span></label>
        </div>

        <div className="setup-section">
          <div className="setup-section__head"><span>2</span><div><h3>Map safe typed checks</h3><p>References use accessible role:name labels—not brittle CSS selectors or generated code.</p></div></div>
          <div className="mapping-list">
            {automated.map((criterion) => <article className={`mapping-card ${fieldErrors[criterion.id] ? "has-warning" : ""}`} key={criterion.id}><div className="mapping-card__head"><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><span>{criterion.checkType.replaceAll("_", " ")}</span></div></div><MappingFields criterion={criterion} draft={drafts[criterion.id] ?? initialDraft()} error={fieldErrors[criterion.id] ?? ""} update={(patch) => setDrafts((current) => ({ ...current, [criterion.id]: { ...(current[criterion.id] ?? initialDraft()), ...patch } }))} /></article>)}
            {criteria.filter((item) => !item.supported || item.checkType === "manual").map((criterion) => <article className="mapping-card mapping-card--manual" key={criterion.id}><div className="mapping-card__head"><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><span>Client-reviewed promise · no automated evidence claim</span></div></div></article>)}
          </div>
        </div>

        <div className="handoff-actions"><button className="button button--lime" type="button" disabled={!signedInEmail || busy || !evidenceConsent} onClick={run}>Run verified checks <Play size={15} /></button><button className="button button--outline" type="button" onClick={onBack}>Back to criteria</button></div>
      </section>
      <aside className="panel handoff-checklist"><h3>Evidence boundary</h3><div><CheckCircle2 size={15} /><span><strong>Account-bound origin proof</strong>The signed receipt cannot be reused by another account or hostname.</span></div><div><CircleDot size={15} /><span><strong>Same-origin resources only</strong>Navigation and page resources cannot leave the verified origin or reach internal networks.</span></div><div><CircleDot size={15} /><span><strong>Explicit form consent</strong>Potential mutations require a separate authorization.</span></div><div className="boundary-callout"><LockKeyhole size={15} /><div><strong>Need a reliable fallback?</strong><p>The synthetic walkthrough never claims retained evidence.</p><button className="text-action" onClick={onDemo}>Open guided demo <ExternalLink size={12} /></button></div></div></aside>
    </div>
  );
}
