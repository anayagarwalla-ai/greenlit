"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  ExternalLink,
  FileCheck2,
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
  WandSparkles,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { checkTypes, isCriterionReady, isGroundedQuote, lineContainsCitation, normalizeWhitespace, type AnalysisCriterion, type CheckType } from "@/lib/analysis";
import { demoCriteria, demoMilestone, demoSowText, sowExcerpt } from "@/lib/demo";
import { formatDuration } from "@/lib/format";

type Phase = "intake" | "analyzing" | "criteria" | "handoff" | "running1" | "run1" | "running2" | "run2" | "shared";
type SourceMode = "live" | "demo";

type AnalysisResponse = {
  sourceName: string;
  sourceText: string;
  criteria: Omit<AnalysisCriterion, "id">[];
  model?: string;
  error?: string;
};

const phaseOrder: Record<Phase, number> = { intake: 1, analyzing: 1, criteria: 1, handoff: 2, running1: 2, run1: 2, running2: 2, run2: 2, shared: 3 };
const checkLabels: Record<CheckType, string> = {
  element_state: "Element state",
  link_destination: "Link destination",
  form_submission: "Form submission",
  viewport_layout: "Viewport layout",
  axe_scan: "Accessibility scan",
  manual: "Human review",
};
const fixtureCheckTypes: CheckType[] = ["element_state", "link_destination", "element_state", "form_submission", "axe_scan", "viewport_layout"];

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

function phaseStatus(phase: Phase) {
  if (phase === "intake") return { text: "Awaiting SOW", className: "status-badge--neutral" };
  if (phase === "analyzing") return { text: "Gemini analyzing", className: "status-badge--neutral" };
  if (phase === "criteria") return { text: "Needs confirmation", className: "" };
  if (phase === "handoff") return { text: "Scope frozen", className: "status-badge--pass" };
  if (phase.startsWith("running")) return { text: "Verifying", className: "status-badge--neutral" };
  if (phase === "run1") return { text: "Needs work", className: "status-badge--fail" };
  if (phase === "run2") return { text: "Ready for review", className: "status-badge--pass" };
  return { text: "In review", className: "status-badge--pass" };
}

