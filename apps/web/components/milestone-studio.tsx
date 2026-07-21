"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
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
import { VerificationSetup, type CustomRunConfiguration } from "@/components/verification-setup";
import { checkTypes, isCriterionReady, isGroundedQuote, lineContainsCitation, normalizeWhitespace, type AnalysisCriterion, type CheckType } from "@/lib/analysis";
import { demoCriteria, demoSowText, seededDemoResults, sowExcerpt } from "@/lib/demo";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";

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
  record?: { public_id: string; revision: number; confirmed_criteria: Array<{ id: string; title: string; sourceQuote: string }> };
  seededDemo?: boolean;
};

type AnalysisResponse = {
  sourceName: string;
  sourceText: string;
  criteria: Omit<AnalysisCriterion, "id">[];
  model?: string;
  analysisMode?: "gemini" | "fallback";
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
const geminiPaidService = process.env.NEXT_PUBLIC_GEMINI_SERVICE_TIER === "paid";
const DRAFT_STORAGE_KEY = "milestoneproof-workspace-draft-v2";

type WorkspaceDraft = {
  version: 2;
  phase: Phase;
  sourceText: string;
  sourceName: string;
  business: BusinessDetails;
  attested: boolean;
  aiDisclosureAccepted: boolean;
  adultBusinessUseAttested: boolean;
  criteria: AnalysisCriterion[];
  confirmed: Record<string, boolean>;
  model: string;
  analysisNotice: string;
  recordId: string | null;
  latestRun: RunResponse | null;
  customRun: CustomRunConfiguration | null;
  reviewUrl: string;
  reviewPacketId: string;
};

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

export function MilestoneStudio() {
  const [phase, setPhase] = useState<Phase>("intake");
  const [sourceMode, setSourceMode] = useState<SourceMode>("live");
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("Pasted SOW");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
  const [model, setModel] = useState("Gemini");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const [lastVerificationPhase, setLastVerificationPhase] = useState<VerificationPhase | null>(null);
  const [reviewCreated, setReviewCreated] = useState(false);
  const [approvalRecorded, setApprovalRecorded] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<RunResponse | null>(null);
  const [runError, setRunError] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewUrl, setReviewUrl] = useState("");
  const [reviewPacketId, setReviewPacketId] = useState("");
  const [changeRequest, setChangeRequest] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [customRun, setCustomRun] = useState<CustomRunConfiguration | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const runController = useRef<AbortController | null>(null);
  const draftHydrated = useRef(false);
  const phaseHeading = useRef<HTMLHeadingElement | null>(null);
  const currentStep = phaseOrder[phase];
  const status = phaseStatus(phase, Boolean(sourceText.trim() || selectedFile));
  const canRunImportedFixture = fixtureCriteriaCompatible(sourceText, criteria);
  const visibleCount = sourceMode === "demo" ? demoCriteria.length : criteria.length;
  const latestPassCount = latestRun?.results.filter((result) => result.status === "PASS").length ?? 0;
  const activeRunId = latestRun?.runId;
  const activeRunStatus = latestRun?.status;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const draftRestoreTimer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        const draft = raw ? JSON.parse(raw) as WorkspaceDraft : null;
        if (draft?.version === 2) {
        setPhase(draft.phase === "analyzing" ? "intake" : draft.phase.startsWith("running") ? (draft.latestRun ? (draft.latestRun.outcome === "READY_FOR_REVIEW" ? "run2" : "run1") : "handoff") : draft.phase);
        setSourceText(draft.sourceText ?? "");
        setSourceName(draft.sourceName ?? "Pasted SOW");
        setBusiness(draft.business ?? { agencyName: "", clientName: "", projectName: "", milestoneTitle: "", amountDollars: "", currency: "USD" });
        setAttested(Boolean(draft.attested));
        setAiDisclosureAccepted(Boolean(draft.aiDisclosureAccepted));
        setAdultBusinessUseAttested(Boolean(draft.adultBusinessUseAttested));
        setCriteria(Array.isArray(draft.criteria) ? draft.criteria : []);
        setConfirmed(draft.confirmed ?? {});
        setModel(draft.model ?? "Gemini");
        setAnalysisNotice(draft.analysisNotice ?? "");
        setRecordId(draft.recordId ?? null);
        setLatestRun(draft.latestRun ?? null);
        setCustomRun(draft.customRun ?? null);
        setReviewUrl(draft.reviewUrl ?? "");
        setReviewPacketId(draft.reviewPacketId ?? "");
        if (draft.latestRun) setLastVerificationPhase(draft.latestRun.outcome === "READY_FOR_REVIEW" ? "run2" : "run1");
        }
      } catch { /* A corrupt convenience draft must never block the workspace. */ }
      draftHydrated.current = true;
    }, 0);
    void fetch("/api/account/session", { cache: "no-store" })
      .then((response) => response.json())
      .then(async (payload) => {
        setSessionEmail(payload.user?.email ?? "");
        const resumeId = new URL(window.location.href).searchParams.get("record");
        if (!payload.user?.email || !resumeId) return;
        const response = await fetch(`/api/account/records/${encodeURIComponent(resumeId)}`, { cache: "no-store" });
        const resumed = await response.json();
        if (!response.ok) throw new Error(resumed.error ?? "The retained workspace could not be restored.");
        const record = resumed.record;
        const restoredCriteria = (record.confirmed_criteria ?? []) as AnalysisCriterion[];
        const latest = resumed.runs?.[0];
        const latestReview = resumed.reviews?.[0];
        setRecordId(record.id);
        setBusiness({ agencyName: record.agency_name, clientName: record.client_name, projectName: record.project_name, milestoneTitle: record.milestone_title, amountDollars: (Number(record.amount_minor) / 100).toFixed(2), currency: record.currency });
        setSourceName(record.source_name);
        setSourceText(restoredCriteria.map((item) => item.sourceQuote).filter(Boolean).join("\n\n"));
        setCriteria(restoredCriteria.map((item) => ({ ...item, grounded: true, rationale: item.rationale ?? "Retained confirmed criterion" })));
        setConfirmed(Object.fromEntries(restoredCriteria.map((item) => [item.id, true])));
        setAttested(true); setAiDisclosureAccepted(true); setAdultBusinessUseAttested(true);
        setChangeRequest(latestReview?.decision === "CHANGES_REQUESTED" ? latestReview.reviewer_note || "The client requested changes without a note." : "");
        if (latest) {
          const run: RunResponse = { runId: latest.id, recordId: record.id, status: latest.status, outcome: latest.status === "COMPLETED" ? (record.status === "READY_FOR_REVIEW" || record.status === "IN_REVIEW" || record.status === "APPROVED" ? "READY_FOR_REVIEW" : "NEEDS_WORK") : null, buildUrl: latest.build_url, buildLabel: latest.build_label, results: latest.results ?? [], artifacts: latest.artifacts ?? [], browserVersion: latest.browser_version, runnerVersion: latest.runner_version, manifestSha256: latest.manifest_sha256, error: latest.last_error, startedAt: latest.started_at, completedAt: latest.completed_at, record: { public_id: record.public_id, revision: record.criteria_revision ?? record.revision, confirmed_criteria: restoredCriteria } };
          setLatestRun(run);
          const savedChecks = Array.isArray(latest.checks) ? latest.checks : [];
          if (savedChecks.length) setCustomRun({ targetUrl: latest.target_origin, originReceipt: "", buildLabel: latest.build_label, checks: savedChecks });
          if (["QUEUED", "LEASED", "RUNNING"].includes(latest.status)) setPhase("running1");
          else if (record.status === "READY_FOR_REVIEW" || record.status === "IN_REVIEW") { setPhase("run2"); setLastVerificationPhase("run2"); }
          else { setPhase(record.status === "CHANGES_REQUESTED" ? "criteria" : "run1"); setLastVerificationPhase("run1"); }
        } else setPhase("criteria");
        setToast("Retained project restored");
      })
      .catch(() => undefined);
    const syncApproval = () => {
      try {
        const stored = window.localStorage.getItem("milestoneproof-approved-url") ?? "";
        setReceiptUrl(stored);
        setApprovalRecorded(Boolean(stored));
      } catch { /* optional workspace convenience */ }
    };
    const approvalSyncTimer = window.setTimeout(syncApproval, 0);
    window.addEventListener("focus", syncApproval);
    window.addEventListener("storage", syncApproval);
    return () => {
      window.clearTimeout(draftRestoreTimer);
      window.clearTimeout(approvalSyncTimer);
      window.removeEventListener("focus", syncApproval);
      window.removeEventListener("storage", syncApproval);
      analysisController.current?.abort("workspace-unmounted");
      runController.current?.abort("workspace-unmounted");
    };
  }, []);

  useEffect(() => {
    if (!draftHydrated.current || sourceMode === "demo") return;
    const draft: WorkspaceDraft = { version: 2, phase, sourceText, sourceName, business, attested, aiDisclosureAccepted, adultBusinessUseAttested, criteria, confirmed, model, analysisNotice, recordId, latestRun, customRun, reviewUrl, reviewPacketId };
    try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { /* Browser storage is an optional local recovery layer. */ }
  }, [phase, sourceMode, sourceText, sourceName, business, attested, aiDisclosureAccepted, adultBusinessUseAttested, criteria, confirmed, model, analysisNotice, recordId, latestRun, customRun, reviewUrl, reviewPacketId]);

  useEffect(() => {
    if (!activeRunId || !activeRunStatus || !["QUEUED", "LEASED", "RUNNING"].includes(activeRunStatus) || runController.current) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(activeRunId)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as RunResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Verification status is unavailable.");
        setLatestRun(payload);
        if (payload.status === "COMPLETED") {
          const completedPhase: Phase = payload.outcome === "READY_FOR_REVIEW" ? "run2" : "run1";
          setPhase(completedPhase); setLastVerificationPhase(completedPhase); setRunError("");
        } else if (payload.status === "FAILED") {
          setRunError(payload.error ?? "The retained verification job failed."); setPhase("handoff");
        }
      } catch (cause) {
        if (!controller.signal.aborted) setRunError(cause instanceof Error ? cause.message : "Verification status is temporarily unavailable. This job remains saved and will resume when you reopen the project.");
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    void poll();
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [activeRunId, activeRunStatus]);

  useEffect(() => {
    if (phase === "intake") return;
    phaseHeading.current?.focus({ preventScroll: true });
  }, [phase]);

  const preserveDraft = () => {
    if (sourceMode === "demo") return;
    const draft: WorkspaceDraft = { version: 2, phase, sourceText, sourceName, business, attested, aiDisclosureAccepted, adultBusinessUseAttested, criteria, confirmed, model, analysisNotice, recordId, latestRun, customRun, reviewUrl, reviewPacketId };
    try { window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft)); } catch { /* optional */ }
  };

  const reset = () => {
    const unfinished = sourceMode === "live" && Boolean(sourceText.trim() || selectedFile || criteria.length || recordId);
    if (unfinished && !window.confirm("Start a new import? This clears the unfinished workspace from this browser.")) return;
    analysisController.current?.abort("new-import");
    analysisController.current = null;
    runController.current?.abort("new-import");
    runController.current = null;
    setPhase("intake");
    setSourceMode("live");
    setSourceText("");
    setSourceName("Pasted SOW");
    setSelectedFile(null);
    setAttested(false);
    setAiDisclosureAccepted(false);
    setAdultBusinessUseAttested(false);
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setAnalysisNotice("");
    setCopied(false);
    setLastVerificationPhase(null);
    setReviewCreated(false);
    setApprovalRecorded(false);
    setReceiptUrl("");
    setRecordId(null);
    setLatestRun(null);
    setRunError("");
    setReviewUrl("");
    setReviewPacketId("");
    setChangeRequest("");
    setCustomRun(null);
    setBusiness({ agencyName: "", clientName: "", projectName: "", milestoneTitle: "", amountDollars: "", currency: "USD" });
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      window.localStorage.removeItem("milestoneproof-approved-url");
      window.localStorage.removeItem("milestoneproof-demo-decision");
    } catch { /* optional workspace convenience */ }
    setToast("Ready for a new SOW");
  };

  const launchDemo = () => {
    runController.current?.abort("guided-demo");
    runController.current = null;
    setSourceMode("demo");
    setSourceText(demoSowText);
    setSourceName("Acme × Northstar — SOW.pdf");
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setAnalysisNotice("");
    setLastVerificationPhase(null);
    setReviewCreated(false);
    setApprovalRecorded(false);
    setReceiptUrl("");
    setRecordId(null);
    setLatestRun(null);
    setRunError("");
    setReviewUrl("");
    setReviewPacketId("");
    setCustomRun(null);
    try {
      window.localStorage.removeItem("milestoneproof-approved-url");
      window.localStorage.removeItem("milestoneproof-demo-decision");
    } catch { /* optional workspace convenience */ }
    setPhase("criteria");
    setToast("Guided demo loaded");
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
      setAnalysisError(`Enter the ${missingBusiness[0]} before Gemini analysis.`);
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
        form.set("syntheticDataAttested", "true");
        form.set("unpaidAiDisclosureAccepted", "true");
        form.set("adultBusinessUseAttested", "true");
        response = await fetch("/api/analyze", { method: "POST", body: form, signal: controller.signal });
      } else {
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sourceText, sourceName, syntheticDataAttested: true, unpaidAiDisclosureAccepted: true, adultBusinessUseAttested: true }),
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
      if (!response.ok) throw new Error(payload.error || "Gemini could not analyze this SOW.");
      setSourceText(payload.sourceText);
      setSourceName(payload.sourceName);
      const drafted = payload.criteria.map((item, index) => ({ ...item, id: `AC-${String(index + 1).padStart(2, "0")}` }));
      setCriteria(applyFixtureMappings(payload.sourceText, drafted));
      setConfirmed({});
      setModel(payload.model ?? "Gemini");
      setAnalysisNotice(payload.notice ?? "");
      setSourceMode("live");
      setPhase("criteria");
      const timing = payload.durationMs ? ` in ${(payload.durationMs / 1000).toFixed(1)}s` : "";
      setToast(payload.analysisMode === "fallback"
        ? `${payload.criteria.length} criteria drafted locally${timing}`
        : `${payload.criteria.length} Gemini criteria drafted${timing}`);
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

  const startRun = async (second = false, configuration?: CustomRunConfiguration) => {
    if (sourceMode === "demo") setConfirmed(Object.fromEntries(demoCriteria.map((item) => [item.id, true])));
    runController.current?.abort("replaced-run");
    const controller = new AbortController();
    runController.current = controller;
    setRunError("");
    setPhase(second ? "running2" : "running1");
    const frozenCriteria = sourceMode === "demo"
      ? demoCriteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.source }))
      : criteria.map((item) => ({ id: item.id, title: item.title, sourceQuote: item.sourceQuote, supported: item.supported, checkType: item.checkType }));
    const activeCustomRun = configuration ?? customRun;
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
          artifacts: [],
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
      if (!canRunImportedFixture && !activeCustomRun) throw new Error("Verify the staging origin and map the browser checks before running evidence.");
      const sourceSha256 = await browserSha256(sourceText);
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          recordId: recordId ?? undefined,
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
          ...(activeCustomRun ?? {}),
        }),
      });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error ?? "The verification run could not be created.");
      setRecordId(created.recordId);
      setLatestRun({ runId: created.runId, recordId: created.recordId, status: created.status ?? "QUEUED", buildUrl: activeCustomRun?.targetUrl ?? window.location.origin, buildLabel: activeCustomRun?.buildLabel ?? `launch-${second ? "rc2" : "rc1"}`, results: [], artifacts: [] });
      const deadline = Date.now() + 12 * 60_000;
      while (!controller.signal.aborted && Date.now() < deadline) {
        const statusResponse = await fetch(`/api/runs/${encodeURIComponent(created.runId)}`, { signal: controller.signal, cache: "no-store" });
        const statusPayload = await statusResponse.json() as RunResponse & { error?: string };
        if (!statusResponse.ok) throw new Error(statusPayload.error ?? "Verification status is unavailable.");
        if (statusPayload.status === "COMPLETED") {
          setLatestRun(statusPayload);
          const completedPhase: Phase = statusPayload.outcome === "READY_FOR_REVIEW" ? "run2" : "run1";
          setPhase(completedPhase);
          setLastVerificationPhase(completedPhase);
          setToast(`${statusPayload.results.filter((result) => result.status === "PASS").length} of ${statusPayload.results.length} checks passed`);
          return;
        }
        if (statusPayload.status === "FAILED") throw new Error(statusPayload.error ?? "The verification runner failed.");
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (!controller.signal.aborted) {
        setRunError("Verification is still running. The job is saved—leave this page or return from the dashboard without starting a duplicate run.");
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
    if (sourceMode === "live" && !canRunImportedFixture) {
      setLastVerificationPhase("handoff");
      setPhase("handoff");
    }
    else startRun(false);
  };

  const share = async () => {
    if (!latestRun) return;
    setReviewBusy(true);
    setRunError("");
    try {
      if (sourceMode === "demo") {
        const origin = window.location.origin;
        setReviewUrl(`${origin}/review/demo`);
        setReviewPacketId("DEMO-NOT-RETAINED");
        setPhase("shared");
        setReviewCreated(true);
        setToast("Synthetic client walkthrough ready");
        return;
      }
      if (!recordId) throw new Error("The retained milestone record is unavailable.");
      const response = await fetch("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId, runId: latestRun.runId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The client review could not be created.");
      setReviewUrl(payload.reviewUrl);
      setReviewPacketId(payload.packetId);
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
      setToast("Review link copied");
    } catch {
      setCopied(false);
      setToast("Clipboard unavailable — select and copy the link manually");
    }
  };

  const projectLabel = sourceText ? business.projectName : "New milestone proof";
  const workspaceTitle = phase === "intake" || phase === "analyzing"
    ? "Import the promises worth proving"
    : phase === "criteria"
      ? "Confirm what “done” means"
      : phase === "handoff"
        ? "Connect the build to verify"
        : phase === "shared"
          ? "Client review is ready"
          : "Verification evidence";

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <Brand inverse />
        <div className="app-topbar__right">
          <span className="demo-badge">{sourceMode === "demo" ? "Guided demo" : "Gemini import"}</span>
          <Link className="app-account-link" onClick={preserveDraft} href={(sessionEmail ? "/dashboard" : "/login?next=/workspace") as Route}>{sessionEmail ? "Dashboard" : "Agency sign in"}</Link>
          <button className="button button--small button--outline" onClick={reset}><RefreshCw size={13} /> New import</button>
          <span className="avatar" aria-label={sessionEmail || "Guest agency"}>{sessionEmail ? sessionEmail.slice(0, 2).toUpperCase() : "AG"}</span>
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
            <button className={currentStep === 1 ? "is-active" : ""} disabled={criteria.length === 0 && sourceMode !== "demo"} onClick={() => setPhase("criteria")}><FileText size={15} /><span>Acceptance criteria</span>{visibleCount > 0 && <span>{visibleCount}</span>}</button>
            <button className={currentStep === 2 ? "is-active" : ""} disabled={!lastVerificationPhase || phase.startsWith("running")} onClick={() => lastVerificationPhase && setPhase(lastVerificationPhase)}><ScanSearch size={15} /><span>Verification run</span>{lastVerificationPhase && latestRun && <span>{latestPassCount}/{latestRun.results.length}</span>}</button>
            <button className={currentStep === 3 ? "is-active" : ""} disabled={!reviewCreated} onClick={() => setPhase("shared")}><Send size={15} /><span>Client review</span></button>
            <button disabled={!approvalRecorded || !receiptUrl} onClick={() => receiptUrl && window.location.assign(receiptUrl)}><FileCheck2 size={15} /><span>Approval record</span></button>
          </nav>
          <div className="side-facts">
            <div><span>AI</span><strong>{sourceMode === "demo" ? "Synthetic guided demo" : model}</strong></div>
            <div><span>Source</span><strong>{sourceText ? "Local draft; server retains hash + quotes" : "Not loaded"}</strong></div>
            <div><span>Paid services</span><strong>{geminiPaidService ? "Gemini API" : "None"}</strong></div>
          </div>
        </aside>

        <section className="app-main">
          <div className="workspace-head">
            <div className="workspace-head__title"><span>{sourceText ? sourceName : "New proof set · safe intake"}</span><h1 ref={phaseHeading} tabIndex={-1}>{workspaceTitle}</h1></div>
            <div className="workspace-head__meta">
              <span className={`status-badge ${status.className}`}>{phase === "analyzing" || phase.startsWith("running") ? <LoaderCircle className="spin" size={12} /> : <CircleDot size={11} />}{status.text}</span>
              {currentStep >= 2 && phase !== "handoff" && <span className="status-badge status-badge--neutral"><Globe2 size={11} /> {sourceMode === "demo" ? "Synthetic sample" : "Staging verified"}</span>}
            </div>
          </div>

          <ol className="stepper" aria-label="Milestone progress">
            {["Confirm criteria", "Verify build", "Client review", "Invoice-ready"].map((label, index) => {
              const step = index + 1;
              return <li className={`step ${step < currentStep ? "is-done" : step === currentStep ? "is-active" : ""}`} aria-current={step === currentStep ? "step" : undefined} key={label}>{label}</li>;
            })}
          </ol>

          <div className="sr-only" aria-live="polite" aria-atomic="true">{phase === "analyzing" ? "Gemini analysis in progress" : phase.startsWith("running") ? "Verification in progress" : status.text}</div>

          {runError && <div className="analysis-error workspace-error" role="alert"><AlertTriangle size={15} /><span>{runError}</span><button className="mini-action" type="button" onClick={launchDemo}>Open synthetic walkthrough</button></div>}
          {changeRequest && <div className="analysis-notice change-request-note" role="status"><PencilLine size={15} /><div><strong>Client change request</strong><span>{changeRequest}</span></div></div>}

          {(phase === "intake" || phase === "analyzing") && (
            <SowIntake
              sourceText={sourceText}
              setSourceText={setSourceText}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
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
              onDemo={launchDemo}
              signedInEmail={sessionEmail}
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
              notice={analysisNotice}
              fixtureCompatible={canRunImportedFixture}
              onContinue={continueFromCriteria}
            />
          )}
          {phase === "handoff" && <VerificationSetup criteria={criteria} sourceName={sourceName} signedInEmail={sessionEmail} initialConfiguration={customRun} onBack={() => setPhase("criteria")} onDemo={launchDemo} onRun={(configuration) => { setCustomRun(configuration); void startRun(false, configuration); }} />}
          {(phase === "running1" || phase === "running2") && <RunLoading second={phase === "running2"} seeded={sourceMode === "demo"} />}
          {phase === "run1" && latestRun && <VerificationReport run={latestRun} criteria={sourceMode === "demo" ? demoCriteria.map((item) => ({ id: item.id, title: item.title })) : criteria} onRerun={() => sourceMode === "demo" || canRunImportedFixture ? void startRun(true) : setPhase("handoff")} />}
          {phase === "run2" && latestRun && <VerificationReport run={latestRun} criteria={sourceMode === "demo" ? demoCriteria.map((item) => ({ id: item.id, title: item.title })) : criteria} onShare={() => void share()} shareBusy={reviewBusy} />}
          {phase === "shared" && <SharedReview copied={copied} onCopy={copyReview} reviewUrl={reviewUrl} packetId={reviewPacketId} clientName={business.clientName} criteriaCount={sourceMode === "demo" ? demoCriteria.length : criteria.length} resultCount={latestRun?.results.length ?? 0} demo={sourceMode === "demo"} />}
        </section>
      </div>
      {toast && <div className="toast" role="status"><CheckCircle2 size={16} color="var(--lime)" /> {toast}</div>}
    </main>
  );
}

