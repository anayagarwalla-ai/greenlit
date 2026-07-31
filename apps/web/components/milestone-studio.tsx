"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  Code2,
  Copy,
  CopyPlus,
  ExternalLink,
  FileCheck2,
  FileWarning,
  FileText,
  FileUp,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  PencilLine,
  Play,
  Quote,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  ArrowDown,
  ArrowUp,
  WandSparkles,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { VerificationSetup, type CustomRunConfiguration, type VerificationSetupDraft } from "@/components/verification-setup";
import { InvoicePlanCard } from "@/components/invoice-plan-card";
import { ReviewSetupDialog, type ReviewExpiryHours } from "@/components/review-setup-dialog";
import { checkTypes, isCriterionReady, isGroundedQuote, lineContainsCitation, normalizeWhitespace, type AnalysisCriterion, type CheckType } from "@/lib/analysis";
import { analysisResultPresentation, type AnalysisMode } from "@/lib/analysis-presentation";
import { sameConfirmedCriteriaRevision } from "@/lib/criteria-revision";
import { demoCriteria, demoSowText, seededDemoArtifacts, seededDemoResults, sowExcerpt } from "@/lib/demo";
import { DEMO_TIME_ZONE, formatDuration, formatTimestamp } from "@/lib/format";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";
import { runResultPresentation, summarizeRunStatuses, verificationScorePercent } from "@/lib/run-result-presentation";
import { AGENCY_BETA_SIGN_IN_VISIBLE } from "../lib/public-features";
import { isActiveRunStatus, isTerminalRunFailure, terminalRunMessage } from "@/lib/run-status";
import {
  activeDraftId,
  claimPendingAnonymousDraft,
  clearLegacyGlobalDraftState,
  flushProjectDraftOnPageHide,
  isDraftStorageAvailable,
  legacyDraftStorageKey,
  purgeExpiredAnonymousDrafts,
  readProjectDraft,
  readProjectDraftSavedAt,
  removeProjectDraft,
  saveProjectDraft,
} from "@/lib/client-storage";
import { fetchWithTimeout } from "@/lib/client-request";

type Phase = "intake" | "analyzing" | "criteria" | "handoff" | "running1" | "run1" | "running2" | "run2" | "shared";
type SourceMode = "live" | "demo";
type VerificationPhase = "handoff" | "run1" | "run2";

type BusinessDetails = {
  agencyName: string;
  clientName: string;
  projectName: string;
  milestoneTitle: string;
  amountDollars: string;
  currency: string;
};

type RunResult = { criterionId: string; status: "PASS" | "FAIL" | "ERROR" | "SKIPPED"; expected: string; observed: string; durationMs: number; timestamp: string };
type RunArtifact = { criterionId: string; kind: string; sha256: string; url?: string | null };
type RunResponse = {
  runId: string;
  recordId: string;
  status: string;
  outcome?: "READY_FOR_REVIEW" | "NEEDS_WORK" | null;
  buildUrl: string;
  buildLabel: string;
  results: RunResult[];
  artifacts: RunArtifact[];
  browserVersion?: string | null;
  runnerVersion?: string | null;
  manifestSha256?: string | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  record?: { public_id: string; revision: number; confirmed_criteria: Array<{ id: string; title: string; sourceQuote: string; supported?: boolean; checkType?: CheckType }> };
  seededDemo?: boolean;
};

type AnalysisResponse = {
  sourceName: string;
  sourceText: string;
  criteria: Omit<AnalysisCriterion, "id">[];
  model?: string;
  analysisMode?: AnalysisMode;
  notice?: string;
  durationMs?: number;
  error?: string;
};

const phaseOrder: Record<Phase, number> = { intake: 1, analyzing: 1, criteria: 1, handoff: 2, running1: 2, run1: 2, running2: 2, run2: 2, shared: 3 };
const checkLabels: Record<CheckType, string> = {
  element_state: "Element state",
  link_destination: "Link destination",
  form_submission: "Form submission",
  viewport_layout: "Viewport layout",
  axe_scan: "Axe accessibility scan",
  manual: "Human review",
};
const fixtureCheckTypes: CheckType[] = ["element_state", "link_destination", "element_state", "form_submission", "axe_scan", "viewport_layout"];
// Uploaded files under this size are persisted (base64) alongside the draft
// so an uploaded-PDF draft survives sign-in exactly like pasted text does.
// Larger files are intentionally not persisted to stay well under browsers'
// per-origin localStorage quota.
const MAX_PERSISTED_FILE_BYTES = 1_500_000;

type PersistedFile = { name: string; type: string; base64: string };

type WorkspaceDraft = {
  version: 4;
  draftId: string;
  phase: Phase;
  sourceText: string;
  sourceName: string;
  selectedFileMeta: PersistedFile | null;
  business: BusinessDetails;
  attested: boolean;
  aiDisclosureAccepted: boolean;
  adultBusinessUseAttested: boolean;
  criteria: AnalysisCriterion[];
  confirmed: Record<string, boolean>;
  model: string;
  analysisMode?: AnalysisMode;
  analysisNotice: string;
  recordId: string | null;
  latestRun: RunResponse | null;
  customRun: CustomRunConfiguration | null;
  retainedFixtureRecord?: boolean;
  // The review bearer token lives only in React state for the current tab
  // (see `reviewUrl` below). It is never written to localStorage. Only the
  // non-secret packet id is persisted so a resumed session can look up its
  // current decision through the owner's authenticated session.
  reviewPacketId: string;
  savedAt?: string;
  runRequestId?: string | null;
  verificationDraft?: VerificationSetupDraft | null;
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}

function base64ToFile(meta: PersistedFile): File {
  const binary = atob(meta.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], meta.name, { type: meta.type });
}

function fixtureCompatible(source: string) {
  return demoCriteria.every((item) => isGroundedQuote(source, item.source));
}

function fixtureCriteriaCompatible(source: string, criteria: AnalysisCriterion[]) {
  return fixtureCompatible(source)
    && criteria.length === demoCriteria.length
    && demoCriteria.every((demoItem, index) => criteria.some((item) =>
      normalizeWhitespace(item.sourceQuote) === normalizeWhitespace(demoItem.source)
      && item.checkType === fixtureCheckTypes[index]!
      && item.supported,
    ));
}

function applyFixtureMappings(source: string, criteria: AnalysisCriterion[]) {
  if (!fixtureCompatible(source) || criteria.length !== demoCriteria.length) return criteria;
  return criteria.map((item) => {
    const index = demoCriteria.findIndex((demoItem) => normalizeWhitespace(demoItem.source) === normalizeWhitespace(item.sourceQuote));
    if (index < 0) return item;
    const demoItem = demoCriteria[index]!;
    return {
      ...item,
      supported: true,
      checkType: fixtureCheckTypes[index]!,
      rationale: `Included staging mapping: ${demoItem.check}`,
    };
  });
}

function phaseStatus(phase: Phase, hasSource: boolean) {
  if (phase === "intake") return { text: hasSource ? "Source ready" : "Awaiting SOW", className: "status-badge--neutral" };
  if (phase === "analyzing") return { text: "Drafting criteria", className: "status-badge--neutral" };
  if (phase === "criteria") return { text: "Needs confirmation", className: "" };
  if (phase === "handoff") return { text: "Scope frozen", className: "status-badge--pass" };
  if (phase.startsWith("running")) return { text: "Verifying", className: "status-badge--neutral" };
  if (phase === "run1") return { text: "Needs work", className: "status-badge--fail" };
  if (phase === "run2") return { text: "Ready for review", className: "status-badge--pass" };
  return { text: "In review", className: "status-badge--pass" };
}

function friendlyRunError(error: unknown) {
  const message = error instanceof Error ? error.message : "The verification run failed.";
  if (/429|rate limit|browser capacity|daily browser quota/i.test(message)) {
    return "Cloudflare’s free daily browser quota is currently used up. No paid capacity was enabled. This failed attempt remains in the audit record; open the clearly labeled synthetic walkthrough now or retry the real browser run after the daily reset.";
  }
  return message;
}

