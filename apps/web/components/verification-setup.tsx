"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, CircleDot, Clipboard, ExternalLink, LoaderCircle, LockKeyhole, Play, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
import { checkSpecSchema, parseAccessibleElementRef, type CheckSpec } from "@greenlit/contracts";
import type { AnalysisCriterion } from "@/lib/analysis";
import { draftHintForCandidate, type MappingCandidate, type MappingDraftHint, type MappingSuggestion } from "../lib/mapping-suggestions";
import { AGENCY_BETA_SIGN_IN_VISIBLE } from "../lib/public-features";
import { clientRequestMessage, fetchWithTimeout } from "../lib/client-request";

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

export type VerificationSetupDraft = {
  target: string;
  token: string;
  receipt: string;
  verifiedOrigin: string;
  buildLabel: string;
  drafts: Record<string, CheckDraft>;
  evidenceConsent: boolean;
};

export function initialDraft(): CheckDraft {
  return {
    path: "",
    elementRef: "",
    assertion: "visible",
    expectedCount: "",
    expectedPath: "",
    fields: "",
    submitRef: "",
    successText: "",
    successPath: "",
    expectedPostPath: "",
    expectedStatus: "",
    mutationAcknowledged: false,
    viewports: "both",
    maxOverflow: "1",
  };
}

export function mergeSuggestionIntoDraft(current: CheckDraft, hint: MappingDraftHint): CheckDraft {
  return {
    ...current,
    path: current.path.trim() || hint.path || "",
    elementRef: current.elementRef.trim() || hint.elementRef || "",
    expectedPath: current.expectedPath.trim() || hint.expectedPath || "",
    fields: current.fields.trim() || hint.fields || "",
    submitRef: current.submitRef.trim() || hint.submitRef || "",
    expectedPostPath: current.expectedPostPath.trim() || hint.expectedPostPath || "",
  };
}

export function draftFromCheck(check: CheckSpec): CheckDraft {
  const draft = initialDraft();
  draft.path = check.path;
  if (check.type === "element_state") { draft.elementRef = check.elementRef; draft.assertion = check.assertion; draft.expectedCount = check.expectedCount === undefined ? "" : String(check.expectedCount); }
  if (check.type === "link_destination") { draft.elementRef = check.elementRef; draft.expectedPath = check.expectedPath; }
  if (check.type === "form_submission") {
    draft.fields = check.fields.map((field) => `${field.label}=${field.value}`).join("\n");
    draft.submitRef = check.submitRef; draft.successText = check.successText ?? ""; draft.successPath = check.successPath ?? ""; draft.expectedPostPath = check.expectedPostPath ?? ""; draft.expectedStatus = check.expectedStatus === undefined ? "" : String(check.expectedStatus); draft.mutationAcknowledged = true;
  }
  if (check.type === "viewport_layout") {
    draft.viewports = check.viewports.length > 1 ? "both" : check.viewports[0]?.width === 390 ? "mobile" : "desktop";
    draft.maxOverflow = String(check.maxHorizontalOverflowPx);
  }
  if (check.type === "axe_scan") { draft.submitRef = check.submitRef ?? ""; draft.mutationAcknowledged = Boolean(check.ownerAcknowledgedMutation); }
  return draft;
}

type StagingTargetResult = { ok: true; normalized: string; startPath: string } | { ok: false; error: string };

const blockedStagingHostnames = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const blockedStagingSuffixes = [".local", ".internal", ".localhost", ".home", ".lan"];

export function normalizeStagingTarget(value: string): StagingTargetResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Enter a public staging hostname or HTTPS URL." };
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try { url = new URL(withProtocol); }
  catch { return { ok: false, error: "Enter a valid staging hostname or HTTPS URL." }; }
  if (url.protocol !== "https:") return { ok: false, error: "Only HTTPS staging targets are allowed." };
  if (url.username || url.password) return { ok: false, error: "URLs containing credentials are not allowed." };
  if (url.port && url.port !== "443") return { ok: false, error: "Non-standard ports are not allowed." };
  if (url.hash) return { ok: false, error: "Remove the URL fragment before verification." };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || blockedStagingHostnames.has(hostname) || blockedStagingSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, error: "Local and internal targets are not allowed." };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    return { ok: false, error: "Use a public hostname rather than a literal IP address." };
  }
  return { ok: true, normalized: url.origin, startPath: `${url.pathname}${url.search}` };
}

function safePath(value: string, label: string, optional = false) {
  const trimmed = value.trim();
  if (optional && !trimmed) return undefined;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) throw new Error(`${label} must be a same-origin path beginning with /.`);
  return trimmed;
}