export function MilestoneStudio() {
  const [phase, setPhase] = useState<Phase>("intake");
  const [sourceMode, setSourceMode] = useState<SourceMode>("live");
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("Pasted SOW");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [attested, setAttested] = useState(false);
  const [criteria, setCriteria] = useState<AnalysisCriterion[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [analysisError, setAnalysisError] = useState("");
  const [model, setModel] = useState("Gemini");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const currentStep = phaseOrder[phase];
  const status = phaseStatus(phase);
  const isFixtureSource = fixtureCompatible(sourceText);
  const canRunImportedFixture = fixtureCriteriaCompatible(sourceText, criteria);
  const visibleCount = sourceMode === "demo" ? demoCriteria.length : criteria.length;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const reset = () => {
    setPhase("intake");
    setSourceMode("live");
    setSourceText("");
    setSourceName("Pasted SOW");
    setSelectedFile(null);
    setAttested(false);
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setCopied(false);
    setToast("Ready for a new SOW");
  };

  const launchDemo = () => {
    setSourceMode("demo");
    setSourceText(demoSowText);
    setSourceName("Acme × Northstar — SOW.pdf");
    setCriteria([]);
    setConfirmed({});
    setAnalysisError("");
    setPhase("criteria");
    setToast("Guided demo loaded");
  };

  const analyze = async () => {
    if (!attested) {
      setAnalysisError("Confirm that this document is synthetic or non-confidential.");
      return;
    }
    if (!selectedFile && sourceText.trim().length < 80) {
      setAnalysisError("Paste at least 80 characters or choose a PDF, TXT, or Markdown file.");
      return;
    }

    setPhase("analyzing");
    setAnalysisError("");
    try {
      let response: Response;
      if (selectedFile) {
        const form = new FormData();
        form.set("file", selectedFile);
        form.set("syntheticDataAttested", "true");
        response = await fetch("/api/analyze", { method: "POST", body: form });
      } else {
        response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sourceText, sourceName, syntheticDataAttested: true }),
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
      setSourceMode("live");
      setPhase("criteria");
      setToast(`${payload.criteria.length} source-backed criteria drafted`);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Gemini could not analyze this SOW.");
      setPhase("intake");
    }
  };

  const startRun = (second = false) => {
    if (sourceMode === "demo") setConfirmed(Object.fromEntries(demoCriteria.map((item) => [item.id, true])));
    setPhase(second ? "running2" : "running1");
    window.setTimeout(() => setPhase(second ? "run2" : "run1"), 1850);
  };

  const continueFromCriteria = () => {
    if (sourceMode === "live" && !canRunImportedFixture) setPhase("handoff");
    else startRun(false);
  };

  const share = () => {
    setPhase("shared");
    setToast("Secure client review created");
  };

  const copyReview = async () => {
    const url = `${window.location.origin}/review/demo#t=mp_demo_secure_token`;
    try { await navigator.clipboard.writeText(url); } catch { /* Clipboard can be unavailable in preview. */ }
    setCopied(true);
    setToast("Review link copied");
  };

  const projectLabel = sourceMode === "demo" || isFixtureSource ? demoMilestone.project : sourceText ? sourceName : "New milestone proof";
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
          <button className="button button--small button--outline" onClick={reset}><RefreshCw size={13} /> New import</button>
          <span className="avatar" aria-label="Northstar Studio">NS</span>
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
            <button className={currentStep === 1 ? "is-active" : ""} onClick={() => sourceText && setPhase("criteria")}><FileText size={15} /><span>Acceptance criteria</span>{visibleCount > 0 && <span>{visibleCount}</span>}</button>
            <button className={currentStep === 2 ? "is-active" : ""} disabled={currentStep < 2}><ScanSearch size={15} /><span>Verification run</span>{currentStep >= 2 && phase !== "handoff" && <span>{phase === "run1" ? "5/6" : "6/6"}</span>}</button>
            <button className={currentStep === 3 ? "is-active" : ""} disabled={currentStep < 3}><Send size={15} /><span>Client review</span></button>
            <button disabled><FileCheck2 size={15} /><span>Approval record</span></button>
          </nav>
          <div className="side-facts">
            <div><span>AI</span><strong>{sourceMode === "demo" ? "Seeded fallback" : model}</strong></div>
            <div><span>Source</span><strong>{sourceText ? "In memory" : "Not loaded"}</strong></div>
            <div><span>Paid services</span><strong>None</strong></div>
          </div>
        </aside>

        <section className="app-main">
          <div className="workspace-head">
            <div className="workspace-head__title"><span>{sourceText ? sourceName : "New proof set · safe intake"}</span><h1>{workspaceTitle}</h1></div>
            <div className="workspace-head__meta">
              <span className={`status-badge ${status.className}`}>{phase === "analyzing" || phase.startsWith("running") ? <LoaderCircle className="spin" size={12} /> : <CircleDot size={11} />}{status.text}</span>
              {currentStep >= 2 && phase !== "handoff" && <span className="status-badge status-badge--neutral"><Globe2 size={11} /> Staging verified</span>}
            </div>
          </div>

          <div className="stepper" aria-label="Milestone progress">
            {["Confirm criteria", "Verify build", "Client review", "Invoice-ready"].map((label, index) => {
              const step = index + 1;
              return <div className={`step ${step < currentStep ? "is-done" : step === currentStep ? "is-active" : ""}`} key={label}>{label}</div>;
            })}
          </div>

          {(phase === "intake" || phase === "analyzing") && (
            <SowIntake
              sourceText={sourceText}
              setSourceText={setSourceText}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
              attested={attested}
              setAttested={setAttested}
              error={analysisError}
              analyzing={phase === "analyzing"}
              onAnalyze={analyze}
              onDemo={launchDemo}
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
              fixtureCompatible={canRunImportedFixture}
              onContinue={continueFromCriteria}
            />
          )}
          {phase === "handoff" && <VerificationHandoff criteria={criteria} sourceName={sourceName} onBack={() => setPhase("criteria")} onDemo={launchDemo} />}
          {(phase === "running1" || phase === "running2") && <RunLoading second={phase === "running2"} />}
          {phase === "run1" && <VerificationReport version="rc1" onRerun={() => startRun(true)} />}
          {phase === "run2" && <VerificationReport version="rc2" onShare={share} />}
          {phase === "shared" && <SharedReview copied={copied} onCopy={copyReview} />}
        </section>
      </div>
      {toast && <div className="toast" role="status"><CheckCircle2 size={16} color="var(--lime)" /> {toast}</div>}
    </main>
  );
}