function SowIntake({ sourceText, setSourceText, selectedFile, setSelectedFile, attested, setAttested, aiDisclosureAccepted, setAiDisclosureAccepted, adultBusinessUseAttested, setAdultBusinessUseAttested, business, setBusiness, error, analyzing, onAnalyze, onDemo, signedInEmail }: {
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
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectedFile && fileInput.current) fileInput.current.value = "";
  }, [selectedFile]);
  const loadSample = () => {
    setSelectedFile(null);
    setSourceText(demoSowText);
    setAttested(true);
  };
  const updateBusiness = (field: keyof BusinessDetails, value: string) => setBusiness((current) => ({ ...current, [field]: value }));

  return (
    <div className="intake-grid">
      <section className="panel intake-panel">
        <div className="intake-kicker"><WandSparkles size={14} /> Gemini-powered SOW import</div>
        <h2>Turn contract language into proof-ready checks.</h2>
        <p className="intake-lede">Paste a scope or upload a selectable-text document. Gemini gets a short deadline; if it is busy, a source-grounded fallback keeps you moving.</p>

        <div className="intake-action-dock">
          {error && <div className="analysis-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
          <div className="intake-actions">
            {signedInEmail ? <button className="button button--ink" disabled={analyzing} onClick={onAnalyze}>{analyzing ? <><LoaderCircle className="spin" size={16} /> Drafting criteria…</> : <>Generate acceptance criteria <Sparkles size={15} /></>}</button> : <Link className="button button--ink" href={"/login?next=/workspace" as Route}><LockKeyhole size={15} /> Sign in to analyze</Link>}
            <span>or</span>
            <button className="text-action" disabled={analyzing} onClick={onDemo}>Launch the reliable guided demo <ArrowRight size={13} /></button>
          </div>
        </div>

        <div className="source-input-head"><label htmlFor="sow-text">Paste SOW text</label><button type="button" onClick={loadSample}>Use the synthetic sample</button></div>
        <textarea id="sow-text" className="sow-textarea" value={sourceText} disabled={Boolean(selectedFile) || analyzing} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste the acceptance criteria, deliverables, or relevant SOW section here…" />
        <div className="input-divider"><span>or upload</span></div>
        <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" aria-label="Upload a PDF, TXT, or Markdown file" accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
        <button className={`upload-drop ${selectedFile ? "has-file" : ""}`} type="button" disabled={analyzing} onClick={() => fileInput.current?.click()}>
          <span className="upload-icon"><FileUp size={20} /></span>
          <span><strong>{selectedFile ? selectedFile.name : "Choose a PDF, TXT, or Markdown file"}</strong><small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : "Selectable text · 3 MB maximum"}</small></span>
          {selectedFile && <CheckCircle2 size={18} />}
        </button>
        {selectedFile && <button className="clear-file" type="button" onClick={() => setSelectedFile(null)}>Remove file and use pasted text</button>}

        <fieldset className="business-details" disabled={analyzing}>
          <legend>Business record details</legend>
          <label htmlFor="agency-name">Agency or vendor<input id="agency-name" aria-invalid={Boolean(error && !business.agencyName.trim())} aria-describedby={error && !business.agencyName.trim() ? "agency-name-error" : undefined} value={business.agencyName} onChange={(event) => updateBusiness("agencyName", event.target.value)} required />{error && !business.agencyName.trim() && <small id="agency-name-error">Agency or vendor is required.</small>}</label>
          <label htmlFor="client-name">Client<input id="client-name" aria-invalid={Boolean(error && !business.clientName.trim())} aria-describedby={error && !business.clientName.trim() ? "client-name-error" : undefined} value={business.clientName} onChange={(event) => updateBusiness("clientName", event.target.value)} required />{error && !business.clientName.trim() && <small id="client-name-error">Client is required.</small>}</label>
          <label htmlFor="project-name">Project<input id="project-name" aria-invalid={Boolean(error && !business.projectName.trim())} aria-describedby={error && !business.projectName.trim() ? "project-name-error" : undefined} value={business.projectName} onChange={(event) => updateBusiness("projectName", event.target.value)} required />{error && !business.projectName.trim() && <small id="project-name-error">Project is required.</small>}</label>
          <label htmlFor="milestone-title">Milestone<input id="milestone-title" aria-invalid={Boolean(error && !business.milestoneTitle.trim())} aria-describedby={error && !business.milestoneTitle.trim() ? "milestone-title-error" : undefined} value={business.milestoneTitle} onChange={(event) => updateBusiness("milestoneTitle", event.target.value)} required />{error && !business.milestoneTitle.trim() && <small id="milestone-title-error">Milestone is required.</small>}</label>
          <label htmlFor="milestone-value">Milestone value<input id="milestone-value" type="number" min="0" step="0.01" aria-invalid={Boolean(error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()))} aria-describedby={error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()) ? "milestone-value-error" : undefined} value={business.amountDollars} onChange={(event) => updateBusiness("amountDollars", event.target.value)} required />{error && !/^\d+(\.\d{1,2})?$/.test(business.amountDollars.trim()) && <small id="milestone-value-error">Enter a non-negative value with at most two decimal places.</small>}</label>
          <label htmlFor="milestone-currency">Currency<select id="milestone-currency" value={business.currency} onChange={(event) => updateBusiness("currency", event.target.value)}><option value="USD">USD</option><option value="CAD">CAD</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></label>
        </fieldset>

        <label className="attestation">
          <input type="checkbox" checked={attested} disabled={analyzing} onChange={(event) => setAttested(event.target.checked)} />
          <span><strong>This SOW is synthetic or non-confidential.</strong> I will not submit personal, sensitive, regulated, or client-confidential information.</span>
        </label>
        <label className="attestation">
          <input type="checkbox" checked={aiDisclosureAccepted} disabled={analyzing} onChange={(event) => setAiDisclosureAccepted(event.target.checked)} />
          <span>{geminiPaidService ? <><strong>I acknowledge Gemini processing under the paid-service terms.</strong> Google states paid-service prompts and responses are not used to improve its products. I still will not submit secrets, regulated data, or material I am not authorized to process.</> : <><strong>I accept the Gemini unpaid-tier data notice.</strong> Google may use submitted content and responses to improve its products, and human reviewers may process it.</>} <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Provider terms</a></span>
        </label>
        <label className="attestation">
          <input type="checkbox" checked={adultBusinessUseAttested} disabled={analyzing} onChange={(event) => setAdultBusinessUseAttested(event.target.checked)} />
          <span><strong>I am 18+, acting for a business, and accept the beta terms.</strong> I agree to the <Link href="/terms" target="_blank">Terms</Link>, <Link href="/privacy" target="_blank">Privacy Notice</Link>, and <Link href="/records" target="_blank">recordkeeping notice</Link>. {!geminiPaidService && "The unpaid Gemini flow is a U.S.-only beta; restricted regions use the local fallback."}</span>
        </label>

      </section>

      <aside className="intake-side">
        <section className="panel privacy-card"><LockKeyhole size={20} /><h3>Safe by design</h3><p>Use non-confidential scopes only. Source text is excluded from server records and evidence artifacts; an unfinished copy stays in this browser so sign-in and reload do not erase your work.</p></section>
        <section className="panel trust-card">
          <span className="trust-card__number">01</span><strong>Gemini drafts</strong><p>Atomic outcomes, exact quotes, and an evidence strategy.</p>
          <span className="trust-card__number">02</span><strong>You confirm</strong><p>Edit every claim and freeze only what both sides actually agreed.</p>
          <span className="trust-card__number">03</span><strong>The browser proves</strong><p>Typed, allowlisted checks produce timestamped evidence—never arbitrary AI code.</p>
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
        <div className="source-title"><span className="source-icon"><FileText size={18} /></span><div><strong>Acme × Northstar — SOW.pdf</strong><span>Selected page 4 · source hash 3f45b1d8…a209</span></div></div>
        <div className="document-page">
          <div className="document-page__head"><span>Statement of work</span><span>Page 4 / 7</span></div>
          {sowExcerpt.map((line, index) => <div className={`document-line ${index > 0 ? "is-cited" : ""}`} key={line.line}><span>{line.line}</span><div>{line.text}</div></div>)}
          <div className="source-foot"><span>Acme Outdoors / Northstar Studio</span><span>SYNTHETIC DEMO · NOT CONFIDENTIAL</span></div>
        </div>
      </section>

      <section className="panel criteria-panel">
        <div className="panel-header">
          <div><h2>6 acceptance criteria</h2><p><Sparkles size={10} /> Synthetic guided demo · every quote is source-matched.</p></div>
          <span className="status-badge status-badge--neutral">{confirmedCount}/6 confirmed</span>
        </div>
        <div className="criteria-list">
          {demoCriteria.map((item) => (
            <article className={`criterion-card ${confirmed[item.id] ? "is-confirmed" : ""}`} key={item.id}>
              <div className="criterion-card__top">
                <span className="criterion-id">{item.id}</span>
                <div><h3>{item.title}</h3><p>“{item.source}”</p></div>
                <button className={`confirm-control ${confirmed[item.id] ? "is-checked" : ""}`} onClick={() => toggle(item.id)} aria-label={`${confirmed[item.id] ? "Unconfirm" : "Confirm"} ${item.id}`} aria-pressed={Boolean(confirmed[item.id])}>{confirmed[item.id] && <Check size={15} strokeWidth={3} />}</button>
              </div>
              <div className="criterion-check"><Code2 size={12} /><span><strong>{item.type} check · {item.path}</strong><br />{item.check}</span><span className="criterion-type">Safe typed check</span></div>
            </article>
          ))}
        </div>
        <footer className="criteria-footer">
          <p><LockKeyhole size={11} /> The guided path uses a synthetic SOW and an isolated staging fixture.</p>
          <button className="button button--ink" onClick={onRun}>{allConfirmed ? "Show sample check run" : "Confirm all & show sample"} <ArrowRight size={16} /></button>
        </footer>
      </section>
    </div>
  );
}