function safeElementRef(value: string, label: string, optional = false) {
  const trimmed = value.trim();
  if (optional && !trimmed) return undefined;
  try {
    const parsed = parseAccessibleElementRef(trimmed);
    return `${parsed.role}:${parsed.name}`;
  } catch {
    throw new Error(`${label} must include an accessible role and name, such as button:Get started.`);
  }
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
    const elementRef = safeElementRef(draft.elementRef, `${criterion.id} element reference`);
    if (draft.assertion === "count" && (!draft.expectedCount.trim() || !Number.isInteger(Number(draft.expectedCount)) || Number(draft.expectedCount) < 0 || Number(draft.expectedCount) > 100)) throw new Error(`${criterion.id} expected count must be a whole number from 0 to 100.`);
    candidate = {
      ...base,
      type: "element_state",
      elementRef,
      assertion: draft.assertion,
      ...(draft.assertion === "count" ? { expectedCount: Number(draft.expectedCount) } : {}),
    };
  } else if (criterion.checkType === "link_destination") {
    candidate = { ...base, type: "link_destination", elementRef: safeElementRef(draft.elementRef, `${criterion.id} element reference`), expectedPath: safePath(draft.expectedPath, `${criterion.id} expected destination`) };
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
    const submitRef = safeElementRef(draft.submitRef, `${criterion.id} submit element`);
    const expectedPostPath = safePath(draft.expectedPostPath, `${criterion.id} POST path`, true);
    const successText = draft.successText.trim() || undefined;
    const successPath = safePath(draft.successPath, `${criterion.id} success path`, true);
    if (!successText && !successPath && !expectedPostPath) throw new Error(`${criterion.id} needs a success message, success path, or expected POST path so it cannot pass without evidence.`);
    if (draft.expectedStatus.trim() && (!Number.isInteger(Number(draft.expectedStatus)) || Number(draft.expectedStatus) < 200 || Number(draft.expectedStatus) > 399)) throw new Error(`${criterion.id} expected status must be between 200 and 399.`);
    if (!draft.mutationAcknowledged) throw new Error(`${criterion.id} requires confirmation that the staging form may receive the test submission.`);
    candidate = {
      ...base,
      type: "form_submission",
      fields,
      submitRef,
      successText,
      successPath,
      expectedPostPath,
      ...(expectedPostPath && draft.expectedStatus ? { expectedStatus: Number(draft.expectedStatus) } : {}),
      ownerAcknowledgedMutation: true,
    };
  } else if (criterion.checkType === "viewport_layout") {
    if (!draft.maxOverflow.trim() || !Number.isFinite(Number(draft.maxOverflow)) || Number(draft.maxOverflow) < 0 || Number(draft.maxOverflow) > 20) throw new Error(`${criterion.id} maximum horizontal overflow must be from 0 to 20 pixels.`);
    const viewports = draft.viewports === "mobile"
      ? [{ width: 390, height: 844, label: "Mobile" }]
      : draft.viewports === "desktop"
        ? [{ width: 1280, height: 720, label: "Desktop" }]
        : [{ width: 390, height: 844, label: "Mobile" }, { width: 1280, height: 720, label: "Desktop" }];
    candidate = { ...base, type: "viewport_layout", viewports, maxHorizontalOverflowPx: Number(draft.maxOverflow) };
  } else if (criterion.checkType === "axe_scan") {
    if (draft.submitRef.trim() && !draft.mutationAcknowledged) throw new Error(`${criterion.id} requires confirmation before the accessibility check submits a form.`);
    const submitRef = safeElementRef(draft.submitRef, `${criterion.id} optional submit element`, true);
    candidate = {
      ...base,
      type: "axe_scan",
      tags: ["wcag2a", "wcag2aa", "wcag22aa"],
      failImpacts: ["critical", "serious"],
      ...(submitRef ? { submitRef, ownerAcknowledgedMutation: true } : {}),
    };
  } else {
    throw new Error(`${criterion.id} is marked for human review and should not have a browser mapping.`);
  }
  const parsed = checkSpecSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`${criterion.id} mapping is incomplete: ${parsed.error.issues[0]?.message ?? "check the values"}.`);
  return parsed.data;
}

export function mappingErrorsFor(criteria: AnalysisCriterion[], drafts: Record<string, CheckDraft>) {
  const errors: Record<string, string> = {};
  criteria.forEach((criterion, index) => {
    try { buildCheck(criterion, drafts[criterion.id] ?? initialDraft(), index); }
    catch (cause) { errors[criterion.id] = cause instanceof Error ? cause.message : "Complete this mapping."; }
  });
  return errors;
}

