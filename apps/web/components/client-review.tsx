"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, FileCheck2, LockKeyhole, MessageSquareText, ShieldCheck, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { demoCriteria, demoMilestone, money } from "@/lib/demo";

export function ClientReview() {
  const [dialog, setDialog] = useState<"approve" | "changes" | null>(null);
  const [approved, setApproved] = useState(false);
  const [name, setName] = useState("Mara Chen");
  const [note, setNote] = useState("");
  const [decisionNotice, setDecisionNotice] = useState("");

  const submitApproval = () => {
    setDialog(null);
    setApproved(true);
    setDecisionNotice("");
    try { window.sessionStorage.setItem("milestoneproof-approved", "true"); } catch { /* optional demo persistence */ }
  };

  const submitChangeRequest = () => {
    setDialog(null);
    setDecisionNotice("Change request captured for Northstar Studio.");
  };

  return (
    <main className="review-shell">
      <header className="review-header"><Brand /><span className="review-header__secure"><LockKeyhole size={13} /> Secure client review · expires in 72h</span></header>
      <div className="review-main">
        {!approved ? (
          <>
            <div className="review-hero">
              <div><span>{demoMilestone.agency} submitted for approval</span><h1>{demoMilestone.milestone}</h1><p>{demoMilestone.project} · Evidence captured from launch-rc2</p></div>
              <div className="review-amount"><span>Milestone value</span><strong>{money.format(demoMilestone.amountMinor / 100)}</strong></div>
            </div>
            <section className="panel">
              <div className="panel-header"><div><h2>What was promised—and what we observed</h2><p>Every result below comes from the same verified staging run.</p></div><span className="seal"><Check size={15} /> ALL VERIFIED</span></div>
              <div className="review-summary"><div><span>Result</span><strong>6 of 6 passed</strong></div><div><span>Verified</span><strong>Jul 19, 10:14 PM PDT</strong></div><div><span>Build</span><strong>launch-rc2</strong></div><div><span>Source</span><strong>SOW revision 3</strong></div></div>
              <div className="review-list">
                {demoCriteria.map((item) => <article className="review-row" key={item.id}><span className="criterion-id">{item.id}</span><div><h3>{item.title}</h3><p>Expected: {item.result.expected} · Observed: {item.result.observedRc2}</p></div><span className="status-badge status-badge--pass"><CheckCircle2 size={11} /> Passed</span></article>)}
              </div>
            </section>
            <div className="review-footer">
              <p><ShieldCheck size={12} /> Your decision is timestamped and attached to this exact evidence snapshot. MilestoneProof is not a legal e-signature or payment guarantee.</p>
              <div className="review-footer__actions"><button className="button button--outline" onClick={() => { setDecisionNotice(""); setNote(""); setDialog("changes"); }}><MessageSquareText size={14} /> Request changes</button><button className="button button--lime" onClick={() => { setDecisionNotice(""); setNote(""); setDialog("approve"); }}><Check size={15} /> Approve milestone</button></div>
            </div>
          </>
        ) : (
          <section className="panel approval-success">
            <div className="success-mark"><Check size={30} strokeWidth={3} /></div>
            <span className="status-badge status-badge--pass">Decision recorded</span>
            <h2>Milestone approved.</h2>
            <p>Thanks, {name}. Northstar Studio now has an immutable, invoice-ready record tied to this exact evidence run.</p>
            <Link className="button button--lime" href="/receipt/demo">View approval record <ArrowRight size={16} /></Link>
            <div className="receipt-id">RECEIPT MP-2048-APR · SHA-256 d82c71a4…19ef</div>
          </section>
        )}
      </div>

      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDialog(null); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
            <button className="dialog-close" onClick={() => setDialog(null)} aria-label="Close dialog"><X size={17} /></button>
            <FileCheck2 size={25} />
            <h2 id="decision-title">{dialog === "approve" ? "Approve Spring launch?" : "Request changes"}</h2>
            <p>{dialog === "approve" ? "This records your approval against revision 3 and the passing launch-rc2 evidence." : "Tell Northstar Studio what still needs attention. The current evidence remains unchanged."}</p>
            <div className="form-field"><label htmlFor="reviewer-name">Your name</label><input id="reviewer-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div>
            <div className="form-field"><label htmlFor="review-note">Note {dialog === "approve" ? "(optional)" : ""}</label><textarea id="review-note" placeholder={dialog === "approve" ? "Looks ready to launch." : "Describe the requested change…"} value={note} onChange={(event) => setNote(event.target.value)} /></div>
            <div className="dialog-actions"><button className="button button--outline" onClick={() => setDialog(null)}>Cancel</button><button className={`button ${dialog === "approve" ? "button--ink" : "button--danger"}`} disabled={!name.trim() || (dialog === "changes" && !note.trim())} onClick={dialog === "approve" ? submitApproval : submitChangeRequest}>Confirm {dialog === "approve" ? "approval" : "request"}</button></div>
          </section>
        </div>
      )}
      {decisionNotice && <div className="toast" role="status"><MessageSquareText size={16} color="var(--lime)" /> {decisionNotice}</div>}
    </main>
  );
}
