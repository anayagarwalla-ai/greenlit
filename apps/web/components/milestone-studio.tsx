"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
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
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { demoCriteria, demoMilestone, money, sowExcerpt } from "@/lib/demo";
import { formatDuration } from "@/lib/format";

type Phase = "criteria" | "running1" | "run1" | "running2" | "run2" | "shared";

const phaseOrder: Record<Phase, number> = { criteria: 1, running1: 2, run1: 2, running2: 2, run2: 2, shared: 3 };

function phaseStatus(phase: Phase) {
  if (phase === "criteria") return { text: "Needs confirmation", className: "" };
  if (phase.startsWith("running")) return { text: "Verifying", className: "status-badge--neutral" };
  if (phase === "run1") return { text: "Needs work", className: "status-badge--fail" };
  if (phase === "run2") return { text: "Ready for review", className: "status-badge--pass" };
  return { text: "In review", className: "status-badge--pass" };
}

export function MilestoneStudio() {
  const [phase, setPhase] = useState<Phase>("criteria");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);
  const currentStep = phaseOrder[phase];
  const status = phaseStatus(phase);
  const confirmedCount = Object.values(confirmed).filter(Boolean).length;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const reset = () => {
    setPhase("criteria");
    setConfirmed({});
    setCopied(false);
    setToast("Demo reset to the signed SOW");
  };

  const startRun = (second = false) => {
    setConfirmed(Object.fromEntries(demoCriteria.map((item) => [item.id, true])));
    setPhase(second ? "running2" : "running1");
    window.setTimeout(() => setPhase(second ? "run2" : "run1"), 1850);
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

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <Brand inverse />
        <div className="app-topbar__right">
          <span className="demo-badge">Guided demo</span>
          <button className="button button--small button--outline" onClick={reset}><RefreshCw size={13} /> Reset</button>
          <span className="avatar" aria-label="Northstar Studio">NS</span>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-sidebar" aria-label="Milestone navigation">
          <Link className="back-link" href="/"><ArrowLeft size={13} /> Back to overview</Link>
          <div className="project-card">
            <span>Project</span>
            <strong>{demoMilestone.project}</strong>
            <small>Milestone 3 of 4</small>
          </div>
          <div className="side-label">Proof flow</div>
          <nav className="side-nav">
            <button className={phase === "criteria" ? "is-active" : ""} onClick={() => setPhase("criteria")}><FileText size={15} /><span>Acceptance criteria</span><span>6</span></button>
            <button className={currentStep === 2 ? "is-active" : ""} disabled={currentStep < 2}><ScanSearch size={15} /><span>Verification run</span>{currentStep >= 2 && <span>{phase === "run1" ? "5/6" : "6/6"}</span>}</button>
            <button className={currentStep === 3 ? "is-active" : ""} disabled={currentStep < 3}><Send size={15} /><span>Client review</span></button>
            <button disabled><FileCheck2 size={15} /><span>Approval record</span></button>
          </nav>
          <div className="side-facts">
            <div><span>Client</span><strong>{demoMilestone.client}</strong></div>
            <div><span>Milestone</span><strong>{money.format(demoMilestone.amountMinor / 100)}</strong></div>
            <div><span>Revision</span><strong>v{demoMilestone.revision}</strong></div>
          </div>
        </aside>

        <section className="app-main">
          <div className="workspace-head">
            <div className="workspace-head__title"><span>Spring launch · Revision 3</span><h1>{phase === "criteria" ? "Confirm what “done” means" : phase === "shared" ? "Client review is ready" : "Verification evidence"}</h1></div>
            <div className="workspace-head__meta">
              <span className={`status-badge ${status.className}`}>{phase.startsWith("running") ? <LoaderCircle className="spin" size={12} /> : <CircleDot size={11} />}{status.text}</span>
              <span className="status-badge status-badge--neutral"><Globe2 size={11} /> Staging verified</span>
            </div>
          </div>

          <div className="stepper" aria-label="Milestone progress">
            {["Confirm criteria", "Verify build", "Client review", "Invoice-ready"].map((label, index) => {
              const step = index + 1;
              return <div className={`step ${step < currentStep ? "is-done" : step === currentStep ? "is-active" : ""}`} key={label}>{label}</div>;
            })}
          </div>

          {phase === "criteria" && (
            <CriteriaReview confirmed={confirmed} setConfirmed={setConfirmed} confirmedCount={confirmedCount} onRun={() => startRun(false)} />
          )}
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

function CriteriaReview({ confirmed, setConfirmed, confirmedCount, onRun }: {
  confirmed: Record<string, boolean>;
  setConfirmed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  confirmedCount: number;
  onRun: () => void;
}) {
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
          <div><h2>6 acceptance criteria</h2><p><Sparkles size={10} /> AI drafted these checks. You decide what counts as done.</p></div>
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
          <p><LockKeyhole size={11} /> Checks can only use confirmed paths, accessible element labels, and typed assertions—never arbitrary scripts.</p>
          <button className="button button--ink" onClick={onRun}>{allConfirmed ? "Run verified checks" : "Confirm all & run"} <ArrowRight size={16} /></button>
        </footer>
      </section>
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
          {!isPass && <a className="button button--outline" href="https://example.com" target="_blank" rel="noreferrer">Inspect build <ExternalLink size={14} /></a>}
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