export function verificationRunReadiness({
  signedInEmail,
  busy,
  receipt,
  verifiedOrigin,
  evidenceConsent,
  buildLabel,
  automated,
  drafts,
}: {
  signedInEmail: string;
  busy: boolean;
  receipt: string;
  verifiedOrigin: string;
  evidenceConsent: boolean;
  buildLabel: string;
  automated: AnalysisCriterion[];
  drafts: Record<string, CheckDraft>;
}) {
  const mappingErrors = mappingErrorsFor(automated, drafts);
  const blockers: string[] = [];
  if (!signedInEmail) blockers.push("Sign in with your business email.");
  if (busy) blockers.push("Wait for origin verification to finish.");
  if (!receipt || !verifiedOrigin) blockers.push("Verify the public staging origin.");
  if (!buildLabel.trim()) blockers.push("Add a build label.");
  if (!evidenceConsent) blockers.push("Confirm the evidence and retention notice.");
  if (automated.length === 0) blockers.push("Add at least one browser-verifiable criterion.");
  if (automated.length > 6) blockers.push("Keep this run to six browser checks or fewer.");
  const mappingErrorCount = Object.keys(mappingErrors).length;
  if (mappingErrorCount) blockers.push(`Complete ${mappingErrorCount} browser check mapping${mappingErrorCount === 1 ? "" : "s"}.`);
  return { canRun: blockers.length === 0, blockers, mappingErrors };
}

function candidateOptionLabel(candidate: MappingCandidate) {
  const destination = candidate.href ? ` → ${candidate.href}` : "";
  return `${candidate.name} — ${candidate.role} on ${candidate.path}${destination}`;
}