function SowIntake({ sourceText, setSourceText, selectedFile, setSelectedFile, attested, setAttested, error, analyzing, onAnalyze, onDemo }: {
  sourceText: string;
  setSourceText: (value: string) => void;
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  attested: boolean;
  setAttested: (value: boolean) => void;
  error: string;
  analyzing: boolean;
  onAnalyze: () => void;
  onDemo: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const loadSample = () => {
    setSelectedFile(null);
    setSourceText(demoSowText);
    setAttested(true);
  };

  return (
    <div className="intake-grid">
      <section className="panel intake-panel">
        <div className="intake-kicker"><WandSparkles size={14} /> Gemini-powered SOW import</div>
        <h2>Turn contract language into proof-ready checks.</h2>
        <p className="intake-lede">Paste a scope or upload a selectable-text document. Gemini extracts measurable promises and cites the exact language behind each one.</p>

        <div className="source-input-head"><label htmlFor="sow-text">Paste SOW text</label><button type="button" onClick={loadSample}>Use the synthetic sample</button></div>
        <textarea id="sow-text" className="sow-textarea" value={sourceText} disabled={Boolean(selectedFile) || analyzing} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste the acceptance criteria, deliverables, or relevant SOW section here…" />
        <div className="input-divider"><span>or upload</span></div>
        <input ref={fileInput} className="sr-only" type="file" accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,.markdown" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
        <button className={`upload-drop ${selectedFile ? "has-file" : ""}`} type="button" disabled={analyzing} onClick={() => fileInput.current?.click()}>
          <span className="upload-icon"><FileUp size={20} /></span>
          <span><strong>{selectedFile ? selectedFile.name : "Choose a PDF, TXT, or Markdown file"}</strong><small>{selectedFile ? `${(selectedFile.size / 1024).toFixed(0)} KB · click to replace` : "Selectable text · 3 MB maximum"}</small></span>
          {selectedFile && <CheckCircle2 size={18} />}
        </button>
        {selectedFile && <button className="clear-file" type="button" onClick={() => setSelectedFile(null)}>Remove file and use pasted text</button>}

        <label className="attestation">
          <input type="checkbox" checked={attested} disabled={analyzing} onChange={(event) => setAttested(event.target.checked)} />
          <span><strong>This SOW is synthetic or non-confidential.</strong> I understand its text is sent to Gemini for analysis and is not written to MilestoneProof logs.</span>
        </label>

        {error && <div className="analysis-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
        <div className="intake-actions">
          <button className="button button--ink" disabled={analyzing} onClick={onAnalyze}>{analyzing ? <><LoaderCircle className="spin" size={16} /> Analyzing with Gemini…</> : <>Generate acceptance criteria <Sparkles size={15} /></>}</button>
          <span>or</span>
          <button className="text-action" disabled={analyzing} onClick={onDemo}>Launch the reliable guided demo <ArrowRight size={13} /></button>
        </div>
      </section>

      <aside className="intake-side">
        <section className="panel privacy-card"><LockKeyhole size={20} /><h3>Safe by design</h3><p>Use non-confidential scopes only. Source text is processed in memory and never included in verification logs or evidence artifacts.</p></section>
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
          <div className="source-foot"><span>Acme Outdoors / Northstar Studio</span><span>CONFIDENTIAL · DEMO DOCUMENT</span></div>
        </div>
      </section>

      <section className="panel criteria-panel">
        <div className="panel-header">
          <div><h2>6 acceptance criteria</h2><p><Sparkles size={10} /> Seeded fallback · every quote is source-matched.</p></div>
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
          <button className="button button--ink" onClick={onRun}>{allConfirmed ? "Run verified checks" : "Confirm all & run"} <ArrowRight size={16} /></button>
        </footer>
      </section>
    </div>
  );
}

function ExtractedCriteriaReview({ sourceName, sourceText, criteria, setCriteria, confirmed, setConfirmed, model, fixtureCompatible: canRunFixture, onContinue }: {
  sourceName: string;
  sourceText: string;
  criteria: AnalysisCriterion[];
  setCriteria: React.Dispatch<React.SetStateAction<AnalysisCriterion[]>>;
  confirmed: Record<string, boolean>;
  setConfirmed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  model: string;
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

  return (
    <div className="criteria-layout live-criteria-layout">
      <section className="panel source-sheet live-source" aria-label="Imported source document">
        <div className="source-title"><span className="source-icon"><FileText size={18} /></span><div><strong>{sourceName}</strong><span>Processed in memory · {sourceText.length.toLocaleString()} characters</span></div></div>
        <div className="source-proof-note"><Quote size={14} /><span>Highlighted lines are cited by Gemini. Every citation is checked against this extracted source.</span></div>
        <div className="document-page live-document">
          <div className="document-page__head"><span>Extracted source</span><span>{sourceLines.length} lines</span></div>
          {sourceLines.map((line, index) => line.trim() ? <div className={`document-line ${lineContainsCitation(line, citations) ? "is-cited" : ""}`} key={`${index}-${line.slice(0, 12)}`}><span>{index + 1}</span><div>{line}</div></div> : <div className="document-spacer" key={index} />)}
        </div>
      </section>

      <section className="panel criteria-panel live-criteria-panel">
        <div className="panel-header">
          <div><h2>{criteria.length} AI-drafted criteria</h2><p><Sparkles size={10} /> {model} drafted; {canRunFixture ? "trusted fixture mappings applied" : "human confirmation required"}.</p></div>
          <div className="panel-header__actions"><span className="status-badge status-badge--neutral">{confirmedCount}/{criteria.length} confirmed</span><button className="mini-action" onClick={confirmReady}>Confirm grounded</button></div>
        </div>
        <div className="criteria-list">
          {criteria.map((item) => {
            const ready = isCriterionReady(sourceText, item);
            return (
              <article className={`criterion-card live-criterion ${confirmed[item.id] ? "is-confirmed" : ""} ${!ready ? "has-warning" : ""}`} key={item.id}>
                <div className="criterion-card__top">
                  <span className="criterion-id">{item.id}</span>
                  <div className="criterion-edit-fields">
                    <label>Measurable outcome<input value={item.title} onChange={(event) => update(item.id, { title: event.target.value })} /></label>
                    <label>Exact source quote<textarea value={item.sourceQuote} onChange={(event) => update(item.id, { sourceQuote: event.target.value })} /></label>
                  </div>
                  <button disabled={!ready} className={`confirm-control ${confirmed[item.id] ? "is-checked" : ""}`} onClick={() => toggle(item)} aria-label={`${confirmed[item.id] ? "Unconfirm" : "Confirm"} ${item.id}`} aria-pressed={Boolean(confirmed[item.id])}>{confirmed[item.id] && <Check size={15} strokeWidth={3} />}</button>
                </div>
                <div className="criterion-metadata">
                  <label>Evidence type<select value={item.checkType} onChange={(event) => {
                    const checkType = event.target.value as CheckType;
                    update(item.id, { checkType, supported: checkType !== "manual" });
                  }}>{checkTypes.map((type) => <option value={type} key={type}>{checkLabels[type]}</option>)}</select></label>
                  <label>Evidence rationale<input value={item.rationale} onChange={(event) => update(item.id, { rationale: event.target.value })} /></label>
                </div>
                <div className="criterion-validation">
                  <span className={ready ? "is-valid" : "is-invalid"}>{ready ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{ready ? "Exact source match" : "Quote must match the source"}</span>
                  <span className={item.supported ? "is-valid" : "is-manual"}>{item.supported ? <Code2 size={12} /> : <PencilLine size={12} />}{item.supported ? "Safe browser evidence" : "Human review required"}</span>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="criteria-footer">
          <p><LockKeyhole size={11} /> Editing a criterion clears its confirmation. Ungrounded quotes cannot be frozen.</p>
          <button className="button button--ink" disabled={!allConfirmed} onClick={onContinue}>{canRunFixture ? "Run on included staging fixture" : "Continue to verification setup"} <ArrowRight size={16} /></button>
        </footer>
      </section>
    </div>
  );
}

function VerificationHandoff({ criteria, sourceName, onBack, onDemo }: { criteria: AnalysisCriterion[]; sourceName: string; onBack: () => void; onDemo: () => void }) {
  const automated = criteria.filter((item) => item.supported && item.checkType !== "manual").length;
  return (
    <div className="handoff-grid">
      <section className="panel handoff-card">
        <span className="handoff-mark"><ShieldCheck size={28} /></span>
        <div className="intake-kicker">Scope frozen · source-backed</div>
        <h2>Your acceptance contract is ready.</h2>
        <p>{criteria.length} confirmed promises from <strong>{sourceName}</strong> are ready to map to a client-owned staging target.</p>
        <div className="handoff-stats"><div><strong>{criteria.length}</strong><span>confirmed</span></div><div><strong>{automated}</strong><span>safe to automate</span></div><div><strong>{criteria.length - automated}</strong><span>human review</span></div></div>
        <div className="boundary-callout"><LockKeyhole size={16} /><div><strong>No pretend verification.</strong><p>A custom SOW needs a verified staging origin and typed check mappings before evidence can be claimed. The hackathon demo includes a safe fixture so you can see that complete workflow now.</p></div></div>
        <div className="handoff-actions"><button className="button button--lime" onClick={onDemo}>Open guided verification demo <Play size={15} /></button><button className="button button--outline" onClick={onBack}>Back to criteria</button></div>
      </section>
      <aside className="panel handoff-checklist"><h3>Production connection checklist</h3><div><CheckCircle2 size={15} /><span><strong>1. Verify origin ownership</strong>Serve MilestoneProof’s one-time token from the staging hostname.</span></div><div><CircleDot size={15} /><span><strong>2. Map typed checks</strong>Choose accessible labels, same-origin paths, and explicit assertions.</span></div><div><CircleDot size={15} /><span><strong>3. Run in isolation</strong>The Cloudflare runner captures timestamped, hashed evidence.</span></div></aside>
    </div>
  );
}

function RunLoading({ second }: { second: boolean }) {
  return (
    <section className="panel loading-panel" aria-live="polite">
      <div className="loading-content">
        <div className="scanner"><ShieldCheck size={28} /><span className="scanner-line" /></div>
        <h2>Verifying {second ? "launch-rc2" : "launch-rc1"}</h2>
        <p>Running six confirmed checks in an isolated browser…</p>
        <div className="loading-steps" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </section>
  );
}

function VerificationReport({ version, onRerun, onShare }: { version: "rc1" | "rc2"; onRerun?: () => void; onShare?: () => void }) {
  const isPass = version === "rc2";
  const passed = isPass ? 6 : 5;
  const runId = isPass ? "run_2048_rc2" : "run_2039_rc1";
  const timestamp = isPass ? "Jul 19, 10:14 PM PDT" : "Jul 19, 9:42 PM PDT";
  const totalDuration = useMemo(() => demoCriteria.reduce((sum, item) => sum + item.result.duration, 0), []);
  return (
    <>
      <div className="report-grid">
        <section>
          <div className="panel report-summary">
            <div className="score-line">
              <div className="score-ring" style={{ "--score": `${Math.round((passed / 6) * 100)}%` } as React.CSSProperties}><strong>{passed}/6</strong></div>
              <div className="score-copy"><h2>{isPass ? "Every promise has evidence." : "One promise needs work."}</h2><p>{isPass ? "This milestone is ready to send to Acme Outdoors for approval." : "The interface says success, but the underlying lead request failed."}</p></div>
            </div>
            <div className="run-meta"><div><span>Build</span><strong>launch-{version}</strong></div><div><span>Verified</span><strong>{timestamp}</strong></div><div><span>Runtime</span><strong>{formatDuration(totalDuration)}</strong></div></div>
          </div>
          <div className="panel result-list">
            <div className="panel-header"><div><h3>Acceptance evidence</h3><p>Run {runId} · Chromium 140 · MilestoneProof runner 0.1</p></div><span className={`status-badge ${isPass ? "status-badge--pass" : "status-badge--fail"}`}>{passed} passed</span></div>
            {demoCriteria.map((item) => {
              const result = item.result[version];
              const observed = version === "rc1" ? item.result.observedRc1 : item.result.observedRc2;
              return <div className={`result-row ${result === "FAIL" ? "is-fail" : ""}`} key={item.id}><span className="criterion-id">{item.id}</span><div className="result-name"><strong>{item.title}</strong><span>{item.type} · {item.path} · {formatDuration(item.result.duration)}</span></div><span className="result-observed">{observed}</span><span className={`result-icon ${result === "FAIL" ? "is-fail" : ""}`}>{result === "PASS" ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}</span></div>;
            })}
          </div>
        </section>

        <aside className="run-side">
          <div className="panel evidence-card">
            <div className="evidence-preview">
              <div className="fake-browser"><div className="fake-browser__bar"><i /><i /><i /></div><div className="fake-site-head"><span className="fake-site-logo">ACME OUTDOORS</span><span>TRIPS&nbsp;&nbsp; ABOUT&nbsp;&nbsp; CONTACT</span></div><div className="fake-site-hero"><div>Adventure,<br />made simple.<button>PLAN MY TRIP</button></div><div className="fake-site-photo" /></div><div className="fake-form"><i /><i /><i /><i /></div></div>
              {!isPass && <span className="evidence-pin">!</span>}
            </div>
            <div className="evidence-body"><strong>{isPass ? "Evidence captured" : "Failure evidence · AC-04"}</strong><p>{isPass ? "Six timestamped artifacts are attached to this immutable run." : "The visible confirmation contradicted the network response. MilestoneProof caught the false success."}</p></div>
          </div>
          <div className="panel audit-card"><h3>Run integrity</h3><div className="audit-item"><strong>Origin verified</strong>Ownership token matched the staging target.</div><div className="audit-item"><strong>Specs frozen</strong>Six human-confirmed checks, revision 3.</div><div className="audit-item"><strong>Artifacts hashed</strong>SHA-256 evidence manifest sealed.</div><div className="audit-item"><strong>No secrets recorded</strong>Form body and document text omitted from logs.</div></div>
        </aside>
      </div>
      <div className="action-banner">
        <div><h3>{isPass ? "Give the client proof, not a test report." : "A polished UI hid a broken handoff."}</h3><p>{isPass ? "Create a focused review page with the latest passing evidence." : "The fixed rc2 build is ready. Rerun the same frozen checks—no re-analysis needed."}</p></div>
        <div className="action-banner__buttons">
          {!isPass && <a className="button button--outline" href="/fixture/rc1" target="_blank" rel="noreferrer">Inspect build <ExternalLink size={14} /></a>}
          <button className="button button--lime" onClick={isPass ? onShare : onRerun}>{isPass ? <>Create client review <Send size={15} /></> : <>Verify fixed build <Play size={15} /></>}</button>
        </div>
      </div>
    </>
  );
}

function SharedReview({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <div className="report-grid">
      <section className="panel approval-success">
        <div className="success-mark"><Send size={27} /></div>
        <h2>Review packet created.</h2>
        <p>Acme Outdoors gets a clean, no-login page containing only the six confirmed promises and the latest passing evidence.</p>
        <div className="share-box">
          <div><LockKeyhole size={13} /><span>milestoneproof.app/review/••••••••</span><small>Expires in 72 hours · one decision</small></div>
          <button className="button button--outline" onClick={onCopy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
        </div>
        <Link className="button button--lime" href="/review/demo">Open as the client <ArrowRight size={16} /></Link>
        <div className="receipt-id">PACKET MP-2048 · REV 3 · RUN run_2048_rc2</div>
      </section>
      <aside className="run-side">
        <div className="panel audit-card"><h3>What the client sees</h3><div className="audit-item"><strong>Six acceptance promises</strong>Source-backed language, not test jargon.</div><div className="audit-item"><strong>Six passing results</strong>Observed outcome and timestamp for each.</div><div className="audit-item"><strong>One clear decision</strong>Approve the milestone or request changes.</div></div>
        <div className="panel evidence-body"><Bot size={19} /><strong>Trust boundary</strong><p>The AI drafted the criteria. A human confirmed the checks. The browser produced the evidence. The client owns the decision.</p></div>
      </aside>
    </div>
  );
}