async function browserSha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function MilestoneStudio({ geminiConfigured, geminiPaidService, guidedDemo }: { geminiConfigured: boolean; geminiPaidService: boolean; guidedDemo: boolean }) {
  const [phase, setPhase] = useState<Phase>("intake");
  const [sourceMode, setSourceMode] = useState<SourceMode>("live");
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("Pasted SOW");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileMeta, setSelectedFileMeta] = useState<PersistedFile | null>(null);
  const [attested, setAttested] = useState(false);
  const [aiDisclosureAccepted, setAiDisclosureAccepted] = useState(false);
  const [adultBusinessUseAttested, setAdultBusinessUseAttested] = useState(false);
  const [business, setBusiness] = useState<BusinessDetails>({
    agencyName: "",
    clientName: "",
    projectName: "",
    milestoneTitle: "",
    amountDollars: "",
    currency: "USD",
  });
  const [criteria, setCriteria] = useState<AnalysisCriterion[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [analysisError, setAnalysisError] = useState("");
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(geminiConfigured ? "gemini" : "fallback");
  const [model, setModel] = useState(geminiConfigured ? "Gemini" : "Greenlit local source parser");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastVerificationPhase, setLastVerificationPhase] = useState<VerificationPhase | null>(null);
  const [reviewCreated, setReviewCreated] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<RunResponse | null>(null);
  const [runError, setRunError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewUrl, setReviewUrl] = useState("");
  const [manualReviewCopy, setManualReviewCopy] = useState(false);
  const [reviewAccessCode, setReviewAccessCode] = useState("");
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewPacketId, setReviewPacketId] = useState("");
  const [reviewExpiresAt, setReviewExpiresAt] = useState("");
  const [reviewSetupOpen, setReviewSetupOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [customRun, setCustomRun] = useState<CustomRunConfiguration | null>(null);
  const [verificationDraft, setVerificationDraft] = useState<VerificationSetupDraft | null>(null);
  const [runRequestId, setRunRequestId] = useState<string | null>(null);
  const [retainedFixtureRecord, setRetainedFixtureRecord] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [pollNetworkFailure, setPollNetworkFailure] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restorePending, setRestorePending] = useState(true);
  const [sourceReattachRequired, setSourceReattachRequired] = useState(false);
  const analysisController = useRef<AbortController | null>(null);
  const runController = useRef<AbortController | null>(null);
  const draftHydrated = useRef(false);
  const launchDemoRef = useRef<() => void>(() => undefined);
  const phaseHeading = useRef<HTMLHeadingElement | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const currentStep = phaseOrder[phase];
  const status = phaseStatus(phase, Boolean(sourceText.trim() || selectedFile));
  const canRunImportedFixture = fixtureCriteriaCompatible(sourceText, criteria);
  const canUseImportedFixture = canRunImportedFixture || retainedFixtureRecord;
  const visibleCount = sourceMode === "demo" ? demoCriteria.length : criteria.length;
  const latestPassCount = latestRun?.results.filter((result) => result.status === "PASS").length ?? 0;
  const activeRunId = latestRun?.runId;
  const activeRunStatus = latestRun?.status;
  const signInHref = `/login?next=${encodeURIComponent(draftId ? `/workspace?draft=${draftId}` : "/workspace")}` as Route;
  const workspaceSnapshot = useCallback((includeLocalSource: boolean): WorkspaceDraft => ({
    version: 4,
    draftId,
    phase,
    sourceText: includeLocalSource ? sourceText : "",
    sourceName,
    selectedFileMeta: includeLocalSource ? selectedFileMeta : null,
    business,
    attested,
    aiDisclosureAccepted,
    adultBusinessUseAttested,
    criteria,
    confirmed,
    model,
    analysisMode,
    analysisNotice,
    recordId,
    latestRun,
    customRun: customRun ? { ...customRun, originReceipt: "" } : null,
    retainedFixtureRecord,
    reviewPacketId,
    savedAt: new Date().toISOString(),
    runRequestId,
    verificationDraft: includeLocalSource ? verificationDraft : verificationDraft ? { ...verificationDraft, token: "", receipt: "" } : null,
  }), [draftId, phase, sourceText, sourceName, selectedFileMeta, business, attested, aiDisclosureAccepted, adultBusinessUseAttested, criteria, confirmed, model, analysisMode, analysisNotice, recordId, latestRun, customRun, retainedFixtureRecord, reviewPacketId, runRequestId, verificationDraft]);

  const saveRetainedSnapshot = useCallback(async (snapshot: WorkspaceDraft, signal?: AbortSignal) => {
    if (!recordId || !sessionEmail) return;
    const response = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceState: snapshot }),
      ...(signal ? { signal } : {}),
    }, 15_000);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error((payload as { error?: string }).error ?? "The retained workspace could not be saved.");
    }
  }, [recordId, sessionEmail]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    // Legacy global (non-account-scoped) keys could hold another account's
    // SOW/business details or, critically, a client review bearer-token
    // URL. Never trust or carry them forward now that drafts are scoped per
    // signed-in account.
    clearLegacyGlobalDraftState();
    // The unsigned-draft retention window applies to the draft content itself,
    // not only the sign-in handoff marker.
    purgeExpiredAnonymousDrafts();
    let cancelled = false;

    const hydrateDraft = (draft: Partial<WorkspaceDraft>, fallbackDraftId: string) => {
      const restoredPhase: Phase = draft.phase === "analyzing"
        ? "intake"
        : draft.phase?.startsWith("running")
          ? (draft.latestRun ? (draft.latestRun.outcome === "READY_FOR_REVIEW" ? "run2" : "run1") : "handoff")
          : draft.phase === "shared"
            ? (draft.latestRun ? "run2" : "criteria")
            : draft.phase ?? "intake";
      setDraftId(draft.draftId || fallbackDraftId);
      setPhase(restoredPhase);
      setSourceText(draft.sourceText ?? "");
      setSourceName(draft.sourceName ?? "Pasted SOW");
      setSourceReattachRequired(false);
      if (draft.selectedFileMeta) { setSelectedFileMeta(draft.selectedFileMeta); setSelectedFile(base64ToFile(draft.selectedFileMeta)); }
      setBusiness(draft.business ?? { agencyName: "", clientName: "", projectName: "", milestoneTitle: "", amountDollars: "", currency: "USD" });
      setAttested(Boolean(draft.attested));
      setAiDisclosureAccepted(Boolean(draft.aiDisclosureAccepted));
      setAdultBusinessUseAttested(Boolean(draft.adultBusinessUseAttested));
      setCriteria(Array.isArray(draft.criteria) ? draft.criteria : []);
      setConfirmed(draft.confirmed ?? {});
      setModel(draft.model ?? (geminiConfigured ? "Gemini" : "Greenlit local source parser"));
      setAnalysisMode(draft.analysisMode ?? (draft.analysisNotice
        ? "fallback"
        : draft.model?.toLowerCase().includes("gemini")
          ? "gemini"
          : geminiConfigured ? "gemini" : "fallback"));
      setAnalysisNotice(draft.analysisNotice ?? "");
      setRecordId(draft.recordId ?? null);
      setLatestRun(draft.latestRun ?? null);
      setCustomRun(draft.customRun ?? null);
      setVerificationDraft(draft.verificationDraft ?? null);
      setRunRequestId(draft.runRequestId ?? null);
      setRetainedFixtureRecord(Boolean(draft.retainedFixtureRecord));
      setReviewPacketId(draft.reviewPacketId ?? "");
      setReviewCreated(Boolean(draft.reviewPacketId));
      if (draft.latestRun) setLastVerificationPhase(draft.latestRun.outcome === "READY_FOR_REVIEW" ? "run2" : "run1");
    };

    const restoreLocalDraft = (email: string, requestedDraftId: string | null, claimed: { draftId: string; raw: string } | null) => {
      try {
        const existingDraftId = claimed?.draftId || requestedDraftId || activeDraftId(email);
        let resolvedDraftId = existingDraftId || crypto.randomUUID();
        let raw = claimed?.raw || readProjectDraft(email, resolvedDraftId);
        if (!raw) {
          const legacy = window.localStorage.getItem(legacyDraftStorageKey(email));
          if (legacy) {
            raw = legacy;
            saveProjectDraft(email, resolvedDraftId, legacy);
            window.localStorage.removeItem(legacyDraftStorageKey(email));
          }
        }
        // If an anonymous requested/active draft expired or disappeared, do
        // not reuse its identifier for the next blank autosave. A fresh id
        // makes the purge unambiguous and prevents stale links from appearing
        // to resurrect a deleted shared-browser draft.
        if (!raw && !email && existingDraftId) resolvedDraftId = crypto.randomUUID();
        const parsedDraft = raw ? JSON.parse(raw) as { version?: number } : null;
        const draft = parsedDraft as Partial<WorkspaceDraft> | null;
        if (draft && (parsedDraft?.version === 3 || parsedDraft?.version === 4)) hydrateDraft(draft, resolvedDraftId);
        else setDraftId(resolvedDraftId);
        if (!new URL(window.location.href).searchParams.get("record")) window.history.replaceState({}, "", `/workspace?draft=${encodeURIComponent(resolvedDraftId)}`);
      } catch { /* A corrupt convenience draft must never block the workspace. */ }
    };

    const restore = async () => {
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.get("demo") === "guided") {
        // The walkthrough is a public, synthetic fallback. Launch it before
        // any account request so an auth outage cannot block the judge path,
        // and retain the marker so a refresh restores the same experience.
        setSessionEmail("");
        setStorageBlocked(!isDraftStorageAvailable());
        launchDemoRef.current();
        draftHydrated.current = true;
        setRestorePending(false);
        return;
      }

      let email = "";
      try {
        const response = await fetchWithTimeout("/api/account/session", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Your sign-in session could not be checked.");
        email = payload.user?.email ?? "";
      } catch (cause) {
        if (!cancelled) { setRestoreError(cause instanceof Error ? cause.message : "Your sign-in session could not be checked. Retry before editing so an existing project is not replaced."); setRestorePending(false); }
        return;
      }
      if (cancelled) return;
      setSessionEmail(email);
      setStorageBlocked(!isDraftStorageAvailable());

      const resumeId = currentUrl.searchParams.get("record");
      const requestedDraftId = currentUrl.searchParams.get("draft");
      if (email && resumeId) {
        try {
          const response = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(resumeId)}`, { cache: "no-store" }, 20_000);
          const resumed = await response.json();
          if (!response.ok) throw new Error(resumed.error ?? "The retained workspace could not be restored.");
          if (cancelled) return;
          const record = resumed.record;
          const savedWorkspace = record.workspace_state && typeof record.workspace_state === "object" ? record.workspace_state as Partial<WorkspaceDraft> : null;
          let localWorkspace: Partial<WorkspaceDraft> | null = null;
          let localSavedAt: number | null = null;
          try {
            const localDraftId = savedWorkspace?.draftId || record.id;
            const localRaw = readProjectDraft(email, localDraftId);
            const parsedLocal = localRaw ? JSON.parse(localRaw) as Partial<WorkspaceDraft> : null;
            if (parsedLocal?.version === 4 && parsedLocal.recordId === record.id) {
              localWorkspace = parsedLocal;
              localSavedAt = readProjectDraftSavedAt(email, localDraftId);
            }
          } catch { /* A local convenience copy must never block the retained record. */ }
          const serverSavedAt = Date.parse(record.updated_at ?? "");
          const preferLocal = Boolean(localWorkspace && localSavedAt && (!Number.isFinite(serverSavedAt) || localSavedAt > serverSavedAt));
          const editableWorkspace = preferLocal ? localWorkspace : savedWorkspace;
          const restoredCriteria = (editableWorkspace?.version === 4 && Array.isArray(editableWorkspace.criteria) ? editableWorkspace.criteria : record.confirmed_criteria ?? []) as AnalysisCriterion[];
          const latest = resumed.runs?.[0];
          const latestReview = resumed.reviews?.[0];
          setRecordId(record.id);
          setDraftId(editableWorkspace?.draftId || record.id);
          const isImportedFixture = record.mode === "IMPORTED_FIXTURE";
          setRetainedFixtureRecord(isImportedFixture);
          setBusiness(editableWorkspace?.version === 4 && editableWorkspace.business ? editableWorkspace.business : { agencyName: record.agency_name, clientName: record.client_name, projectName: record.project_name, milestoneTitle: record.milestone_title, amountDollars: (Number(record.amount_minor) / 100).toFixed(2), currency: record.currency });
          setSourceName(localWorkspace?.sourceName ?? editableWorkspace?.sourceName ?? record.source_name);
          const restoredFullSource = localWorkspace?.sourceText?.trim()
            ? localWorkspace.sourceText
            : editableWorkspace?.version === 4 && editableWorkspace.sourceText?.trim()
              ? editableWorkspace.sourceText
              : "";
          setSourceText(restoredFullSource || restoredCriteria.map((item) => item.sourceQuote).filter(Boolean).join("\n\n"));
          setSourceReattachRequired(!restoredFullSource && restoredCriteria.length > 0);
          if (localWorkspace?.selectedFileMeta) { setSelectedFileMeta(localWorkspace.selectedFileMeta); setSelectedFile(base64ToFile(localWorkspace.selectedFileMeta)); }
          setCriteria(restoredCriteria.map((item) => ({ ...item, grounded: true, rationale: item.rationale ?? "Retained confirmed criterion" })));
          setConfirmed(editableWorkspace?.version === 4 ? editableWorkspace.confirmed ?? {} : Object.fromEntries(restoredCriteria.map((item) => [item.id, true])));
          setAttested(editableWorkspace?.version === 4 ? Boolean(editableWorkspace.attested) : true);
          setAiDisclosureAccepted(editableWorkspace?.version === 4 ? Boolean(editableWorkspace.aiDisclosureAccepted) : true);
          setAdultBusinessUseAttested(editableWorkspace?.version === 4 ? Boolean(editableWorkspace.adultBusinessUseAttested) : true);
          setModel(editableWorkspace?.model ?? (geminiConfigured ? "Gemini" : "Greenlit local source parser"));
          setAnalysisMode(editableWorkspace?.analysisMode ?? (editableWorkspace?.analysisNotice
            ? "fallback"
            : editableWorkspace?.model?.toLowerCase().includes("gemini")
              ? "gemini"
              : geminiConfigured ? "gemini" : "fallback"));
          setAnalysisNotice(editableWorkspace?.analysisNotice ?? "");
          setRunRequestId(editableWorkspace?.runRequestId ?? null);
          setVerificationDraft(editableWorkspace?.verificationDraft ?? null);
          setChangeRequest(latestReview?.decision === "CHANGES_REQUESTED" ? latestReview.reviewer_note || "The client requested changes without a note." : "");
          // An approved record is a terminal, finalized state. Send the
          // agency straight to its receipt instead of reopening it inside
          // the intake/verification workflow.
          if (record.status === "APPROVED") {
            const approvedPacket = (resumed.reviews as Array<{ decision?: string | null; public_id: string }> ?? []).find((item) => item.decision === "APPROVED");
            if (approvedPacket) { window.location.assign(`/receipt/${approvedPacket.public_id}`); return; }
          }
          if (latest) {
            const run: RunResponse = { runId: latest.id, recordId: record.id, status: latest.status, outcome: latest.status === "COMPLETED" ? (record.status === "READY_FOR_REVIEW" || record.status === "IN_REVIEW" || record.status === "APPROVED" ? "READY_FOR_REVIEW" : "NEEDS_WORK") : null, buildUrl: latest.build_url, buildLabel: latest.build_label, results: latest.results ?? [], artifacts: latest.artifacts ?? [], browserVersion: latest.browser_version, runnerVersion: latest.runner_version, manifestSha256: latest.manifest_sha256, error: latest.last_error, startedAt: latest.started_at, completedAt: latest.completed_at, record: { public_id: record.public_id, revision: record.criteria_revision ?? record.revision, confirmed_criteria: record.confirmed_criteria ?? restoredCriteria } };
            setLatestRun(run);
            const savedChecks = Array.isArray(latest.checks) ? latest.checks : [];
            if (editableWorkspace?.version === 4 && editableWorkspace.customRun) setCustomRun({ ...editableWorkspace.customRun, originReceipt: "" });
            else if (savedChecks.length && !isImportedFixture) setCustomRun({ targetUrl: latest.target_origin, originReceipt: "", buildLabel: latest.build_label, checks: savedChecks });
            else if (isImportedFixture) setCustomRun(null);
            const openReview = (resumed.reviews as Array<{ decision?: string | null; public_id: string }> ?? []).find((item) => !item.decision);
            if (openReview) { setReviewPacketId(openReview.public_id); setReviewCreated(true); }
            if (isActiveRunStatus(latest.status)) setPhase("running1");
            else if (record.status === "READY_FOR_REVIEW" || record.status === "IN_REVIEW") { setPhase("run2"); setLastVerificationPhase("run2"); }
            else if (isTerminalRunFailure(latest.status)) {
              setRunError(terminalRunMessage(latest.status, latest.last_error));
              setPhase(isImportedFixture ? "criteria" : "handoff");
              setLastVerificationPhase(null);
            } else { setPhase(record.status === "CHANGES_REQUESTED" ? "criteria" : "run1"); setLastVerificationPhase("run1"); }
          } else setPhase("criteria");
          setToast("Retained project restored");
          draftHydrated.current = true;
          setRestorePending(false);
          return;
        } catch (cause) {
          if (!cancelled) { setRestoreError(cause instanceof Error ? cause.message : "The retained workspace could not be restored. Retry before editing so an older local copy does not replace it."); setRestorePending(false); }
          return;
        }
      }
      if (cancelled) return;
      const claimed = email ? claimPendingAnonymousDraft(email) : null;
      restoreLocalDraft(email, requestedDraftId, claimed);
      draftHydrated.current = true;
      setRestorePending(false);
    };
    void restore();

    return () => {
      cancelled = true;
      analysisController.current?.abort("workspace-unmounted");
      runController.current?.abort("workspace-unmounted");
    };
  }, [geminiConfigured]);

  useEffect(() => {
    if (!selectedFile || selectedFile.size > MAX_PERSISTED_FILE_BYTES) {
      const timer = window.setTimeout(() => setSelectedFileMeta(null), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void fileToBase64(selectedFile).then((base64) => {
      if (!cancelled) setSelectedFileMeta({ name: selectedFile.name, type: selectedFile.type, base64 });
    });
    return () => { cancelled = true; };
  }, [selectedFile]);

  useEffect(() => {
    if (!draftHydrated.current || sourceMode === "demo" || !draftId) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const saved = saveProjectDraft(sessionEmail, draftId, JSON.stringify(workspaceSnapshot(!sessionEmail)));
      // For a retained signed-in project, "Saved" means the server accepted
      // the snapshot. The local convenience copy alone must not claim that.
      if (!recordId || !sessionEmail) setSaveState(saved ? "saved" : "error");
      else if (!saved) setSaveState("error");
      if (!saved) setStorageBlocked(!isDraftStorageAvailable());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [sourceMode, sessionEmail, draftId, recordId, workspaceSnapshot]);

  const retrySave = async () => {
    if (sourceMode === "demo" || !draftId) return;
    setSaveState("saving");
    const localSaved = saveProjectDraft(sessionEmail, draftId, JSON.stringify(workspaceSnapshot(!sessionEmail)));
    setStorageBlocked(localSaved ? false : !isDraftStorageAvailable());
    if (recordId && sessionEmail) {
      try {
        await saveRetainedSnapshot(workspaceSnapshot(false));
        setSaveState("saved");
        setRunError("");
      } catch (cause) {
        setSaveState("error");
        setRunError(cause instanceof Error ? cause.message : "The retained workspace could not be saved.");
      }
      return;
    }
    setSaveState(localSaved ? "saved" : "error");
  };

  useEffect(() => {
    // The debounced autosave above can lose the last keystrokes when the user
    // leaves immediately; flush the pending draft as the page is hidden.
    const flush = () => {
      if (!draftHydrated.current || sourceMode === "demo" || !draftId) return;
      flushProjectDraftOnPageHide(sessionEmail, draftId, JSON.stringify(workspaceSnapshot(!sessionEmail)));
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [sourceMode, sessionEmail, draftId, workspaceSnapshot]);

  useEffect(() => {
    if (!draftHydrated.current || sourceMode === "demo" || !recordId || !sessionEmail) return;
    const controller = new AbortController();
    const snapshot = workspaceSnapshot(false);
    const timer = window.setTimeout(() => {
      void saveRetainedSnapshot(snapshot, controller.signal).then(() => {
        setSaveState("saved");
        setRunError("");
      }).catch((cause) => {
        if (controller.signal.aborted) return;
        setSaveState("error");
        setRunError(cause instanceof Error ? cause.message : "The retained workspace could not be saved.");
      });
    }, 450);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [sourceMode, recordId, sessionEmail, workspaceSnapshot, saveRetainedSnapshot]);

  useEffect(() => {
    if (!activeRunId || !isActiveRunStatus(activeRunStatus) || runController.current) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetchWithTimeout(`/api/runs/${encodeURIComponent(activeRunId)}`, { cache: "no-store", signal: controller.signal }, 20_000);
        const payload = await response.json() as RunResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Verification status is unavailable.");
        setLatestRun(payload);
        setPollNetworkFailure(false);
        if (payload.status === "COMPLETED") {
          const completedPhase: Phase = payload.outcome === "READY_FOR_REVIEW" ? "run2" : "run1";
          setPhase(completedPhase); setLastVerificationPhase(completedPhase); setRunError("");
        } else if (isTerminalRunFailure(payload.status)) {
          setRunRequestId(null);
          setRunError(terminalRunMessage(payload.status, payload.error));
          setPhase(canUseImportedFixture ? "criteria" : "handoff");
          setLastVerificationPhase(null);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        // A dropped connection only hides status. The retained job keeps
        // running on the server, so offer a way out instead of a dead spinner.
        setPollNetworkFailure(cause instanceof TypeError);
        setRunError(cause instanceof TypeError
          ? "The verification status could not be checked because of a network problem. The retained job is still active on the server; you can keep waiting here or return to the dashboard and reopen this project later."
          : cause instanceof Error ? cause.message : "Verification status is temporarily unavailable. This job remains saved and will resume when you reopen the project.");
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    void poll();
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [activeRunId, activeRunStatus, canUseImportedFixture]);

  useEffect(() => {
    if (phase === "intake") return;
    phaseHeading.current?.focus({ preventScroll: true });
  }, [phase]);

  const preserveDraft = async (markForSignIn = false): Promise<boolean> => {
    if (sourceMode === "demo" || !draftId) return true;
    const snapshot = workspaceSnapshot(true);
    let durableFile = snapshot.selectedFileMeta;
    if (selectedFile && selectedFile.size <= MAX_PERSISTED_FILE_BYTES && (!durableFile || durableFile.name !== selectedFile.name)) {
      const base64 = await fileToBase64(selectedFile);
      durableFile = { name: selectedFile.name, type: selectedFile.type, base64 };
      setSelectedFileMeta(durableFile);
    }
    const safeSnapshot = sessionEmail ? workspaceSnapshot(false) : { ...snapshot, selectedFileMeta: durableFile };
    const localSaved = saveProjectDraft(sessionEmail, draftId, JSON.stringify(safeSnapshot), markForSignIn && !sessionEmail);
    if (!localSaved) { setSaveState("error"); setStorageBlocked(!isDraftStorageAvailable()); }
    if (recordId && sessionEmail) {
      setSaveState("saving");
      try {
        await saveRetainedSnapshot(workspaceSnapshot(false));
        setSaveState("saved");
        setRunError("");
        return true;
      } catch (cause) {
        setSaveState("error");
        setRunError(cause instanceof Error ? cause.message : "The retained workspace could not be saved.");
        return false;
      }
    }
    return localSaved;
  };

  const leaveForAccountPage = async (target: string) => {
    const saved = await preserveDraft(!sessionEmail);
    const hasWork = Boolean(sourceText.trim() || selectedFile || criteria.length);
    if (!saved && hasWork && !window.confirm("This draft could not be saved in this browser, so it will not be here when you come back. Leave this page anyway?")) return;
    window.location.assign(target);
  };

  const reset = () => {
    const unfinished = sourceMode === "live" && Boolean(sourceText.trim() || selectedFile || criteria.length || recordId);
    if (unfinished && !window.confirm("Start a new import? This clears the unfinished workspace from this browser.")) return;
    analysisController.current?.abort("new-import");
    analysisController.current = null;
    runController.current?.abort("new-import");
    runController.current = null;
    const previousDraftId = draftId;
    const nextDraftId = crypto.randomUUID();
    setDraftId(nextDraftId);
    setPhase("intake");
    setSourceMode("live");
    setSourceText("");
    setSourceName("Pasted SOW");
    setSourceReattachRequired(false);
    setSelectedFile(null);
    setSelectedFileMeta(null);
    setAttested(false);
    setAiDisclosureAccepted(false);
    setAdultBusinessUseAttested(false);
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setAnalysisNotice("");
    setAnalysisMode(geminiConfigured ? "gemini" : "fallback");
    setModel(geminiConfigured ? "Gemini" : "Greenlit local source parser");
    setCopied(false);
    setLastVerificationPhase(null);
    setReviewCreated(false);
    setRecordId(null);
    setLatestRun(null);
    setRunError("");
    setPollNetworkFailure(false);
    setSaveState("idle");
    setReviewUrl("");
    setReviewAccessCode("");
    setReviewerEmail("");
    setReviewPacketId("");
    setChangeRequest("");
    setCustomRun(null);
    setVerificationDraft(null);
    setRunRequestId(null);
    setRetainedFixtureRecord(false);
    setBusiness({ agencyName: "", clientName: "", projectName: "", milestoneTitle: "", amountDollars: "", currency: "USD" });
    if (previousDraftId) removeProjectDraft(sessionEmail, previousDraftId);
    clearLegacyGlobalDraftState();
    window.history.replaceState({}, "", `/workspace?draft=${encodeURIComponent(nextDraftId)}`);
    setToast("Ready for a new SOW");
  };

  const launchDemo = () => {
    runController.current?.abort("guided-demo");
    runController.current = null;
    setDraftId(crypto.randomUUID());
    setSourceMode("demo");
    setSourceText(demoSowText);
    setSourceName("Acme × Northstar SOW.pdf");
    setSourceReattachRequired(false);
    setBusiness({
      agencyName: "Northstar Studio",
      clientName: "Acme Outdoors",
      projectName: "Acme Outdoors website",
      milestoneTitle: "Spring launch",
      amountDollars: "12000.00",
      currency: "USD",
    });
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setAnalysisNotice("");
    setAnalysisMode(geminiConfigured ? "gemini" : "fallback");
    setModel(geminiConfigured ? "Gemini" : "Greenlit local source parser");
    setLastVerificationPhase(null);
    setReviewCreated(false);
    setRecordId(null);
    setLatestRun(null);
    setRunError("");
    setReviewUrl("");
    setReviewAccessCode("");
    setReviewerEmail("");
    setReviewPacketId("");
    setCustomRun(null);
    setVerificationDraft(null);
    setRunRequestId(null);
    setRetainedFixtureRecord(false);
    clearLegacyGlobalDraftState();
    setSaveState("idle");
    setPollNetworkFailure(false);
    setPhase("criteria");
    setToast("Guided demo loaded");
  };

  // Layout effects run before the restoration effect, so the public demo can
  // launch synchronously without waiting on the account-session request.
  useLayoutEffect(() => { launchDemoRef.current = launchDemo; });

  const openGuidedDemo = async () => {
    const hasLiveWork = sourceMode === "live" && Boolean(sourceText.trim() || selectedFile || criteria.length || recordId);
    if (hasLiveWork) {
      const saved = await preserveDraft();
      if (!saved && !window.confirm("This live draft could not be fully saved. Open the guided demo anyway? Your latest unsaved changes may not be recoverable.")) return;
    }
    // A full navigation gives the synthetic walkthrough its own in-memory
    // workspace while keeping the live draft URL in browser history.
    window.location.assign("/workspace?demo=guided");
  };

  const analyze = async () => {
    if (!attested || !aiDisclosureAccepted || !adultBusinessUseAttested) {
      setAnalysisError("Complete all three data and business-use confirmations before analysis.");
      return;
    }
    if (!selectedFile && sourceText.trim().length < 80) {
      setAnalysisError("Paste at least 80 characters or choose a PDF, TXT, or Markdown file.");
      return;
    }
    const businessEntries: Array<[string, string]> = [
      ["agency or vendor", business.agencyName], ["client", business.clientName], ["project", business.projectName], ["milestone", business.milestoneTitle], ["milestone value", business.amountDollars], ["currency", business.currency],
    ];
    const missingBusiness = businessEntries.find(([, value]) => !value.trim());
    if (missingBusiness) {
      setAnalysisError(`Enter the ${missingBusiness[0]} before source analysis.`);
      return;
    }
    const overlongBusiness = [
      ["agency or vendor", business.agencyName, 120],
      ["client", business.clientName, 120],
      ["project", business.projectName, 180],
      ["milestone", business.milestoneTitle, 180],
    ] as const;
    const overlong = overlongBusiness.find(([, value, maximum]) => value.trim().length > maximum);
    if (overlong) {
      setAnalysisError(`Keep the ${overlong[0]} at ${overlong[2]} characters or fewer before source analysis.`);
      return;
    }
    const amountMinor = Math.round(Number(business.amountDollars) * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      setAnalysisError("Enter a valid non-negative milestone value with no more than two decimal places.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(business.currency.toUpperCase())) {
      setAnalysisError("Choose a valid three-letter currency.");
      return;
    }

    setPhase("analyzing");
    setAnalysisError("");
    setAnalysisNotice("");
    const controller = new AbortController();
    analysisController.current?.abort("replaced-analysis");
    analysisController.current = controller;
    const analysisTimeout = window.setTimeout(() => controller.abort(new DOMException("Analysis timed out", "TimeoutError")), 15_000);
    try {
      let response: Response;
      if (selectedFile) {
        const form = new FormData();
        form.set("file", selectedFile);
        form.set("sourceDataAttested", "true");
        form.set("aiDisclosureAccepted", "true");
        form.set("adultBusinessUseAttested", "true");
        response = await fetch("/api/analyze", { method: "POST", body: form, signal: controller.signal });
      } else {
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sourceText, sourceName, sourceDataAttested: true, aiDisclosureAccepted: true, adultBusinessUseAttested: true }),
          signal: controller.signal,
        });
      }
      const responseText = await response.text();
      let payload: AnalysisResponse;
      try {
        payload = JSON.parse(responseText) as AnalysisResponse;
      } catch {
        throw new Error("The analysis service returned an unexpected response. Try again or use the guided demo.");
      }
      if (!response.ok) throw new Error(payload.error || "Greenlit could not analyze this SOW.");
      setSourceText(payload.sourceText);
      setSourceName(payload.sourceName);
      setSourceReattachRequired(false);
      const drafted = payload.criteria.map((item, index) => ({ ...item, id: `AC-${String(index + 1).padStart(2, "0")}` }));
      setCriteria(applyFixtureMappings(payload.sourceText, drafted));
      setConfirmed({});
      const completedAnalysisMode = payload.analysisMode ?? "gemini";
      setModel(payload.model ?? (completedAnalysisMode === "fallback" ? "Greenlit local source parser" : "Gemini"));
      setAnalysisMode(completedAnalysisMode);
      setAnalysisNotice(payload.notice ?? "");
      setSourceMode("live");
      setPhase("criteria");
      setToast(analysisResultPresentation(completedAnalysisMode, payload.criteria.length, payload.durationMs).toast);
    } catch (error) {
      if (controller.signal.reason === "new-import" || controller.signal.reason === "workspace-unmounted" || controller.signal.reason === "replaced-analysis") return;
      const message = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError"
        ? "Analysis exceeded 15 seconds. Try again or launch the reliable guided demo."
        : error instanceof Error ? error.message : "The SOW could not be analyzed.";
      setAnalysisError(message);
      setPhase("intake");
    } finally {
      window.clearTimeout(analysisTimeout);
      if (analysisController.current === controller) analysisController.current = null;
    }
  };

  const startRun = async (second = false, configuration?: CustomRunConfiguration | null) => {
    if (sourceMode === "demo") setConfirmed(Object.fromEntries(demoCriteria.map((item) => [item.id, true])));
    runController.current?.abort("replaced-run");
    const controller = new AbortController();
    runController.current = controller;
    setRunError("");
    setPhase(second ? "running2" : "running1");
    const frozenCriteria = sourceMode === "demo"
      ? demoCriteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.source }))
      : criteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.sourceQuote, supported: item.supported, checkType: item.checkType }));
    const activeCustomRun = configuration === null ? null : configuration ?? customRun;
    try {
      if (sourceMode === "demo") {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        if (controller.signal.aborted) return;
        const completedAt = new Date().toISOString();
        const results = seededDemoResults(second ? "rc2" : "rc1", completedAt) as RunResult[];
        const passing = results.every((result) => result.status === "PASS");
        const demoRun: RunResponse = {
          runId: second ? "DEMO-RUN-RC2" : "DEMO-RUN-RC1",
          recordId: "DEMO-NOT-RETAINED",
          status: "COMPLETED",
          outcome: passing ? "READY_FOR_REVIEW" : "NEEDS_WORK",
          buildUrl: `/fixture/${second ? "rc2" : "rc1"}`,
          buildLabel: `launch-${second ? "rc2" : "rc1"}`,
          results,
          artifacts: seededDemoArtifacts(second ? "rc2" : "rc1"),
          browserVersion: "Illustrative sample",
          runnerVersion: "walkthrough-1.0",
          manifestSha256: null,
          completedAt,
          seededDemo: true,
          record: { public_id: "DEMO-NOT-RETAINED", revision: 1, confirmed_criteria: demoCriteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.source })) },
        };
        setLatestRun(demoRun);
        const completedPhase: Phase = passing ? "run2" : "run1";
        setPhase(completedPhase);
        setLastVerificationPhase(completedPhase);
        setToast(`${results.filter((result) => result.status === "PASS").length} of ${results.length} sample checks shown`);
        return;
      }
      const amountMinor = Math.round(Number(business.amountDollars) * 100);
      if (!Number.isFinite(amountMinor) || amountMinor < 0) throw new Error("Enter a valid milestone value.");
      if (!sessionEmail) throw new Error("Sign in before creating a retained verification run.");
      if (!canUseImportedFixture && !activeCustomRun) throw new Error("Verify the staging origin and map the browser checks before running evidence.");
      const sourceSha256 = await browserSha256(sourceText);
      const requestId = runRequestId ?? crypto.randomUUID();
      setRunRequestId(requestId);
      if (draftId) saveProjectDraft(sessionEmail, draftId, JSON.stringify({ ...workspaceSnapshot(!sessionEmail), runRequestId: requestId, savedAt: new Date().toISOString() }));
      const response = await fetchWithTimeout("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          recordId: recordId ?? undefined,
          requestId,
          version: second ? "rc2" : "rc1",
          sourceMode,
          sourceName,
          sourceSha256,
          agencyName: business.agencyName,
          clientName: business.clientName,
          projectName: business.projectName,
          milestoneTitle: business.milestoneTitle,
          amountMinor,
          currency: business.currency.toUpperCase(),
          criteria: frozenCriteria,
          ownerTermsAccepted: true,
          noticeVersion: RECORD_NOTICE_VERSION,
          workspaceState: workspaceSnapshot(false),
          ...(activeCustomRun ?? {}),
        }),
      }, 25_000);
      const created = await response.json();
      if (created.recordId) {
        setRecordId(created.recordId);
        window.history.replaceState({}, "", `/workspace?record=${encodeURIComponent(created.recordId)}`);
        setRunRequestId(null);
      }
      if (!response.ok) throw new Error(created.error ?? "The verification run could not be created.");
      setRunRequestId(null);
      setRetainedFixtureRecord(!activeCustomRun);
      setLatestRun({ runId: created.runId, recordId: created.recordId, status: created.status ?? "QUEUED", buildUrl: activeCustomRun?.targetUrl ?? window.location.origin, buildLabel: activeCustomRun?.buildLabel ?? `launch-${second ? "rc2" : "rc1"}`, results: [], artifacts: [] });
      const deadline = Date.now() + 12 * 60_000;
      while (!controller.signal.aborted && Date.now() < deadline) {
        let statusResponse: Response;
        let statusPayload: RunResponse & { error?: string };
        try {
          statusResponse = await fetchWithTimeout(`/api/runs/${encodeURIComponent(created.runId)}`, { signal: controller.signal, cache: "no-store" }, 20_000);
          statusPayload = await statusResponse.json() as RunResponse & { error?: string };
        } catch (statusError) {
          if (controller.signal.aborted) return;
          if (!(statusError instanceof TypeError)) throw statusError;
          // Keep polling through connection drops: the retained job is still
          // active on the server and this status check is read-only.
          setPollNetworkFailure(true);
          setRunError("The verification status could not be checked because of a network problem. The retained job is still active on the server; you can keep waiting here or return to the dashboard and reopen this project later.");
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          continue;
        }
        setPollNetworkFailure(false);
        setRunError("");
        if (!statusResponse.ok) throw new Error(statusPayload.error ?? "Verification status is unavailable.");
        if (statusPayload.status === "COMPLETED") {
          setLatestRun(statusPayload);
          const completedPhase: Phase = statusPayload.outcome === "READY_FOR_REVIEW" ? "run2" : "run1";
          setPhase(completedPhase);
          setLastVerificationPhase(completedPhase);
          setToast(`${statusPayload.results.filter((result) => result.status === "PASS").length} of ${statusPayload.results.length} checks passed`);
          return;
        }
        if (isTerminalRunFailure(statusPayload.status)) {
          setLatestRun(statusPayload);
          setRunRequestId(null);
          setRunError(terminalRunMessage(statusPayload.status, statusPayload.error));
          setPhase(canUseImportedFixture ? "criteria" : "handoff");
          setLastVerificationPhase(null);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (!controller.signal.aborted) {
        setRunError("Verification is still running. The job is saved. You can leave this page or return from the dashboard without starting a duplicate run.");
        return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const friendly = friendlyRunError(error);
      setRunError(friendly);
      if (/still running|saved/i.test(friendly)) return;
      if (/origin verification expired|verify it again/i.test(friendly)) setCustomRun((current) => current ? { ...current, originReceipt: "" } : current);
      setPhase(sourceMode === "live" && activeCustomRun ? "handoff" : second && latestRun ? "run1" : "criteria");
    } finally {
      if (runController.current === controller) runController.current = null;
    }
  };

  const continueFromCriteria = () => {
    if (sourceMode === "live" && sourceReattachRequired) {
      setRunError("Reattach the exact original SOW before verification. The retained record has its hash and cited quotes, but this browser does not have the complete source text.");
      return;
    }
    if (sourceMode === "live" && !canUseImportedFixture) {
      setLastVerificationPhase("handoff");
      setPhase("handoff");
    }
    else startRun(false, sourceMode === "live" ? null : undefined);
  };

  const share = async ({ reviewerEmail: intendedEmail, expiryHours }: { reviewerEmail: string; expiryHours: ReviewExpiryHours }) => {
    if (!latestRun) return;
    setReviewBusy(true);
    setRunError("");
    try {
      if (sourceMode === "demo") {
        const origin = window.location.origin;
        setReviewUrl(`${origin}/review/demo`);
      setReviewPacketId("DEMO-NOT-RETAINED");
      setManualReviewCopy(false);
      setPhase("shared");
        setReviewCreated(true);
        setToast("Synthetic client walkthrough ready");
        return;
      }
      if (!recordId) throw new Error("The retained milestone record is unavailable.");
      const response = await fetchWithTimeout("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId, runId: latestRun.runId, reviewerEmail: intendedEmail, expiryHours }) });
      const payload = await response.json();
      if (response.status === 409 && payload.activePacketId) {
        setReviewPacketId(payload.activePacketId);
        setReviewCreated(true);
        const replace = window.confirm("A client-review link is already active, but its secret cannot be recovered after reload. Revoke that link and create a replacement?");
        if (!replace) throw new Error("The existing review link remains active. You can revoke or extend it from the dashboard.");
        const revoked = await fetchWithTimeout(`/api/account/reviews/${encodeURIComponent(payload.activePacketId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke" }) });
        const revokedPayload = await revoked.json();
        if (!revoked.ok) throw new Error(revokedPayload.error ?? "The existing review link could not be revoked.");
        const replacement = await fetchWithTimeout("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId, runId: latestRun.runId, reviewerEmail: intendedEmail, expiryHours }) });
        const replacementPayload = await replacement.json();
        if (!replacement.ok) throw new Error(replacementPayload.error ?? "The replacement review link could not be created.");
        setReviewUrl(replacementPayload.reviewUrl);
        setManualReviewCopy(false);
        setReviewAccessCode(replacementPayload.accessCode);
        setReviewerEmail(replacementPayload.reviewerEmail);
        setReviewPacketId(replacementPayload.packetId);
        setReviewExpiresAt(replacementPayload.expiresAt);
        setReviewSetupOpen(false);
        setPhase("shared");
        setToast("Old review revoked; replacement link created");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "The client review could not be created.");
      setReviewUrl(payload.reviewUrl);
      setManualReviewCopy(false);
      setReviewAccessCode(payload.accessCode);
      setReviewerEmail(payload.reviewerEmail);
      setReviewPacketId(payload.packetId);
      setReviewExpiresAt(payload.expiresAt);
      setReviewSetupOpen(false);
      setPhase("shared");
      setReviewCreated(true);
      setToast("Secure client review created");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The client review could not be created.");
    } finally { setReviewBusy(false); }
  };

  const copyReview = async () => {
    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
      setManualReviewCopy(false);
      setToast("Review link copied");
    } catch {
      setCopied(false);
      setManualReviewCopy(true);
      setToast("Clipboard unavailable. Select and copy the link manually.");
    }
  };

  const openClientReview = () => {
    // The bearer token is only ever held in memory for the tab that created
    // it, never persisted, so if it is gone (e.g. after a reload) a fresh
    // review packet is minted rather than trying to resurrect the old link.
    if (reviewUrl) setPhase("shared");
    else if (sourceMode === "demo") void share({ reviewerEmail: "demo@example.test", expiryHours: 72 });
    else setReviewSetupOpen(true);
  };

  const openApprovalRecord = async () => {
    if (!reviewPacketId) return;
    if (sourceMode === "demo") { window.location.assign("/receipt/demo"); return; }
    try {
      const response = await fetchWithTimeout(`/api/reviews/${encodeURIComponent(reviewPacketId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "This review record is unavailable.");
      if (payload.decision === "APPROVED") window.location.assign(`/receipt/${reviewPacketId}`);
      else setToast(payload.decision === "CHANGES_REQUESTED" ? "The client requested changes. No approval receipt is available yet." : "Awaiting the client's decision. No approval receipt is available yet.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "This review record is unavailable.");
    }
  };

  const projectLabel = sourceText ? business.projectName : "New milestone proof";
  const analysisPresentation = analysisResultPresentation(analysisMode, criteria.length);
  const reportCriteria = sourceMode === "demo"
    ? demoCriteria.map((item) => ({ id: item.id, title: item.title }))
    : latestRun?.record?.confirmed_criteria ?? criteria;
  const draftCriteriaChanged = sourceMode === "live" && latestRun?.record
    ? !sameConfirmedCriteriaRevision(criteria, latestRun.record.confirmed_criteria)
    : false;
  const workspaceTitle = phase === "intake" || phase === "analyzing"
    ? "Import the promises worth proving"
    : phase === "criteria"
      ? "Confirm what “done” means"
      : phase === "handoff"
        ? "Connect the build to verify"
        : phase === "shared"
          ? "Client review is ready"
          : "Verification evidence";
  const nextStepCopy = phase === "analyzing"
    ? geminiConfigured
      ? "Gemini is drafting source-backed criteria. Keep this page open; no action is needed yet."
      : "Greenlit's local source parser is drafting source-grounded criteria. No SOW text will be sent to Google."
    : phase === "intake"
      ? sessionEmail
        ? "Add the SOW and milestone details, accept the notices, then generate the criteria."
        : AGENCY_BETA_SIGN_IN_VISIBLE
          ? "Add the SOW and milestone details. Sign in only when you are ready to generate the criteria."
          : sourceText.trim() || selectedFile
            ? geminiConfigured
              ? "Complete the milestone details and notices, then let Gemini draft source-backed criteria for your review."
              : "Complete the milestone details and notices, then use the local source parser to draft criteria for your review."
            : geminiConfigured
              ? "Add a synthetic or non-confidential SOW for live Gemini criteria, or explore the complete guided walkthrough."
              : "Add a synthetic or non-confidential SOW for local source-grounded criteria, or explore the complete guided walkthrough."
      : phase === "criteria"
        ? sourceMode === "demo"
          ? "Review the six source-backed checks, then confirm them to verify the sample build."
          : "Review each source quote and outcome, edit anything unclear, then confirm the criteria."
        : phase === "handoff"
          ? "Connect the owner-verified staging build and choose the checks to run."
          : phase === "running1" || phase === "running2"
            ? "Keep this page open while Greenlit prepares the verification results."
            : phase === "run1"
              ? "Review the failed evidence, then verify the fixed build against the same criteria."
              : phase === "run2"
                ? sourceMode === "demo"
                  ? "Open the sample client review to see the decision experience."
                  : "Review the passing evidence and billing settings, then create the client review."
                : sourceMode === "demo"
                  ? "Open the client view and complete the sample decision."
                  : "Copy the review link and send its access code to the named reviewer separately.";

  if (restorePending || restoreError) {
    return (
      <main className="app-shell">
        <header className="app-topbar"><Brand inverse /></header>
        <section className="panel loading-panel" role="alert">
          <div className="loading-content">
            {restorePending ? <LoaderCircle className="spin" size={30} /> : <AlertTriangle size={30} />}
            <h1>{restorePending ? guidedDemo ? "Preparing the guided walkthrough…" : "Restoring your workspace…" : "We could not safely restore this workspace."}</h1>
            <p>{restorePending ? guidedDemo ? "Loading the sample promise, verification evidence, client decision, and invoice-ready record. No account is required." : "Checking your session and newest retained project state before editing is enabled." : restoreError}</p>
            {!restorePending && <><p>Your browser copy has not been overwritten. Retry once the connection is stable.</p><button type="button" className="button button--ink" onClick={() => window.location.reload()}><RefreshCw size={15} /> Retry restoration</button></>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <Brand inverse />
        <div className="app-topbar__right">
          <span className="demo-badge">{sourceMode === "demo" ? "Guided demo" : analysisPresentation.badge}</span>
          {(sessionEmail || AGENCY_BETA_SIGN_IN_VISIBLE) && <Link className="app-account-link" onClick={(event) => { event.preventDefault(); void leaveForAccountPage(sessionEmail ? "/dashboard" : signInHref); }} href={(sessionEmail ? "/dashboard" : signInHref) as Route}>{sessionEmail ? "Dashboard" : "Agency sign in"}</Link>}
          <button className="button button--small button--outline" onClick={reset}><RefreshCw size={13} /> New import</button>
          <span className="avatar" aria-label={sessionEmail || "Guided workspace"}>{sessionEmail ? sessionEmail.slice(0, 2).toUpperCase() : "GW"}</span>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-sidebar" aria-label="Milestone navigation">
          <Link className="back-link" href="/"><ArrowLeft size={13} /> Back to overview</Link>
          <div className="project-card">
            <span>Project</span>
            <strong>{projectLabel}</strong>
            <small>{sourceText ? "Source loaded" : "Start with a SOW"}</small>
          </div>
          <div className="side-label">Proof flow</div>
          <nav className="side-nav">
            <button className={currentStep === 1 ? "is-active" : ""} disabled={criteria.length === 0 && sourceMode !== "demo"} onClick={() => setPhase("criteria")}><FileText size={15} /><span>Acceptance criteria</span>{visibleCount > 0 && <span className="side-nav__count">{visibleCount}</span>}</button>
            <button className={currentStep === 2 ? "is-active" : ""} disabled={!lastVerificationPhase || phase.startsWith("running")} onClick={() => lastVerificationPhase && setPhase(lastVerificationPhase)}><ScanSearch size={15} /><span>Verification run</span>{lastVerificationPhase && latestRun && <span className="side-nav__count">{latestPassCount}/{latestRun.results.length}</span>}</button>
            <button className={currentStep === 3 ? "is-active" : ""} disabled={!reviewCreated} onClick={openClientReview}><Send size={15} /><span>Client review</span></button>
            <button disabled={!reviewPacketId} onClick={() => void openApprovalRecord()}><FileCheck2 size={15} /><span>Approval record</span></button>
          </nav>
          <details className="side-details">
            <summary>Import details</summary>
            <div className="side-facts">
              <div><span>AI</span><strong>{sourceMode === "demo" ? "Synthetic guided demo" : model}</strong></div>
              <div><span>Source</span><strong>{sourceText ? "Local draft; server retains hash + quotes" : "Not loaded"}</strong></div>
              <div><span>Paid services</span><strong>{geminiPaidService ? "Gemini API" : "None"}</strong></div>
            </div>
          </details>
        </aside>

        <section className="app-main">
          <div className="workspace-head">
            <div className="workspace-head__title"><span>{sourceText ? sourceName : "New proof set · safe intake"}</span><h1 ref={phaseHeading} tabIndex={-1}>{workspaceTitle}</h1></div>
            <div className="workspace-head__meta">
              <span className={`status-badge ${status.className}`}>{phase === "analyzing" || phase.startsWith("running") ? <LoaderCircle className="spin" size={12} /> : <CircleDot size={11} />}{status.text}</span>
              {currentStep >= 2 && phase !== "handoff" && <span className="status-badge status-badge--neutral"><Globe2 size={11} /> {sourceMode === "demo" ? "Synthetic sample" : "Staging verified"}</span>}
              {sourceMode === "live" && draftId && saveState !== "idle" && (
                <span className={`save-status save-status--${saveState}`}>
                  <span role="status">{saveState === "saving" ? <><LoaderCircle className="spin" size={11} aria-hidden="true" /> Saving…</> : saveState === "saved" ? <><Check size={11} aria-hidden="true" /> Saved</> : <><AlertTriangle size={11} aria-hidden="true" /> Save failed</>}</span>
                  {saveState === "error" && <button type="button" className="mini-action" onClick={retrySave}>Retry</button>}
                </span>
              )}
            </div>
          </div>

          <ol className="stepper" aria-label="Milestone progress">
            {["Confirm criteria", "Verify build", "Client review", "Invoice-ready"].map((label, index) => {
              const step = index + 1;
              return <li className={`step ${step < currentStep ? "is-done" : step === currentStep ? "is-active" : ""}`} aria-current={step === currentStep ? "step" : undefined} key={label}>{label}</li>;
            })}
          </ol>
          <p className="workspace-next-step"><ArrowRight size={13} aria-hidden="true" /><span><strong>Next:</strong> {nextStepCopy}</span></p>

          <div className="sr-only" aria-live="polite" aria-atomic="true">{phase === "analyzing" ? `${geminiConfigured ? "Gemini" : "Local source"} analysis in progress` : phase.startsWith("running") ? "Verification in progress" : status.text}</div>

          {storageBlocked && sourceMode === "live" && <div className="analysis-error workspace-error" role="alert"><AlertTriangle size={15} /><span><strong>This browser is not saving drafts.</strong> Local storage is unavailable (private browsing, blocked storage, or a full disk), so this draft exists only in this open tab and will be lost if you reload or leave. {sessionEmail ? "Completed verification runs are still retained to your account." : AGENCY_BETA_SIGN_IN_VISIBLE ? "Sign in and run verification to retain the work server-side." : "Use the guided walkthrough to explore the complete workflow without saving this draft."}</span></div>}
          {runError && <div className="analysis-error workspace-error" role="alert"><AlertTriangle size={15} /><span>{runError}</span>{pollNetworkFailure ? <Link className="mini-action" href="/dashboard">Return to dashboard</Link> : <button className="mini-action" type="button" onClick={() => void openGuidedDemo()}>Open synthetic walkthrough</button>}</div>}
          {changeRequest && <div className="analysis-notice change-request-note" role="status"><PencilLine size={15} /><div><strong>Client change request</strong><span>{changeRequest}</span></div></div>}

          {(phase === "intake" || phase === "analyzing") && (
            <SowIntake
              sourceText={sourceText}
              setSourceText={setSourceText}
              selectedFile={selectedFile}
              setSelectedFile={(file) => { if (file && file.size > MAX_PERSISTED_FILE_BYTES) { setSelectedFile(null); setAnalysisError("Keep uploads under 1.5 MB so the complete draft can survive sign-in safely."); } else { setSelectedFile(file); setAnalysisError(""); } }}
              attested={attested}
              setAttested={setAttested}
              aiDisclosureAccepted={aiDisclosureAccepted}
              setAiDisclosureAccepted={setAiDisclosureAccepted}
              adultBusinessUseAttested={adultBusinessUseAttested}
              setAdultBusinessUseAttested={setAdultBusinessUseAttested}
              business={business}
              setBusiness={setBusiness}
              error={analysisError}
              analyzing={phase === "analyzing"}
              onAnalyze={analyze}
              onDemo={() => void openGuidedDemo()}
              signedInEmail={sessionEmail}
              signInHref={signInHref}
              geminiConfigured={geminiConfigured}
              geminiPaidService={geminiPaidService}
              onSignIn={() => leaveForAccountPage(signInHref)}
            />
          )}
          {phase === "criteria" && sourceMode === "demo" && (
            <DemoCriteriaReview confirmed={confirmed} setConfirmed={setConfirmed} onRun={() => startRun(false)} />
          )}
          {phase === "criteria" && sourceMode === "live" && (
            <ExtractedCriteriaReview
              sourceName={sourceName}
              sourceText={sourceText}
              criteria={criteria}
              setCriteria={setCriteria}
              confirmed={confirmed}
              setConfirmed={setConfirmed}
              model={model}
              analysisMode={analysisMode}
              notice={analysisNotice}
              recordId={recordId}
              sourceReattachRequired={sourceReattachRequired}
              onSourceReattached={(text, name, file) => { setSourceText(text); setSourceName(name); setSelectedFile(file); setSourceReattachRequired(false); setRunError(""); setToast("Original SOW reattached and hash-matched"); }}
              fixtureCompatible={canUseImportedFixture}
              onContinue={continueFromCriteria}
            />
          )}
          {phase === "handoff" && <VerificationSetup criteria={criteria} sourceName={sourceName} signedInEmail={sessionEmail} initialConfiguration={customRun} initialDraftState={verificationDraft} onDraftChange={setVerificationDraft} onBack={() => setPhase("criteria")} onDemo={() => void openGuidedDemo()} onRun={(configuration) => { setCustomRun(configuration); void startRun(false, configuration); }} />}
          {(phase === "running1" || phase === "running2") && <RunLoading second={phase === "running2"} seeded={sourceMode === "demo"} />}
          {phase === "run1" && latestRun && <VerificationReport run={latestRun} criteria={reportCriteria} draftCriteriaChanged={draftCriteriaChanged} onReturnToDraft={() => setPhase("criteria")} onRerun={() => sourceMode === "demo" ? void startRun(true) : canUseImportedFixture ? void startRun(true, null) : setPhase("handoff")} />}
          {phase === "run2" && latestRun && <VerificationReport run={latestRun} criteria={reportCriteria} draftCriteriaChanged={draftCriteriaChanged} onReturnToDraft={() => setPhase("criteria")} onShare={(trigger) => { if (sourceMode === "demo") { void share({ reviewerEmail: "demo@example.test", expiryHours: 72 }); } else { reviewTriggerRef.current = trigger; setRunError(""); setReviewSetupOpen(true); } }} shareBusy={reviewBusy} invoicePlan={!latestRun.seededDemo && sourceMode === "live" ? <InvoicePlanCard recordId={latestRun.recordId} clientName={business.clientName} projectName={business.projectName} milestoneTitle={business.milestoneTitle} amountMinor={Math.round(Number(business.amountDollars) * 100)} currency={business.currency} /> : null} />}
          {phase === "shared" && <SharedReview copied={copied} manualCopy={manualReviewCopy} onCopy={copyReview} reviewUrl={reviewUrl} accessCode={reviewAccessCode} reviewerEmail={reviewerEmail} expiresAt={reviewExpiresAt} packetId={reviewPacketId} clientName={business.clientName} criteriaCount={sourceMode === "demo" ? demoCriteria.length : criteria.length} resultCount={latestRun?.results.length ?? 0} demo={sourceMode === "demo"} />}
        </section>
      </div>
      {reviewSetupOpen && <ReviewSetupDialog initialEmail={reviewerEmail} busy={reviewBusy} error={runError} returnFocusRef={reviewTriggerRef} onClose={() => { if (!reviewBusy) { setReviewSetupOpen(false); setRunError(""); } }} onSubmit={(details) => void share(details)} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={16} color="var(--lime)" /> {toast}</div>}
    </main>
  );
}

function SowIntake({ sourceText, setSourceText, selectedFile, setSelectedFile, attested, setAttested, aiDisclosureAccepted, setAiDisclosureAccepted, adultBusinessUseAttested, setAdultBusinessUseAttested, business, setBusiness, error, analyzing, onAnalyze, onDemo, signedInEmail, signInHref, geminiConfigured, geminiPaidService, onSignIn }: {
  sourceText: string;
  setSourceText: (value: string) => void;
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  attested: boolean;
  setAttested: (value: boolean) => void;
  aiDisclosureAccepted: boolean;
  setAiDisclosureAccepted: (value: boolean) => void;
  adultBusinessUseAttested: boolean;
  setAdultBusinessUseAttested: (value: boolean) => void;
  business: BusinessDetails;
  setBusiness: React.Dispatch<React.SetStateAction<BusinessDetails>>;
  error: string;
  analyzing: boolean;
  onAnalyze: () => void;
  onDemo: () => void;
  signedInEmail: string;
  signInHref: Route;
  geminiConfigured: boolean;
  geminiPaidService: boolean;
  onSignIn: () => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const hasSourceInput = Boolean(selectedFile || sourceText.trim());
  useEffect(() => {
    if (!selectedFile && fileInput.current) fileInput.current.value = "";
  }, [selectedFile]);
  const loadSample = () => {
    setSelectedFile(null);
    setSourceText(demoSowText);
    setAttested(true);
    setBusiness({
      agencyName: "Northstar Studio",
      clientName: "Acme Outdoors",
      projectName: "Acme Outdoors website",
      milestoneTitle: "Spring launch",
      amountDollars: "12000.00",
      currency: "USD",
    });
  };
  const updateBusiness = (field: keyof BusinessDetails, value: string) => setBusiness((current) => ({ ...current, [field]: value }));

  return (
    <div className="intake-grid">
      <section className="panel intake-panel">
        <div className="intake-kicker"><WandSparkles size={14} /> {geminiConfigured ? "Gemini-powered SOW import" : "Local source-grounded SOW import"}</div>
        <h2>Turn contract language into proof-ready checks.</h2>
        <p className="intake-lede">Add the relevant SOW section and the milestone details below. Then generate source-backed acceptance criteria.{!geminiConfigured && " This deployment uses Greenlit's deterministic local parser and does not send the SOW to Google."}</p>
        <button className="intake-demo-link" disabled={analyzing} onClick={onDemo}>Prefer to explore first? Open the guided demo <ArrowRight size={13} /></button>

        <div className="source-input-head"><label htmlFor="sow-text">Paste SOW text</label><button type="button" onClick={loadSample}>Use the synthetic sample</button></div>
        <textarea id="sow-text" className="sow-textarea" value={sourceText} disabled={Boolean(selectedFile) || analyzing} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste the acceptance criteria, deliverables, or relevant SOW section here…" />
        <div className="input-divider"><span>or upload</span></div>
        <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" aria-label="Upload a PDF, TXT, or Markdown file" accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
        <button className={`upload-drop ${selectedFile ? "has-file" : ""}`} type="button" disabled={analyzing} onClick={() => fileInput.current?.click()}>
          <span className="upload-icon"><FileUp size={20} /></span>
          <span><strong>{selectedFile ? selectedFile.name : "Choose a PDF, TXT, or Markdown file"}</strong><small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : "Selectable text · 1.5 MB maximum"}</small></span>
          {selectedFile && <CheckCircle2 size={18} />}
        </button>
        {selectedFile && <button className="clear-file" type="button" onClick={() => setSelectedFile(null)}>Remove file and use pasted text</button>}

        <fieldset className="business-details" disabled={analyzing}>
          <legend>Milestone details for the client record</legend>
          <label htmlFor="agency-name">Agency or vendor<input id="agency-name" maxLength={120} aria-invalid={Boolean(error && (!business.agencyName.trim() || business.agencyName.trim().length > 120))} aria-describedby={error && (!business.agencyName.trim() || business.agencyName.trim().length > 120) ? "agency-name-error" : undefined} value={business.agencyName} onChange={(event) => updateBusiness("agencyName", event.target.value)} required />{error && (!business.agencyName.trim() || business.agencyName.trim().length > 120) && <small id="agency-name-error">Agency or vendor is required and must be 120 characters or fewer.</small>}</label>
          <label htmlFor="client-name">Client<input id="client-name" maxLength={120} aria-invalid={Boolean(error && (!business.clientName.trim() || business.clientName.trim().length > 120))} aria-describedby={error && (!business.clientName.trim() || business.clientName.trim().length > 120) ? "client-name-error" : undefined} value={business.clientName} onChange={(event) => updateBusiness("clientName", event.target.value)} required />{error && (!business.clientName.trim() || business.clientName.trim().length > 120) && <small id="client-name-error">Client is required and must be 120 characters or fewer.</small>}</label>
          <label htmlFor="project-name">Project<input id="project-name" maxLength={180} aria-invalid={Boolean(error && (!business.projectName.trim() || business.projectName.trim().length > 180))} aria-describedby={error && (!business.projectName.trim() || business.projectName.trim().length > 180) ? "project-name-error" : undefined} value={business.projectName} onChange={(event) => updateBusiness("projectName", event.target.value)} required />{error && (!business.projectName.trim() || business.projectName.trim().length > 180) && <small id="project-name-error">Project is required and must be 180 characters or fewer.</small>}</label>
          <label htmlFor="milestone-title">Milestone<input id="milestone-title" maxLength={180} aria-invalid={Boolean(error && (!business.milestoneTitle.trim() || business.milestoneTitle.trim().length > 180))} aria-describedby={error && (!business.milestoneTitle.trim() || business.milestoneTitle.trim().length > 180) ? "milestone-title-error" : undefined} value={business.milestoneTitle} onChange={(event) => updateBusiness("milestoneTitle", event.target.value)} required />{error && (!business.milestoneTitle.trim() || business.milestoneTitle.trim().length > 180) && <small id="milestone-title-error">Milestone is required and must be 180 characters or fewer.</small>}</label>
          <label htmlFor="milestone-value">Milestone value<input id="milestone-value" type="number" min="0" step="0.01" aria-invalid={Boolean(error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()))} aria-describedby={error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()) ? "milestone-value-error" : undefined} value={business.amountDollars} onChange={(event) => updateBusiness("amountDollars", event.target.value)} required />{error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()) && <small id="milestone-value-error">Enter a non-negative value with at most two decimal places.</small>}</label>
          <label htmlFor="milestone-currency">Currency<select id="milestone-currency" value={business.currency} onChange={(event) => updateBusiness("currency", event.target.value)}><option value="USD">USD</option><option value="CAD">CAD</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></label>
        </fieldset>

        <label className="attestation">
          <input type="checkbox" checked={attested} disabled={analyzing} onChange={(event) => setAttested(event.target.checked)} />
          <span>{geminiPaidService
            ? <><strong>I am authorized to submit this SOW for Gemini processing.</strong> I will not submit passwords, API keys, payment data, regulated data, or sensitive personal information.</>
            : <><strong>This SOW is synthetic or non-confidential.</strong> I will not submit personal, sensitive, regulated, or client-confidential information.</>}</span>
        </label>
        <label className="attestation">
          <input type="checkbox" checked={aiDisclosureAccepted} disabled={analyzing} onChange={(event) => setAiDisclosureAccepted(event.target.checked)} />
          <span>{!geminiConfigured
            ? <><strong>I understand this deployment uses local source processing.</strong> Greenlit will not send this SOW to Google or another AI provider, and I will review every generated criterion.</>
            : geminiPaidService
              ? <><strong>I acknowledge Gemini processing under the paid-service terms.</strong> Google states paid-service prompts and responses are not used to improve its products. I still will not submit secrets, regulated data, or material I am not authorized to process. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Provider terms</a></>
              : <><strong>I accept the Gemini unpaid-tier data notice.</strong> Google may use submitted content and responses to improve its products, and human reviewers may process it. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Provider terms</a></>}</span>
        </label>
        <label className="attestation">
          <input type="checkbox" checked={adultBusinessUseAttested} disabled={analyzing} onChange={(event) => setAdultBusinessUseAttested(event.target.checked)} />
          <span><strong>I am 18+, acting for a business, and accept the beta terms.</strong> I agree to the <Link href="/terms" target="_blank">Terms</Link>, <Link href="/privacy" target="_blank">Privacy Notice</Link>, and <Link href="/records" target="_blank">recordkeeping notice</Link>. {geminiConfigured && !geminiPaidService && "The unpaid Gemini flow is a U.S.-only beta; restricted regions use the local fallback."}</span>
        </label>

        <div className="intake-action-dock">
          {error && <div className="analysis-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
          <div className="intake-actions">
            {hasSourceInput && (signedInEmail || !AGENCY_BETA_SIGN_IN_VISIBLE)
              ? <button className="button button--ink" type="button" disabled={analyzing} onClick={onAnalyze}>{analyzing ? <><LoaderCircle className="spin" size={16} /> Drafting criteria…</> : <>{geminiConfigured ? "Generate acceptance criteria" : "Draft criteria locally"} <Sparkles size={15} /></>}</button>
              : hasSourceInput && AGENCY_BETA_SIGN_IN_VISIBLE
                ? <Link className="button button--ink" onClick={(event) => { event.preventDefault(); void onSignIn(); }} href={signInHref}><LockKeyhole size={15} /> Sign in & generate criteria</Link>
                : <button className="button button--ink" type="button" disabled={analyzing} onClick={onDemo}>Explore the full walkthrough <ArrowRight size={15} /></button>}
            <span>{hasSourceInput
              ? signedInEmail || !AGENCY_BETA_SIGN_IN_VISIBLE
                ? geminiConfigured
                  ? "Gemini will draft source-grounded criteria for you to review and confirm."
                  : "The local parser will draft source-grounded criteria for you to review and confirm. No SOW text goes to Google."
                : "Your draft will be preserved through sign-in."
              : "No SOW yet? The public walkthrough demonstrates criteria, verification, client review, and the approval record."}</span>
          </div>
        </div>

      </section>

      <aside className="intake-side">
        <section className="panel privacy-card"><LockKeyhole size={20} /><h3>Safe by design</h3><p>{geminiPaidService ? "Submit only scopes you are authorized to process, and never include secrets or regulated data." : "Use non-confidential scopes only."} {!geminiConfigured && "This deployment uses local source parsing; SOW text is not sent to Google. "}Source text is excluded from server records and evidence artifacts; an unfinished copy stays in this browser so reload does not erase your work.{signedInEmail ? "" : " Unsigned drafts are limited to this browser and deleted automatically after 30 minutes."}</p></section>
        <section className="panel trust-card">
          <span className="trust-card__number">01</span><strong>{geminiConfigured ? "Gemini drafts" : "Local parser drafts"}</strong><p>Atomic outcomes, exact quotes, and an evidence strategy.</p>
          <span className="trust-card__number">02</span><strong>You confirm</strong><p>Edit every claim and freeze only what both sides actually agreed.</p>
          <span className="trust-card__number">03</span><strong>The browser proves</strong><p>Typed, allowlisted checks produce timestamped evidence, never arbitrary AI code.</p>
        </section>
      </aside>
    </div>
  );
}

function DemoCriteriaReview({ confirmed, setConfirmed, onRun }: {
  confirmed: Record<string, boolean>;
  setConfirmed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onRun: () => void;
}) {
  const confirmedCount = Object.values(confirmed).filter(Boolean).length;
  const toggle = (id: string) => setConfirmed((current) => ({ ...current, [id]: !current[id] }));
  const allConfirmed = confirmedCount === demoCriteria.length;
  return (
    <div className="criteria-layout">
      <section className="panel source-sheet" aria-label="Source document">
        <div className="source-title"><span className="source-icon" aria-hidden="true"><FileText size={18} /></span><div><strong>Acme × Northstar SOW.pdf</strong><span>Selected page 4 · source hash 3f45b1d8…a209</span></div></div>
        <div className="document-page" tabIndex={0} aria-label="Scrollable synthetic source page">
          <div className="document-page__head"><span>Statement of work</span><span>Page 4 / 7</span></div>
          {sowExcerpt.map((line, index) => <div className={`document-line ${index > 0 ? "is-cited" : ""}`} key={line.line}><span>{line.line}</span><div>{line.text}</div></div>)}
          <div className="source-foot"><span>Acme Outdoors / Northstar Studio</span><span>SYNTHETIC DEMO · NOT CONFIDENTIAL</span></div>
        </div>
      </section>

      <section className="panel criteria-panel">
        <div className="panel-header">
          <div><h2>6 acceptance criteria</h2><p><Sparkles size={10} /> Review each source quote, then confirm the six checks.</p></div>
          <span className="status-badge status-badge--neutral">{confirmedCount}/6 confirmed</span>
        </div>
        <div className="criteria-list">
          {demoCriteria.map((item) => (
            <article className={`criterion-card ${confirmed[item.id] ? "is-confirmed" : ""}`} key={item.id}>
              <div className="criterion-card__top">
                <span className="criterion-id">{item.id}</span>
                <div><h3>{item.title}</h3><p>“{item.source}”</p></div>
                <span className="confirm-wrap">
                  <button className={`confirm-control ${confirmed[item.id] ? "is-checked" : ""}`} onClick={() => toggle(item.id)} aria-label={`${confirmed[item.id] ? "Unconfirm" : "Confirm"} ${item.id}`} aria-pressed={Boolean(confirmed[item.id])}>{confirmed[item.id] && <Check size={15} strokeWidth={3} />}</button>
                  <span className={`confirm-caption ${confirmed[item.id] ? "is-confirmed" : ""}`} aria-hidden="true">{confirmed[item.id] ? "Confirmed" : "Confirm"}</span>
                </span>
              </div>
              <div className="criterion-check"><Code2 size={12} /><span><strong>{item.type} check · {item.path}</strong><br />{item.check}</span><span className="criterion-type">Safe typed check</span></div>
            </article>
          ))}
        </div>
        <footer className="criteria-footer">
          <p><LockKeyhole size={11} /> The guided path uses a synthetic SOW and an isolated staging fixture.</p>
          <button className="button button--ink" onClick={onRun}>{allConfirmed ? "Verify the sample build" : "Confirm criteria & verify sample"} <ArrowRight size={16} /></button>
        </footer>
      </section>
    </div>
  );
}

function ExtractedCriteriaReview({ sourceName, sourceText, criteria, setCriteria, confirmed, setConfirmed, model, analysisMode, notice, recordId, sourceReattachRequired, onSourceReattached, fixtureCompatible: canRunFixture, onContinue }: {
  sourceName: string;
  sourceText: string;
  criteria: AnalysisCriterion[];
  setCriteria: React.Dispatch<React.SetStateAction<AnalysisCriterion[]>>;
  confirmed: Record<string, boolean>;
  setConfirmed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  model: string;
  analysisMode: AnalysisMode;
  notice: string;
  recordId: string | null;
  sourceReattachRequired: boolean;
  onSourceReattached: (text: string, name: string, file: File | null) => void;
  fixtureCompatible: boolean;
  onContinue: () => void;
}) {
  const reattachInput = useRef<HTMLInputElement>(null);
  const [reattachBusy, setReattachBusy] = useState(false);
  const [reattachError, setReattachError] = useState("");
  const [showPasteReattach, setShowPasteReattach] = useState(sourceReattachRequired);
  const [pastedSource, setPastedSource] = useState("");
  const citations = criteria.map((item) => item.sourceQuote);
  const sourceLines = sourceText.split("\n");
  const readyIds = criteria.filter((item) => isCriterionReady(sourceText, item)).map((item) => item.id);
  const confirmedCount = criteria.filter((item) => confirmed[item.id]).length;
  const allConfirmed = criteria.length > 0 && criteria.every((item) => confirmed[item.id] && isCriterionReady(sourceText, item));

  const update = (id: string, patch: Partial<AnalysisCriterion>) => {
    setCriteria((current) => current.map((item) => item.id === id ? {
      ...item,
      ...patch,
      grounded: patch.sourceQuote === undefined ? item.grounded : isGroundedQuote(sourceText, patch.sourceQuote),
    } : item));
    setConfirmed((current) => ({ ...current, [id]: false }));
  };
  const toggle = (item: AnalysisCriterion) => {
    if (!isCriterionReady(sourceText, item)) return;
    setConfirmed((current) => ({ ...current, [item.id]: !current[item.id] }));
  };
  const confirmReady = () => setConfirmed(Object.fromEntries(readyIds.map((id) => [id, true])));
  const nextCriterionId = () => {
    const next = Math.max(0, ...criteria.map((item) => Number(item.id.replace(/\D/g, "")) || 0)) + 1;
    return `AC-${String(next).padStart(2, "0")}`;
  };
  const addCriterion = () => {
    const id = nextCriterionId();
    setCriteria((current) => [...current, { id, title: "", sourceQuote: "", rationale: "Describe the evidence needed", supported: false, checkType: "manual", grounded: false }]);
  };
  const removeCriterion = (id: string) => {
    setCriteria((current) => current.filter((item) => item.id !== id));
    setConfirmed((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const duplicateCriterion = (item: AnalysisCriterion) => {
    const id = nextCriterionId();
    const index = criteria.findIndex((candidate) => candidate.id === item.id);
    setCriteria((current) => [...current.slice(0, index + 1), { ...item, id, title: `${item.title} (copy)` }, ...current.slice(index + 1)]);
    setConfirmed((current) => ({ ...current, [id]: false }));
  };
  const moveCriterion = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= criteria.length) return;
    setCriteria((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  };
  const reattachSource = async (file: File | null) => {
    if (!file || !recordId) return;
    setReattachBusy(true); setReattachError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}/source-reattach`, { method: "POST", body: form }, 20_000);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The source could not be reattached.");
      onSourceReattached(payload.sourceText, payload.sourceName, file);
    } catch (cause) { setReattachError(cause instanceof Error ? cause.message : "The source could not be reattached."); }
    finally { setReattachBusy(false); if (reattachInput.current) reattachInput.current.value = ""; }
  };

  const reattachPastedSource = async () => {
    if (!recordId || pastedSource.trim().length < 1) return;
    setReattachBusy(true); setReattachError("");
    try {
      const response = await fetchWithTimeout(`/api/account/records/${encodeURIComponent(recordId)}/source-reattach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pastedSource, sourceName: sourceName || "Pasted SOW" }),
      }, 20_000);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The pasted source could not be reattached.");
      onSourceReattached(payload.sourceText, payload.sourceName, null);
      setPastedSource("");
      setShowPasteReattach(false);
    } catch (cause) { setReattachError(cause instanceof Error ? cause.message : "The pasted source could not be reattached."); }
    finally { setReattachBusy(false); }
  };

  return (
    <div className="criteria-layout live-criteria-layout">
      <section className="panel source-sheet live-source" aria-label="Imported source document">
        <div className="source-title"><span className="source-icon" aria-hidden="true"><FileText size={18} /></span><div><strong>{sourceName}</strong><span>{sourceReattachRequired ? "Original source not attached · retained criterion quotes shown" : `Processed in memory · ${sourceText.length.toLocaleString()} characters`}</span></div>{recordId && <div className="source-reattach-actions"><input ref={reattachInput} className="sr-only" tabIndex={-1} type="file" aria-label="Choose the original SOW file to reattach" accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown" onChange={(event) => void reattachSource(event.target.files?.[0] ?? null)} /><button type="button" className="mini-action" disabled={reattachBusy} onClick={() => reattachInput.current?.click()}>{reattachBusy ? <LoaderCircle className="spin" size={12} /> : <FileUp size={12} />} Choose file</button><button type="button" className="mini-action" aria-expanded={showPasteReattach} onClick={() => setShowPasteReattach((current) => !current)}><FileText size={12} /> Paste original</button></div>}</div>
        {sourceReattachRequired && <div className="analysis-error source-reattach-warning" role="alert"><AlertTriangle size={15} /><span><strong>Complete source required before verification.</strong> This browser restored the retained criteria and exact quotes, but not the rest of the SOW. Paste the original text or choose the exact original file; Greenlit will verify its frozen hash.</span></div>}
        {showPasteReattach && recordId && <div className="source-reattach-panel"><label htmlFor="reattach-pasted-source">Exact original SOW text</label><textarea id="reattach-pasted-source" value={pastedSource} onChange={(event) => { setPastedSource(event.target.value); setReattachError(""); }} placeholder="Paste the same SOW text used for this milestone" /><div><button type="button" className="button button--outline button--small" disabled={reattachBusy || !pastedSource.trim()} onClick={() => void reattachPastedSource()}>{reattachBusy ? <LoaderCircle className="spin" size={12} /> : <ShieldCheck size={12} />} Verify and restore</button><button type="button" className="mini-action" onClick={() => { setShowPasteReattach(false); setPastedSource(""); setReattachError(""); }}>Cancel</button></div></div>}
        {reattachError && <div className="analysis-error" role="alert">{reattachError}</div>}
        <div className="source-proof-note"><Quote size={14} /><span>{sourceReattachRequired ? "Only the exact quotes retained with the confirmed criteria are shown until the original source is reattached." : "Highlighted lines are cited by the draft. Every citation is checked against this extracted source."}</span></div>
        <div className="document-page live-document" tabIndex={0} aria-label={sourceReattachRequired ? "Scrollable retained criterion quotes" : "Scrollable extracted source document"}>
          <div className="document-page__head"><span>{sourceReattachRequired ? "Retained criterion quotes" : "Extracted source"}</span><span>{sourceLines.length} lines</span></div>
          {sourceLines.map((line, index) => {
            const cited = lineContainsCitation(line, citations);
            return line.trim() ? <div className={`document-line ${cited ? "is-cited" : ""}`} aria-label={cited ? `Cited source line ${index + 1}` : `Source line ${index + 1}`} key={`${index}-${line.slice(0, 12)}`}><span aria-hidden="true">{index + 1}</span><div>{line}{cited && <span className="sr-only"> Cited by an acceptance criterion.</span>}</div></div> : <div className="document-spacer" key={index} />;
          })}
        </div>
      </section>

      <section className="panel criteria-panel live-criteria-panel">
        <div className="panel-header">
          <div><h2>{criteria.length} source-backed criteria</h2><p><Sparkles size={10} /> {model} drafted; {canRunFixture ? "included safe-fixture mappings applied" : "human confirmation required"}.</p></div>
          <div className="panel-header__actions"><span className="status-badge status-badge--neutral">{confirmedCount}/{criteria.length} confirmed</span><button className="mini-action" onClick={confirmReady}>Confirm grounded</button></div>
        </div>
        {notice && <div className="analysis-notice"><RefreshCw size={15} /><div><strong>{analysisResultPresentation(analysisMode, criteria.length).noticeHeading}</strong><span>{notice}</span></div></div>}
        <div className="criteria-list">
          {criteria.map((item, index) => {
            const ready = isCriterionReady(sourceText, item);
            return (
              <article className={`criterion-card live-criterion ${confirmed[item.id] ? "is-confirmed" : ""} ${!ready ? "has-warning" : ""}`} key={item.id}>
                <div className="criterion-card__top">
                  <span className="criterion-id">{item.id}</span>
                  <div className="criterion-edit-fields">
                    <label>{item.id} measurable outcome<input aria-invalid={item.title.trim().length < 3} aria-describedby={`${item.id}-validation`} value={item.title} onChange={(event) => update(item.id, { title: event.target.value })} /></label>
                    <label>{item.id} exact source quote<textarea aria-invalid={!item.grounded} aria-describedby={`${item.id}-validation`} value={item.sourceQuote} onChange={(event) => update(item.id, { sourceQuote: event.target.value })} /></label>
                  </div>
                  <span className="confirm-wrap">
                    <button disabled={!ready} className={`confirm-control ${confirmed[item.id] ? "is-checked" : ""}`} onClick={() => toggle(item)} aria-label={`${confirmed[item.id] ? "Unconfirm" : "Confirm"} ${item.id}`} aria-pressed={Boolean(confirmed[item.id])}>{confirmed[item.id] && <Check size={15} strokeWidth={3} />}</button>
                    <span className={`confirm-caption ${confirmed[item.id] ? "is-confirmed" : ""}`} aria-hidden="true">{confirmed[item.id] ? "Confirmed" : "Confirm"}</span>
                  </span>
                </div>
                <div className="criterion-metadata">
                  <label>{item.id} evidence type<select value={item.checkType} onChange={(event) => {
                    const checkType = event.target.value as CheckType;
                    update(item.id, { checkType, supported: checkType !== "manual" });
                  }}>{checkTypes.map((type) => <option value={type} key={type}>{checkLabels[type]}</option>)}</select></label>
                  <label>{item.id} evidence rationale<input value={item.rationale} onChange={(event) => update(item.id, { rationale: event.target.value })} /></label>
                </div>
                <div className="criterion-validation" id={`${item.id}-validation`}>
                  <span className={ready ? "is-valid" : "is-invalid"}>{ready ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}{ready ? "Valid: exact source match" : "Error: quote must match the source"}</span>
                  <span className={item.supported ? "is-valid" : "is-manual"}>{item.supported ? <Code2 size={12} aria-hidden="true" /> : <PencilLine size={12} aria-hidden="true" />}{item.supported ? "Automated: safe browser evidence" : "Manual: human review required"}</span>
                  <span className="criterion-row-actions">
                    <button type="button" className="mini-action" onClick={() => moveCriterion(index, -1)} disabled={index === 0} aria-label={`Move ${item.id} up`}><ArrowUp size={13} /> Move up</button>
                    <button type="button" className="mini-action" onClick={() => moveCriterion(index, 1)} disabled={index === criteria.length - 1} aria-label={`Move ${item.id} down`}><ArrowDown size={13} /> Move down</button>
                    <button type="button" className="mini-action" onClick={() => duplicateCriterion(item)} aria-label={`Duplicate ${item.id}`}><CopyPlus size={13} /> Duplicate</button>
                    <button type="button" className="mini-action text-action--danger" onClick={() => removeCriterion(item.id)} aria-label={`Remove ${item.id}`}><Trash2 size={13} /> Remove</button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="criteria-footer">
          <div><button type="button" className="button button--outline button--small" onClick={addCriterion}>Add criterion</button><p><LockKeyhole size={11} /> Editing a criterion clears its confirmation. Ungrounded quotes cannot be frozen.</p></div>
          <button className="button button--ink" disabled={!allConfirmed} onClick={onContinue}>{canRunFixture ? "Run on included staging fixture" : "Continue to verification setup"} <ArrowRight size={16} /></button>
        </footer>
      </section>
    </div>
  );
}

function RunLoading({ second, seeded }: { second: boolean; seeded: boolean }) {
  return (
    <section className="panel loading-panel" aria-live="polite">
      <div className="loading-content">
        <div className="scanner"><ShieldCheck size={28} /><span className="scanner-line" /></div>
        <h2>{seeded ? "Loading" : "Verifying"} {second ? "launch-rc2" : "launch-rc1"}</h2>
        <p>{seeded ? "Preparing a clearly labeled synthetic walkthrough. It does not call the browser runner or create a retained transaction record." : "Queueing and running six confirmed checks in an isolated Cloudflare browser. This normally takes a few seconds."}</p>
        <div className="loading-steps" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </section>
  );
}

function VerificationReport({ run, criteria, draftCriteriaChanged = false, onReturnToDraft, onRerun, onShare, shareBusy = false, invoicePlan }: { run: RunResponse; criteria: Array<{ id: string; title: string; supported?: boolean; checkType?: CheckType }>; draftCriteriaChanged?: boolean; onReturnToDraft?: () => void; onRerun?: () => void; onShare?: (trigger: HTMLButtonElement) => void; shareBusy?: boolean; invoicePlan?: React.ReactNode }) {
  const isPass = run.outcome === "READY_FOR_REVIEW";
  const counts = summarizeRunStatuses(run.results.map((result) => result.status));
  const passed = counts.PASS;
  const totalDuration = run.results.reduce((sum, result) => sum + result.durationMs, 0);
  const incomplete = counts.ERROR + counts.SKIPPED;
  const manualCount = criteria.filter((item) => !run.results.some((result) => result.criterionId === item.id)).length;
  const caughtFalseSuccess = run.results.some((result) => result.criterionId === "AC-04" && result.status === "FAIL" && /HTTP 500/.test(result.observed));
  const resultByCriterion = Object.fromEntries(run.results.map((result) => [result.criterionId, result]));
  const evidence = (caughtFalseSuccess ? run.artifacts.find((artifact) => artifact.url && artifact.criterionId === "AC-04") : null)
    ?? run.artifacts.find((artifact) => artifact.url && (!isPass ? resultByCriterion[artifact.criterionId]?.status !== "PASS" : true))
    ?? run.artifacts.find((artifact) => artifact.url);
  const completedAt = run.completedAt ? formatTimestamp(new Date(run.completedAt), run.seededDemo ? DEMO_TIME_ZONE : undefined) : "Just now";
  const statusSummary = [
    counts.PASS ? `${counts.PASS} passed` : "",
    counts.FAIL ? `${counts.FAIL} failed` : "",
    counts.ERROR ? `${counts.ERROR} runner ${counts.ERROR === 1 ? "error" : "errors"}` : "",
    counts.SKIPPED ? `${counts.SKIPPED} not run` : "",
  ].filter(Boolean).join(" · ");
  const scorePercent = verificationScorePercent(passed, run.results.length);
  const actionBanner = (
    <div className="action-banner">
      <div><h3>{draftCriteriaChanged ? "The draft changed after this evidence was captured." : run.seededDemo ? isPass ? "Continue to the client decision." : "Next: verify the fixed sample build." : isPass ? "Give the client proof, not a test report." : incomplete ? "Retry the incomplete verification." : caughtFalseSuccess ? "Next: verify the fixed build." : "Next: verify another build."}</h3><p>{draftCriteriaChanged ? "This report still shows the frozen criterion revision it actually verified. Confirm and rerun the revised draft before creating a client review." : run.seededDemo ? isPass ? "Open a local-only client review and try the decision flow." : "Run the same six checks against rc2; no re-analysis is needed." : isPass ? "Create a focused review page with the latest passing evidence." : incomplete ? "Runner errors and skipped checks are not assertion failures, but they also are not passing evidence." : "Rerun the same frozen checks after the build is corrected."}</p></div>
      <div className="action-banner__buttons">
        {!isPass && !draftCriteriaChanged && <a className="button button--outline" href={run.buildUrl} target="_blank" rel="noreferrer">Inspect build <ExternalLink size={14} /></a>}
        <button className="button button--lime" disabled={shareBusy} onClick={(event) => { if (draftCriteriaChanged) onReturnToDraft?.(); else if (isPass) onShare?.(event.currentTarget); else onRerun?.(); }}>{draftCriteriaChanged ? <>Review revised criteria <ArrowLeft size={15} /></> : isPass ? <>{shareBusy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{shareBusy ? "Creating secure review…" : "Create client review"}</> : <>{incomplete ? "Retry verification" : "Verify fixed build"} <Play size={15} /></>}</button>
      </div>
    </div>
  );
  return (
    <>
      <div className="report-grid">
        <section>
          <div className="panel report-summary">
            {run.seededDemo && <div className="analysis-notice"><AlertTriangle size={15} /><div><strong>Synthetic walkthrough. Not retained evidence</strong><span>The displayed frames were captured from Greenlit&apos;s included local fixture for presentation. The outcomes are seeded; no runner session, retained artifact, audit event, or legal transaction record was created.</span></div></div>}
            <div className="score-line">
              <div className="score-ring" role="img" aria-label={`${passed} of ${run.results.length} automated checks passed`} style={{ "--score": `${scorePercent}%` } as React.CSSProperties}><strong aria-hidden="true">{passed}/{run.results.length}</strong></div>
              <div className="score-copy"><h2>{run.seededDemo ? isPass ? "Sample: every automated check passes." : counts.FAIL === 1 ? "Sample: one automated check needs work." : `Sample: ${counts.FAIL} automated checks need work.` : isPass ? manualCount ? "Automated checks pass; client judgment remains." : "Every promise has browser evidence." : incomplete ? "Verification did not complete every check." : counts.FAIL === 1 ? "One automated check needs work." : `${counts.FAIL} automated checks need work.`}</h2><p>{run.seededDemo ? isPass ? "This seeded outcome opens the client-decision walkthrough without claiming real evidence." : caughtFalseSuccess ? "The sample illustrates a polished success message contradicting an HTTP 500 response." : "The sample illustrates how unmet criteria appear." : isPass ? manualCount ? `${run.results.length} automated checks passed; ${manualCount} manual ${manualCount === 1 ? "promise awaits" : "promises await"} the client’s judgment.` : "This milestone has a passing browser-evidence run and is ready for client review." : incomplete ? statusSummary : caughtFalseSuccess ? "The interface says success, but the underlying lead request failed." : "The browser evidence found checks that did not meet the frozen scope."}</p></div>
            </div>
            <div className="run-meta"><div><span>Build</span><strong>{run.buildLabel}</strong></div><div><span>Verified</span><strong>{completedAt}</strong></div><div><span>Runtime</span><strong>{formatDuration(totalDuration)}</strong></div></div>
          </div>
          {(run.seededDemo || !isPass) && actionBanner}
          <div className="panel result-list">
            <div className="panel-header"><div><h3>{run.seededDemo ? "Sample acceptance outcomes" : "Acceptance evidence"}</h3><p>Compare the expected and observed result for every frozen check.</p><details className="run-technical"><summary>Run details</summary><span>Run {run.runId.slice(0, 13)}… · {run.browserVersion ?? "Chromium"} · runner {run.runnerVersion ?? "0.2"}</span></details></div><span className={`status-badge ${isPass ? "status-badge--pass" : "status-badge--fail"}`}>{statusSummary}</span></div>
            {criteria.map((item) => {
              const result = resultByCriterion[item.id];
              const manual = !result && (item.supported === false || item.checkType === "manual");
              const resultPassed = result?.status === "PASS";
              const presentation = result ? runResultPresentation(result.status) : null;
              const resultIsFailure = presentation?.tone === "fail";
              return <div className={`result-row ${resultIsFailure ? "is-fail" : ""} ${manual ? "is-manual" : ""}`} key={item.id}><span className="criterion-id">{item.id}</span><div className="result-name"><strong>{item.title}</strong><span>{manual ? "Expected: client judgment on the confirmed promise" : `Expected: ${result?.expected ?? "Recorded check"} · ${formatDuration(result?.durationMs ?? 0)}`}</span></div><span className="result-observed">{manual ? "Reserved for client review" : result?.observed ?? "No result returned"}</span><span className={`result-icon ${resultIsFailure ? "is-fail" : ""} ${manual ? "is-manual" : ""}`} title={presentation?.description}>{manual ? <PencilLine size={13} aria-hidden="true" /> : resultPassed ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : result?.status === "ERROR" ? <AlertTriangle size={13} aria-hidden="true" /> : result?.status === "SKIPPED" ? <CircleDot size={13} aria-hidden="true" /> : <X size={13} strokeWidth={3} aria-hidden="true" />}<span>{manual ? "Manual review" : presentation?.label ?? "No result"}</span></span></div>;
            })}
          </div>
        </section>

        <aside className="run-side">
          <div className="panel evidence-card">
            <div className="evidence-preview">
              {evidence?.url ? <Image unoptimized width={1280} height={720} src={evidence.url} alt={run.seededDemo ? `Synthetic fixture frame for ${evidence.criterionId}` : `Browser evidence for ${evidence.criterionId}`} /> : <div className="evidence-unavailable"><FileWarning size={28} /><strong>Evidence unavailable</strong><span>No captured screenshot was attached to this check.</span></div>}
              {!isPass && <span className="evidence-pin">!</span>}
            </div>
            <div className="evidence-body"><strong>{run.seededDemo ? "Illustrative walkthrough frame" : isPass ? "Evidence captured" : `Failure evidence · ${evidence?.criterionId ?? "check"}`}</strong><p>{run.seededDemo ? "This frame comes from the included synthetic fixture. It is presentation media, not a retained runner artifact or proof claim." : isPass ? `${run.artifacts.length} timestamped screenshots are attached to this retained run.` : caughtFalseSuccess ? "The visible confirmation contradicted the network response. Greenlit caught the false success." : "The observed browser evidence did not satisfy this frozen check."}</p></div>
          </div>
          <div className="panel audit-card"><h3>{run.seededDemo ? "Walkthrough boundary" : "Run integrity"}</h3><div className="audit-item"><strong>{run.seededDemo ? "Seeded outcomes" : "Target constrained"}</strong>{run.seededDemo ? "Reliable presentation path when free runner capacity is unavailable." : `The runner was constrained to the owner-verified origin ${new URL(run.buildUrl).origin}.`}</div><div className="audit-item"><strong>Specs frozen</strong>{criteria.length} human-confirmed checks, revision {run.record?.revision ?? 1}.</div><div className="audit-item"><strong>{run.seededDemo ? "No evidence claim" : "Artifacts hashed"}</strong>{run.seededDemo ? "Fixture frames are bundled presentation media; no artifact hashes, audit events, or approvals are persisted." : `SHA-256 manifest ${run.manifestSha256?.slice(0, 12) ?? "pending"}…`}</div><div className="audit-item"><strong>Source minimized</strong>{run.seededDemo ? "Only the included synthetic SOW is displayed." : "Only a source hash and confirmed criteria enter the record."}</div></div>
        </aside>
      </div>
      {isPass && !draftCriteriaChanged && invoicePlan}
      {!run.seededDemo && isPass && actionBanner}
    </>
  );
}

function SharedReview({ copied, manualCopy, onCopy, reviewUrl, accessCode, reviewerEmail, expiresAt, packetId, clientName, criteriaCount, resultCount, demo }: { copied: boolean; manualCopy: boolean; onCopy: () => void; reviewUrl: string; accessCode: string; reviewerEmail: string; expiresAt: string; packetId: string; clientName: string; criteriaCount: number; resultCount: number; demo: boolean }) {
  const manualPromiseCount = criteriaCount - resultCount;
  return (
    <div className="report-grid">
      <section className="panel approval-success">
        <div className="success-mark"><Send size={27} /></div>
        <h2>{demo ? "Synthetic client walkthrough ready." : "Review packet created."}</h2>
        <p>{demo ? `This reliable presentation path shows ${clientName}’s ${criteriaCount}-criterion decision experience without creating or implying a retained transaction.` : `${clientName} gets a focused, no-account page containing only the ${criteriaCount} confirmed promises and the latest passing evidence.`}</p>
        <div className="share-box">
          <div><LockKeyhole size={13} /><span>{new URL(reviewUrl).origin.replace(/^https?:\/\//, "")}/review/{demo ? "demo" : "••••••••"}</span><small>{demo ? "Synthetic · local-only decision · not retained" : `Decision due ${formatTimestamp(new Date(expiresAt))} · one final decision`}</small></div>
          <button className="button button--outline" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
        </div>
        {manualCopy && <label className="share-manual-link">Review URL<input readOnly value={reviewUrl} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} /></label>}
        {!demo && <div className="share-access-code"><span>Separate access code</span><strong>{accessCode}</strong><small>Bound to {reviewerEmail}. Send this code separately from the review link; the link can be redeemed only once.</small></div>}
        <a className="button button--lime" href={reviewUrl} target="_blank" rel="noreferrer">Open client review in new tab <ArrowRight size={16} /></a>
        <div className="receipt-id">{demo ? "DEMO-NOT-RETAINED · NO SECURE TOKEN" : `PACKET ${packetId} · SECURE TOKEN KEPT IN URL FRAGMENT`}</div>
      </section>
      <aside className="run-side">
        <div className="panel audit-card"><h3>What the client sees</h3><div className="audit-item"><strong>{criteriaCount} acceptance promises</strong>Source-backed language, not test jargon.</div><div className="audit-item"><strong>{resultCount} automated results</strong>{manualPromiseCount === 0 ? "Every confirmed promise has an observed outcome and timestamp." : <>Observed outcome and timestamp for each; {manualPromiseCount} manual {manualPromiseCount === 1 ? "promise is" : "promises are"} clearly labeled for client judgment.</>}</div><div className="audit-item"><strong>One clear decision</strong>Approve the milestone or request changes.</div></div>
        <div className="panel evidence-body"><Bot size={19} /><strong>Trust boundary</strong><p>{demo ? "This walkthrough uses seeded outcomes and a local-only decision. The real path requires browser evidence before a retained client decision." : "The AI drafted the criteria. A human confirmed the checks. The browser produced the evidence. The client owns the decision."}</p></div>
      </aside>
    </div>
  );
}