function MappingFields({
  criterion,
  draft,
  suggestion,
  update,
  onChooseCandidate,
  error,
  onValidate,
}: {
  criterion: AnalysisCriterion;
  draft: CheckDraft;
  suggestion: MappingSuggestion | undefined;
  update: (patch: Partial<CheckDraft>) => void;
  onChooseCandidate: (candidate: MappingCandidate) => void;
  error: string;
  onValidate: () => void;
}) {
  const errorId = `${criterion.id}-mapping-error`;
  const invalid = (...markers: string[]) => Boolean(error) && markers.some((marker) => error.toLowerCase().includes(marker));
  const describedBy = (...markers: string[]) => invalid(...markers) ? errorId : undefined;
  const currentCandidate = suggestion?.choices.find((candidate) => {
    const reference = criterion.checkType === "form_submission" ? draft.submitRef : draft.elementRef;
    return candidate.path === draft.path && candidate.ref === reference;
  });

  return (
    <div className="mapping-interface" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) onValidate();
    }}>
      {error && <p className="analysis-error" id={errorId} role="alert">{error}</p>}
      {suggestion && <div className={`mapping-suggestion is-${suggestion.status}`}>
        <Sparkles size={16} aria-hidden="true" />
        <div>
          <strong>{suggestion.status === "suggested" ? "Grounded staging suggestion" : suggestion.status === "ambiguous" ? "Choose the intended control" : "No safe match found"}</strong>
          <p>{suggestion.explanation}</p>
        </div>
      </div>}
      {suggestion && suggestion.choices.length > 0 && <label className="mapping-choice">
        Observed control
        <select
          aria-label={`${criterion.id} observed control`}
          value={currentCandidate?.id ?? ""}
          onChange={(event) => {
            const candidate = suggestion.choices.find((item) => item.id === event.target.value);
            if (candidate) onChooseCandidate(candidate);
          }}
        >
          <option value="">Choose a real control…</option>
          {suggestion.choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateOptionLabel(candidate)}</option>)}
        </select>
        <small>Names and destinations come from the verified page’s accessibility tree.</small>
      </label>}
      <details
        className="advanced-mapping"
        key={`${suggestion?.status ?? "awaiting-scan"}-${error ? "error" : "clean"}`}
        open={Boolean(error || suggestion?.status === "unresolved")}
      >
        <summary>Advanced mapping</summary>
        <p>Use this only when the staging scan cannot identify the intended control.</p>
        <div className="mapping-fields mapping-fields--nested">
          <label>{criterion.id} page path<input aria-label={`${criterion.id} page path`} aria-invalid={invalid("page path")} aria-describedby={describedBy("page path")} value={draft.path} onChange={(event) => update({ path: event.target.value })} placeholder="/contact" /></label>
          {(criterion.checkType === "element_state" || criterion.checkType === "link_destination") && <label>{criterion.id} accessible element<input aria-label={`${criterion.id} accessible element`} aria-invalid={invalid("element reference")} aria-describedby={describedBy("element reference")} value={draft.elementRef} onChange={(event) => update({ elementRef: event.target.value })} placeholder="button:Get started" autoComplete="off" spellCheck={false} /><small>Use an exact accessible role:name from the verified page, such as link:Contact us.</small></label>}
          {criterion.checkType === "element_state" && <><label>{criterion.id} assertion<select aria-label={`${criterion.id} assertion`} aria-invalid={invalid("assertion")} aria-describedby={describedBy("assertion")} value={draft.assertion} onChange={(event) => update({ assertion: event.target.value as CheckDraft["assertion"] })}><option value="visible">Visible</option><option value="enabled">Enabled</option><option value="count">Exact count</option></select></label>{draft.assertion === "count" && <label>{criterion.id} expected count<input aria-label={`${criterion.id} expected count`} aria-invalid={invalid("expected count")} aria-describedby={describedBy("expected count")} type="number" min="0" max="100" value={draft.expectedCount} onChange={(event) => update({ expectedCount: event.target.value })} /></label>}</>}
          {criterion.checkType === "link_destination" && <label>{criterion.id} expected same-origin path<input aria-label={`${criterion.id} expected same-origin path`} aria-invalid={invalid("expected destination")} aria-describedby={describedBy("expected destination")} value={draft.expectedPath} onChange={(event) => update({ expectedPath: event.target.value })} placeholder="/contact" /></label>}
          {criterion.checkType === "form_submission" && <>
            <label className="mapping-wide">{criterion.id} test values<textarea aria-label={`${criterion.id} test values`} aria-invalid={invalid("form values")} aria-describedby={describedBy("form values")} value={draft.fields} onChange={(event) => update({ fields: event.target.value })} placeholder={"Email=qa@example.com\nMessage=Greenlit beta test"} /><small>One accessible field label and clearly labeled test value per line.</small></label>
            <label>{criterion.id} submit element<input aria-label={`${criterion.id} submit element`} aria-invalid={invalid("submit element")} aria-describedby={describedBy("submit element")} value={draft.submitRef} onChange={(event) => update({ submitRef: event.target.value })} placeholder="button:Send" autoComplete="off" spellCheck={false} /><small>Exact accessible role:name from the verified form.</small></label>
            <label>{criterion.id} success message<input aria-label={`${criterion.id} success message`} aria-invalid={invalid("success message")} aria-describedby={describedBy("success message")} value={draft.successText} onChange={(event) => update({ successText: event.target.value })} placeholder="Thanks, we received it" /></label>
            <label>{criterion.id} success page path<input aria-label={`${criterion.id} success page path`} aria-invalid={invalid("success path")} aria-describedby={describedBy("success path")} value={draft.successPath} onChange={(event) => update({ successPath: event.target.value })} placeholder="/thank-you (optional)" /></label>
            <label>{criterion.id} expected POST path<input aria-label={`${criterion.id} expected POST path`} aria-invalid={invalid("post path")} aria-describedby={describedBy("post path")} value={draft.expectedPostPath} onChange={(event) => update({ expectedPostPath: event.target.value })} placeholder="/api/leads (optional)" /></label>
            <label>{criterion.id} exact HTTP status (optional)<input aria-label={`${criterion.id} expected HTTP status`} aria-invalid={invalid("expected status")} aria-describedby={describedBy("expected status")} type="number" min="200" max="399" value={draft.expectedStatus} disabled={!draft.expectedPostPath.trim()} onChange={(event) => update({ expectedStatus: event.target.value })} placeholder="Any successful 2xx–3xx response" /></label>
            <label className="mapping-consent mapping-wide"><input type="checkbox" aria-label={`${criterion.id} authorize test submission`} aria-invalid={invalid("confirmation")} aria-describedby={describedBy("confirmation")} checked={draft.mutationAcknowledged} onChange={(event) => update({ mutationAcknowledged: event.target.checked })} /><span>I own or am authorized to test this staging form and accept the labeled test submission.</span></label>
          </>}
          {criterion.checkType === "viewport_layout" && <><label>{criterion.id} viewports<select aria-label={`${criterion.id} viewports`} aria-invalid={invalid("viewport")} aria-describedby={describedBy("viewport")} value={draft.viewports} onChange={(event) => update({ viewports: event.target.value as CheckDraft["viewports"] })}><option value="both">Mobile + desktop</option><option value="mobile">Mobile only</option><option value="desktop">Desktop only</option></select></label><label>{criterion.id} maximum horizontal overflow (px)<input aria-label={`${criterion.id} maximum horizontal overflow`} aria-invalid={invalid("maximum horizontal overflow")} aria-describedby={describedBy("maximum horizontal overflow")} type="number" min="0" max="20" value={draft.maxOverflow} onChange={(event) => update({ maxOverflow: event.target.value })} /></label></>}
          {criterion.checkType === "axe_scan" && <><label>{criterion.id} optional submit element<input aria-label={`${criterion.id} optional submit element`} aria-invalid={invalid("submit element")} aria-describedby={describedBy("submit element")} value={draft.submitRef} onChange={(event) => update({ submitRef: event.target.value })} placeholder="Leave blank for a page scan" autoComplete="off" spellCheck={false} /><small>Only add a role:name when the scan must expose validation messages first.</small></label>{draft.submitRef.trim() && <label className="mapping-consent mapping-wide"><input type="checkbox" aria-label={`${criterion.id} authorize accessibility interaction`} aria-invalid={invalid("confirmation")} aria-describedby={describedBy("confirmation")} checked={draft.mutationAcknowledged} onChange={(event) => update({ mutationAcknowledged: event.target.checked })} /><span>I authorize this staging interaction.</span></label>}</>}
        </div>
      </details>
    </div>
  );
}