function ExtractedCriteriaReview({ sourceName, sourceText, criteria, setCriteria, confirmed, setConfirmed, model, notice, fixtureCompatible: canRunFixture, onContinue }: {
  sourceName: string;
  sourceText: string;
  criteria: AnalysisCriterion[];
  setCriteria: React.Dispatch<React.SetStateAction<AnalysisCriterion[]>>;
  confirmed: Record<string, boolean>;
  setConfirmed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  model: string;
  notice: string;
  fixtureCompatible: boolean;
  onContinue: () => void;
}) {
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

  return (
    <div className="criteria-layout live-criteria-layout">
      <section className="panel source-sheet live-source" aria-label="Imported source document">
        <div className="source-title"><span className="source-icon"><FileText size={18} /></span><div><strong>{sourceName}</strong><span>Processed in memory · {sourceText.length.toLocaleString()} characters</span></div></div>
        <div className="source-proof-note"><Quote size={14} /><span>Highlighted lines are cited by the draft. Every citation is checked against this extracted source.</span></div>
        <div className="document-page live-document" tabIndex={0} aria-label="Scrollable extracted source document">
          <div className="document-page__head"><span>Extracted source</span><span>{sourceLines.length} lines</span></div>
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
        {notice && <div className="analysis-notice"><RefreshCw size={15} /><div><strong>Fast fallback used</strong><span>{notice}</span></div></div>}
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
                  <button disabled={!ready} className={`confirm-control ${confirmed[item.id] ? "is-checked" : ""}`} onClick={() => toggle(item)} aria-label={`${confirmed[item.id] ? "Unconfirm" : "Confirm"} ${item.id}`} aria-pressed={Boolean(confirmed[item.id])}>{confirmed[item.id] && <Check size={15} strokeWidth={3} />}</button>
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

function VerificationReport({ run, criteria, onRerun, onShare, shareBusy = false }: { run: RunResponse; criteria: Array<{ id: string; title: string; supported?: boolean; checkType?: CheckType }>; onRerun?: () => void; onShare?: () => void; shareBusy?: boolean }) {
  const isPass = run.outcome === "READY_FOR_REVIEW";
  const passed = run.results.filter((result) => result.status === "PASS").length;
  const totalDuration = run.results.reduce((sum, result) => sum + result.durationMs, 0);
  const failed = run.results.length - passed;
  const manualCount = criteria.filter((item) => !run.results.some((result) => result.criterionId === item.id)).length;
  const caughtFalseSuccess = run.results.some((result) => result.criterionId === "AC-04" && result.status === "FAIL" && /HTTP 500/.test(result.observed));
  const resultByCriterion = Object.fromEntries(run.results.map((result) => [result.criterionId, result]));
  const evidence = (caughtFalseSuccess ? run.artifacts.find((artifact) => artifact.url && artifact.criterionId === "AC-04") : null)
    ?? run.artifacts.find((artifact) => artifact.url && (!isPass ? resultByCriterion[artifact.criterionId]?.status !== "PASS" : true))
    ?? run.artifacts.find((artifact) => artifact.url);
  const completedAt = run.completedAt ? formatTimestamp(new Date(run.completedAt)) : "Just now";
  return (
    <>
      <div className="report-grid">
        <section>
          <div className="panel report-summary">
            {run.seededDemo && <div className="analysis-notice"><AlertTriangle size={15} /><div><strong>Synthetic walkthrough — not retained evidence</strong><span>These seeded outcomes illustrate the workflow. No browser session, evidence artifact, audit event, or legal transaction record was created.</span></div></div>}
            <div className="score-line">
              <div className="score-ring" style={{ "--score": `${Math.round((passed / run.results.length) * 100)}%` } as React.CSSProperties}><strong>{passed}/{run.results.length}</strong></div>
              <div className="score-copy"><h2>{run.seededDemo ? isPass ? "Sample: every automated check passes." : failed === 1 ? "Sample: one automated check needs work." : `Sample: ${failed} automated checks need work.` : isPass ? manualCount ? "Automated checks pass; client judgment remains." : "Every promise has browser evidence." : failed === 1 ? "One automated check needs work." : `${failed} automated checks need work.`}</h2><p>{run.seededDemo ? isPass ? "This seeded outcome opens the client-decision walkthrough without claiming real evidence." : caughtFalseSuccess ? "The sample illustrates a polished success message contradicting an HTTP 500 response." : "The sample illustrates how unmet criteria appear." : isPass ? manualCount ? `${run.results.length} automated checks passed; ${manualCount} manual ${manualCount === 1 ? "promise awaits" : "promises await"} the client’s judgment.` : "This milestone has a passing browser-evidence run and is ready for client review." : caughtFalseSuccess ? "The interface says success, but the underlying lead request failed." : "The browser evidence found checks that did not meet the frozen scope."}</p></div>
            </div>
            <div className="run-meta"><div><span>Build</span><strong>{run.buildLabel}</strong></div><div><span>Verified</span><strong>{completedAt}</strong></div><div><span>Runtime</span><strong>{formatDuration(totalDuration)}</strong></div></div>
          </div>
          <div className="panel result-list">
            <div className="panel-header"><div><h3>{run.seededDemo ? "Sample acceptance outcomes" : "Acceptance evidence"}</h3><p>Run {run.runId.slice(0, 13)}… · {run.browserVersion ?? "Chromium"} · runner {run.runnerVersion ?? "0.2"}</p></div><span className={`status-badge ${isPass ? "status-badge--pass" : "status-badge--fail"}`}>{passed} passed</span></div>
            {criteria.map((item) => {
              const result = resultByCriterion[item.id];
              const manual = !result && (item.supported === false || item.checkType === "manual");
              const resultPassed = result?.status === "PASS";
              return <div className={`result-row ${!resultPassed && !manual ? "is-fail" : ""} ${manual ? "is-manual" : ""}`} key={item.id}><span className="criterion-id">{item.id}</span><div className="result-name"><strong>{item.title}</strong><span>{manual ? "Expected: client judgment on the confirmed promise" : `Expected: ${result?.expected ?? "Recorded check"} · ${formatDuration(result?.durationMs ?? 0)}`}</span></div><span className="result-observed">{manual ? "Reserved for client review" : result?.observed ?? "No result returned"}</span><span className={`result-icon ${!resultPassed && !manual ? "is-fail" : ""} ${manual ? "is-manual" : ""}`}>{manual ? <PencilLine size={13} /> : resultPassed ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}</span></div>;
            })}
          </div>
        </section>

        <aside className="run-side">
          <div className="panel evidence-card">
            <div className="evidence-preview">
              {evidence?.url ? <Image unoptimized width={1280} height={720} src={evidence.url} alt={`Browser evidence for ${evidence.criterionId}`} /> : <div className="evidence-unavailable"><FileWarning size={28} /><strong>Evidence unavailable</strong><span>No captured screenshot was attached to this check.</span></div>}
              {!isPass && <span className="evidence-pin">!</span>}
            </div>
            <div className="evidence-body"><strong>{run.seededDemo ? "Illustrative walkthrough frame" : isPass ? "Evidence captured" : `Failure evidence · ${evidence?.criterionId ?? "check"}`}</strong><p>{run.seededDemo ? "This visual and its outcomes are synthetic examples, not captured browser evidence." : isPass ? `${run.artifacts.length} timestamped screenshots are attached to this retained run.` : caughtFalseSuccess ? "The visible confirmation contradicted the network response. MilestoneProof caught the false success." : "The observed browser evidence did not satisfy this frozen check."}</p></div>
          </div>
          <div className="panel audit-card"><h3>{run.seededDemo ? "Walkthrough boundary" : "Run integrity"}</h3><div className="audit-item"><strong>{run.seededDemo ? "Seeded outcomes" : "Target constrained"}</strong>{run.seededDemo ? "Reliable presentation path when free runner capacity is unavailable." : `The runner was constrained to the owner-verified origin ${new URL(run.buildUrl).origin}.`}</div><div className="audit-item"><strong>Specs frozen</strong>{criteria.length} human-confirmed checks, revision {run.record?.revision ?? 1}.</div><div className="audit-item"><strong>{run.seededDemo ? "No evidence claim" : "Artifacts hashed"}</strong>{run.seededDemo ? "No screenshots, hashes, audit events, or approvals are persisted." : `SHA-256 manifest ${run.manifestSha256?.slice(0, 12) ?? "pending"}…`}</div><div className="audit-item"><strong>Source minimized</strong>{run.seededDemo ? "Only the included synthetic SOW is displayed." : "Only a source hash and confirmed criteria enter the record."}</div></div>
        </aside>
      </div>
      <div className="action-banner">
        <div><h3>{run.seededDemo ? isPass ? "Continue the sample client journey." : "A polished UI can hide a broken handoff." : isPass ? "Give the client proof, not a test report." : caughtFalseSuccess ? "A polished UI hid a broken handoff." : "The evidence needs another build."}</h3><p>{run.seededDemo ? isPass ? "Open a local-only sample review that creates no transaction record." : "Show the fixed rc2 sample against the same frozen promises." : isPass ? "Create a focused review page with the latest passing evidence." : "The fixed rc2 build is ready. Rerun the same frozen checks—no re-analysis needed."}</p></div>
        <div className="action-banner__buttons">
          {!isPass && <a className="button button--outline" href={run.buildUrl} target="_blank" rel="noreferrer">Inspect build <ExternalLink size={14} /></a>}
          <button className="button button--lime" disabled={shareBusy} onClick={isPass ? onShare : onRerun}>{isPass ? <>{shareBusy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{shareBusy ? "Creating secure review…" : "Create client review"}</> : <>Verify fixed build <Play size={15} /></>}</button>
        </div>
      </div>
    </>
  );
}

function SharedReview({ copied, onCopy, reviewUrl, packetId, clientName, criteriaCount, resultCount, demo }: { copied: boolean; onCopy: () => void; reviewUrl: string; packetId: string; clientName: string; criteriaCount: number; resultCount: number; demo: boolean }) {
  return (
    <div className="report-grid">
      <section className="panel approval-success">
        <div className="success-mark"><Send size={27} /></div>
        <h2>{demo ? "Synthetic client walkthrough ready." : "Review packet created."}</h2>
        <p>{demo ? `This reliable presentation path shows ${clientName}’s ${criteriaCount}-criterion decision experience without creating or implying a retained transaction.` : `${clientName} gets a focused, no-account page containing only the ${criteriaCount} confirmed promises and the latest passing evidence.`}</p>
        <div className="share-box">
          <div><LockKeyhole size={13} /><span>{new URL(reviewUrl).origin.replace(/^https?:\/\//, "")}/review/{demo ? "demo" : "••••••••"}</span><small>{demo ? "Synthetic · local-only decision · not retained" : "Expires in 72 hours · one final decision"}</small></div>
          <button className="button button--outline" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
        </div>
        <a className="button button--lime" href={reviewUrl}>Open as the client <ArrowRight size={16} /></a>
        <div className="receipt-id">{demo ? "DEMO-NOT-RETAINED · NO SECURE TOKEN" : `PACKET ${packetId} · SECURE TOKEN KEPT IN URL FRAGMENT`}</div>
      </section>
      <aside className="run-side">
        <div className="panel audit-card"><h3>What the client sees</h3><div className="audit-item"><strong>{criteriaCount} acceptance promises</strong>Source-backed language, not test jargon.</div><div className="audit-item"><strong>{resultCount} automated results</strong>Observed outcome and timestamp for each; {criteriaCount - resultCount} manual {criteriaCount - resultCount === 1 ? "promise is" : "promises are"} clearly labeled for client judgment.</div><div className="audit-item"><strong>One clear decision</strong>Approve the milestone or request changes.</div></div>
        <div className="panel evidence-body"><Bot size={19} /><strong>Trust boundary</strong><p>{demo ? "This walkthrough uses seeded outcomes and a local-only decision. The real path requires browser evidence before a retained client decision." : "The AI drafted the criteria. A human confirmed the checks. The browser produced the evidence. The client owns the decision."}</p></div>
      </aside>
    </div>
  );
}