export function VerificationSetup({ criteria, sourceName, signedInEmail, initialConfiguration, initialDraftState, onDraftChange, onBack, onDemo, onRun }: {
  criteria: AnalysisCriterion[];
  sourceName: string;
  signedInEmail: string;
  initialConfiguration?: CustomRunConfiguration | null;
  initialDraftState?: VerificationSetupDraft | null;
  onDraftChange?: (draft: VerificationSetupDraft) => void;
  onBack: () => void;
  onDemo: () => void;
  onRun: (configuration: CustomRunConfiguration) => void;
}) {
  const automated = useMemo(() => criteria.filter((item) => item.supported && item.checkType !== "manual"), [criteria]);
  const [target, setTarget] = useState(initialDraftState?.target ?? initialConfiguration?.targetUrl ?? "");
  const [token, setToken] = useState(initialDraftState?.token ?? "");
  const [receipt, setReceipt] = useState(initialDraftState?.receipt ?? initialConfiguration?.originReceipt ?? "");
  const [verifiedOrigin, setVerifiedOrigin] = useState(initialDraftState?.verifiedOrigin ?? (initialConfiguration?.originReceipt ? initialConfiguration.targetUrl : ""));
  const [buildLabel, setBuildLabel] = useState(initialDraftState?.buildLabel ?? initialConfiguration?.buildLabel ?? "");
  const [drafts, setDrafts] = useState<Record<string, CheckDraft>>(initialDraftState?.drafts ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [targetError, setTargetError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, MappingSuggestion>>({});
  const [pagesScanned, setPagesScanned] = useState<string[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingMappingFocus, setPendingMappingFocus] = useState("");
  const [copied, setCopied] = useState(false);
  const [evidenceConsent, setEvidenceConsent] = useState(Boolean(initialDraftState?.evidenceConsent));
  const targetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setToken((current) => current || `mp_${crypto.randomUUID().replaceAll("-", "")}`);
      const saved = new Map(initialConfiguration?.checks.map((check) => [check.criterionId, check]));
      setDrafts((current) => Object.fromEntries(automated.map((item) => [item.id, current[item.id] ?? (saved.get(item.id) ? draftFromCheck(saved.get(item.id)!) : initialDraft())])));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automated, initialConfiguration]);

  useEffect(() => {
    onDraftChange?.({ target, token, receipt, verifiedOrigin, buildLabel, drafts, evidenceConsent });
  }, [target, token, receipt, verifiedOrigin, buildLabel, drafts, evidenceConsent, onDraftChange]);

  const targetValidation = useMemo(() => normalizeStagingTarget(target), [target]);
  const readiness = useMemo(() => verificationRunReadiness({
    signedInEmail,
    busy: busy || scanBusy,
    receipt,
    verifiedOrigin,
    evidenceConsent,
    buildLabel,
    automated,
    drafts,
  }), [signedInEmail, busy, scanBusy, receipt, verifiedOrigin, evidenceConsent, buildLabel, automated, drafts]);
  const isVerified = Boolean(receipt && verifiedOrigin && targetValidation.ok && targetValidation.normalized === verifiedOrigin);
  const scanSummary = useMemo(() => {
    const values = Object.values(suggestions).filter((suggestion) => suggestion.status !== "not_needed");
    return {
      suggested: values.filter((suggestion) => suggestion.status === "suggested").length,
      ambiguous: values.filter((suggestion) => suggestion.status === "ambiguous").length,
      unresolved: values.filter((suggestion) => suggestion.status === "unresolved").length,
    };
  }, [suggestions]);

  useEffect(() => {
    if (!pendingMappingFocus) return;
    const frame = window.requestAnimationFrame(() => {
      const card = document.getElementById(`mapping-${pendingMappingFocus}`);
      const field = card?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (field ?? card)?.focus();
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingMappingFocus("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fieldErrors, pendingMappingFocus]);

  const revealMappingErrors = (errors = readiness.mappingErrors) => {
    setFieldErrors(errors);
    const first = automated.find((criterion) => errors[criterion.id]);
    if (first) setPendingMappingFocus(first.id);
  };

  const normalizeTargetField = (focusOnError = false) => {
    const result = normalizeStagingTarget(target);
    if (!result.ok) {
      setTargetError(result.error);
      if (focusOnError) targetInputRef.current?.focus();
      return null;
    }
    setTargetError("");
    setTarget(result.startPath === "/" ? result.normalized : `${result.normalized}${result.startPath}`);
    return result;
  };

  const scanMappings = async (
    origin = verifiedOrigin,
    originReceipt = receipt,
    startPath = targetValidation.ok ? targetValidation.startPath : "/",
  ) => {
    if (!origin || !originReceipt) {
      setScanError("Verify the staging origin before scanning its accessible controls.");
      return;
    }
    setScanBusy(true);
    setScanError("");
    try {
      const response = await fetchWithTimeout("/api/check-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: origin, startPath, originReceipt, criteria }),
      }, 28_000);
      const payload = await response.json() as {
        error?: string;
        suggestions?: MappingSuggestion[];
        pagesScanned?: string[];
        truncated?: boolean;
      };
      if (!response.ok) throw new Error(payload.error ?? "Greenlit could not scan this staging build.");
      if (!Array.isArray(payload.suggestions) || !Array.isArray(payload.pagesScanned)) throw new Error("The staging scan returned an invalid response.");

      const nextSuggestions = Object.fromEntries(payload.suggestions.map((suggestion) => [suggestion.criterionId, suggestion]));
      setSuggestions(nextSuggestions);
      setPagesScanned(payload.pagesScanned);
      setScanTruncated(Boolean(payload.truncated));
      setDrafts((current) => {
        const next = { ...current };
        for (const criterion of automated) {
          const suggestion = nextSuggestions[criterion.id];
          if (suggestion?.status !== "suggested" || !suggestion.draft) continue;
          next[criterion.id] = mergeSuggestionIntoDraft(next[criterion.id] ?? initialDraft(), suggestion.draft);
        }
        return next;
      });
      setFieldErrors({});
    } catch (cause) {
      setScanError(clientRequestMessage(cause, "Greenlit could not scan this staging build safely. Retry, or use advanced mapping."));
    } finally {
      setScanBusy(false);
    }
  };

  const verify = async () => {
    const normalizedTarget = normalizeTargetField(true);
    if (!normalizedTarget) return;
    if (!signedInEmail) {
      setError("Sign in with your business email before verifying a staging origin.");
      return;
    }
    if (!token) {
      setError("Wait for the one-time ownership token to finish generating.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithTimeout("/api/verify-origin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: normalizedTarget.normalized, token }) }, 20_000);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The staging origin could not be verified.");
      setReceipt(payload.receipt);
      setVerifiedOrigin(payload.origin);
      setTarget(normalizedTarget.startPath === "/" ? payload.origin : `${payload.origin}${normalizedTarget.startPath}`);
      setTargetError("");
      setBusy(false);
      await scanMappings(payload.origin, payload.receipt, normalizedTarget.startPath);
    } catch (cause) {
      setReceipt("");
      setVerifiedOrigin("");
      setSuggestions({});
      setPagesScanned([]);
      setError(clientRequestMessage(cause, "The staging origin could not be verified."));
    } finally { setBusy(false); }
  };

  const run = () => {
    setError("");
    if (!readiness.canRun) {
      if (Object.keys(readiness.mappingErrors).length) revealMappingErrors();
      setError(`Complete the setup before running checks. ${readiness.blockers.join(" ")}`);
      return;
    }
    try {
      const checks = automated.map((criterion, index) => buildCheck(criterion, drafts[criterion.id] ?? initialDraft(), index));
      setFieldErrors({});
      onRun({ targetUrl: verifiedOrigin, originReceipt: receipt, buildLabel: buildLabel.trim(), checks });
    } catch (cause) {
      const errors = mappingErrorsFor(automated, drafts);
      revealMappingErrors(errors);
      setError(cause instanceof Error ? cause.message : "Complete the verification mapping.");
    }
  };

  return (
    <div className="verification-setup-grid">
      <section className="panel setup-main">
        <div className="setup-heading"><span className="handoff-mark"><ShieldCheck size={26} /></span><div><div className="intake-kicker">Scope frozen · connect staging</div><h2>Map the promises to evidence.</h2><p>{criteria.length} confirmed promises from <strong>{sourceName}</strong>; {automated.length} are automation candidates and {criteria.length - automated.length} remain client-reviewed.</p></div></div>
        {!signedInEmail && AGENCY_BETA_SIGN_IN_VISIBLE && <div className="setup-auth"><LockKeyhole size={18} /><div><strong>Agency sign-in required</strong><span>Retained runs and client decisions belong to an agency account, so they remain accessible across devices.</span></div><Link className="button button--ink button--small" href={"/login?next=/workspace" as Route}>Sign in <ArrowRight size={13} /></Link></div>}
        {!signedInEmail && !AGENCY_BETA_SIGN_IN_VISIBLE && <div className="setup-auth"><Play size={18} /><div><strong>Explore this step in the walkthrough</strong><span>The public walkthrough demonstrates verification, client review, and the approval record without an account.</span></div><button className="button button--ink button--small" type="button" onClick={onDemo}>Open walkthrough <ArrowRight size={13} /></button></div>}
        {signedInEmail && <div className="setup-signed-in"><CheckCircle2 size={14} /> Retained evidence will belong to {signedInEmail}</div>}
        {error && <div className="analysis-error" role="alert">{error}</div>}

        <div className="setup-section">
          <div className="setup-section__head"><span>1</span><div><h3>Prove staging ownership</h3><p>Only public HTTPS staging sites are supported. Login screens, localhost, and private networks are blocked.</p></div></div>
          <div className="setup-fields">
            <label>
              Staging hostname or HTTPS URL
              <input
                ref={targetInputRef}
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={target}
                disabled={busy}
                aria-invalid={Boolean(targetError)}
                aria-describedby={`staging-url-help${targetError ? " staging-url-error" : ""}${isVerified ? " staging-url-verified" : ""}`}
                onBlur={() => { if (target.trim()) normalizeTargetField(); }}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setTargetError("");
                  setReceipt("");
                  setVerifiedOrigin("");
                  setSuggestions({});
                  setPagesScanned([]);
                  setScanError("");
                }}
                placeholder="staging.example.com"
              />
              <small id="staging-url-help">Paste a hostname or URL. A bare hostname is normalized to HTTPS before verification.</small>
              {targetError && <small className="field-error" id="staging-url-error" role="alert">{targetError}</small>}
            </label>
            <label>
              Build label
              <input value={buildLabel} onChange={(event) => setBuildLabel(event.target.value)} placeholder="client-launch-rc3" aria-describedby="build-label-help" />
              <small id="build-label-help">Use the release, commit, or milestone name reviewers will recognize.</small>
            </label>
          </div>
          <div className="token-instruction"><div><strong>Serve this exact text at</strong><code>/.well-known/greenlit.txt</code></div><code>{token || "Generating one-time token…"}</code><button type="button" className="mini-action" disabled={!token} onClick={async () => { if (!token) return; try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setCopied(false); setError("Clipboard access is unavailable. Select the token text and copy it manually."); } }}>{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? "Copied" : "Copy token"}</button></div>
          <button className="button button--outline" type="button" disabled={busy || !signedInEmail || !targetValidation.ok || !token} onClick={() => void verify()}>{busy ? <LoaderCircle className="spin" size={15} /> : isVerified ? <CheckCircle2 size={15} /> : <ShieldCheck size={15} />}{busy ? "Checking token…" : isVerified ? "Reverify staging origin" : "Verify staging origin"}</button>
          {isVerified && <div className="origin-verified" id="staging-url-verified" role="status" aria-live="polite" aria-atomic="true"><CheckCircle2 size={15} aria-hidden="true" /><span><strong>Origin verified</strong>{verifiedOrigin} is verified for this account for 30 minutes.</span></div>}
          <label className="mapping-consent evidence-consent"><input type="checkbox" aria-describedby="evidence-consent-copy" checked={evidenceConsent} onChange={(event) => setEvidenceConsent(event.target.checked)} /><span id="evidence-consent-copy"><strong>Authorize evidence capture</strong>I am authorized to capture this public staging build. It contains no confidential data or real personal data. Screenshots will be shared with the reviewer and retained privately for 90 days. Cross-origin scripts, images, and fonts are blocked, so this staging build must render with same-origin resources.</span></label>
        </div>

        <div className="setup-section">
          <div className="setup-section__head"><span>2</span><div><h3>Review observed checks</h3><p>Greenlit grounds each suggestion in real accessible controls from the verified staging build. It does not invent button names or selectors from the SOW.</p></div></div>
          <div className={`mapping-scan ${pagesScanned.length ? "is-complete" : ""}`} aria-live="polite">
            <ScanSearch size={20} aria-hidden="true" />
            <div>
              <strong>{scanBusy ? "Scanning accessible controls…" : pagesScanned.length ? `Scanned ${pagesScanned.length} staging page${pagesScanned.length === 1 ? "" : "s"}` : "Let Greenlit find the controls"}</strong>
              <p>{pagesScanned.length
                ? `${scanSummary.suggested} grounded suggestion${scanSummary.suggested === 1 ? "" : "s"}, ${scanSummary.ambiguous} choice${scanSummary.ambiguous === 1 ? "" : "s"} to confirm, and ${scanSummary.unresolved} unmatched.${scanTruncated ? " The safe crawl limit was reached." : ""}`
                : "After ownership is verified, Greenlit reads the supplied page and up to three relevant same-origin pages linked from it. The scan does not click controls, fill fields, or submit forms."}</p>
              {scanError && <p className="scan-error" role="alert">{scanError} Your saved mappings are unchanged.</p>}
            </div>
            <button className="button button--outline button--small" type="button" disabled={!isVerified || scanBusy} onClick={() => void scanMappings()}>
              {scanBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
              {pagesScanned.length ? "Refresh suggestions" : "Scan & suggest"}
            </button>
          </div>
          <div className="mapping-list">
            {automated.map((criterion) => {
              const mappingError = readiness.mappingErrors[criterion.id] ?? "";
              const shownError = fieldErrors[criterion.id] ?? "";
              const suggestion = suggestions[criterion.id];
              const stateLabel = mappingError
                ? suggestion?.status === "ambiguous"
                  ? "Choose match"
                  : suggestion?.status === "suggested"
                    ? "Review"
                    : suggestion?.status === "unresolved"
                      ? "No match"
                      : "Awaiting scan"
                : <><Check size={12} /> Ready</>;
              return <article id={`mapping-${criterion.id}`} tabIndex={-1} aria-labelledby={`${criterion.id}-mapping-title`} className={`mapping-card ${shownError ? "has-warning" : ""} ${mappingError ? "is-incomplete" : "is-complete"}`} key={criterion.id}>
                <div className="mapping-card__head"><span className="criterion-id">{criterion.id}</span><div><strong id={`${criterion.id}-mapping-title`}>{criterion.title}</strong><span>{criterion.checkType.replaceAll("_", " ")}</span></div><span className={`mapping-state ${mappingError ? "" : "is-ready"}`}>{stateLabel}</span></div>
                {!shownError && mappingError && <p className="mapping-guidance">Next: {suggestion
                  ? mappingError
                  : scanError
                    ? "Retry the staging scan, or use Advanced mapping if this control cannot be observed automatically."
                    : isVerified
                      ? "Scan the verified staging page so Greenlit can suggest a grounded mapping."
                      : "Verify the staging origin, then Greenlit will scan this page and suggest a grounded mapping."}</p>}
                <MappingFields
                  criterion={criterion}
                  draft={drafts[criterion.id] ?? initialDraft()}
                  suggestion={suggestion}
                  error={shownError}
                  onChooseCandidate={(candidate) => {
                    const hint = draftHintForCandidate(criterion, candidate);
                    setDrafts((current) => {
                      const existing = current[criterion.id] ?? initialDraft();
                      const patch: Partial<CheckDraft> = { ...hint };
                      if (criterion.checkType === "link_destination") patch.expectedPath = hint.expectedPath ?? "";
                      if (criterion.checkType === "form_submission") patch.expectedPostPath = hint.expectedPostPath ?? "";
                      return { ...current, [criterion.id]: { ...existing, ...patch } };
                    });
                    setFieldErrors((current) => {
                      if (!current[criterion.id]) return current;
                      const next = { ...current };
                      delete next[criterion.id];
                      return next;
                    });
                  }}
                  onValidate={() => setFieldErrors((current) => {
                    const next = { ...current };
                    const currentError = readiness.mappingErrors[criterion.id];
                    if (currentError) next[criterion.id] = currentError;
                    else delete next[criterion.id];
                    return next;
                  })}
                  update={(patch) => {
                    setDrafts((current) => ({ ...current, [criterion.id]: { ...(current[criterion.id] ?? initialDraft()), ...patch } }));
                    setFieldErrors((current) => {
                      if (!current[criterion.id]) return current;
                      const next = { ...current };
                      delete next[criterion.id];
                      return next;
                    });
                  }}
                />
              </article>;
            })}
            {criteria.filter((item) => !item.supported || item.checkType === "manual").map((criterion) => <article className="mapping-card mapping-card--manual" key={criterion.id}><div className="mapping-card__head"><span className="criterion-id">{criterion.id}</span><div><strong>{criterion.title}</strong><span>Client-reviewed promise · no automated evidence claim</span></div></div></article>)}
          </div>
        </div>

        <div className={`run-readiness ${readiness.canRun ? "is-ready" : ""}`} id="verification-run-readiness" role="status" aria-live="polite">
          {readiness.canRun
            ? <><CheckCircle2 size={16} aria-hidden="true" /><span><strong>Ready to run.</strong> Origin, consent, release label, and every browser mapping are complete.</span></>
            : <div><strong>Before you can run verified checks:</strong><ul>{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>{Object.keys(readiness.mappingErrors).length > 0 && <button type="button" className="text-action" onClick={() => revealMappingErrors()}>Review the first incomplete mapping <ArrowRight size={12} /></button>}</div>}
        </div>
        <div className="handoff-actions"><button className="button button--lime" type="button" aria-describedby="verification-run-readiness" disabled={!readiness.canRun} onClick={run}>Confirm mappings & run <Play size={15} /></button><button className="button button--outline" type="button" onClick={onBack}>Back to criteria</button></div>
      </section>
      <aside className="panel handoff-checklist"><h3>Evidence boundary</h3><div><CheckCircle2 size={15} /><span><strong>Account-bound origin proof</strong>The signed receipt cannot be reused by another account or hostname.</span></div><div><CircleDot size={15} /><span><strong>Same-origin resources only</strong>Navigation and page resources cannot leave the verified origin or reach internal networks.</span></div><div><CircleDot size={15} /><span><strong>Explicit form consent</strong>Potential mutations require a separate authorization.</span></div><div className="boundary-callout"><LockKeyhole size={15} /><div><strong>Need a reliable fallback?</strong><p>The synthetic walkthrough never claims retained evidence.</p><button className="text-action" onClick={onDemo}>Open guided demo <ExternalLink size={12} /></button></div></div></aside>
    </div>
  );
}
