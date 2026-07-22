# Greenlit release-blocker audit

Date: 2026-07-22
Production: `https://greenlitproof.vercel.app`
Audited web commit: `cfff7878cb43`
Database migration: `202607220001`
Runner: `0.7.1`

## Resolution

All seven blockers below, plus the demo hydration warning, were corrected in
the release following this audit. The remediation is anchored by database
migration `202607220002` and includes:

- one shared record-first lock order for legal holds and retention staging;
- normalized exact email equality for privacy exports;
- an audited retry path for recoverable Stripe customer-selection failures;
- truthful local/server draft-save states and signed-in conflict timestamps;
- hash-verified file or pasted-text source reattachment;
- idempotent redispatch of durable `QUEUED` runner jobs;
- invite-row locking inside durable run, review, receipt, decision, and invoice
  admission paths; and
- deterministic client-only demo timestamps that no longer mismatch hydration.

The fresh migration passed both PostgreSQL functional suites and explicit
two-session races in both directions for hold versus deletion and offboarding
versus run admission. The application passed typecheck, lint, all 123 unit
tests, the 38-route production build, and 46 desktop/mobile browser tests (two
operator-credential production smoke cases intentionally remained gated).

The original outcome and reproductions are retained below as the historical
record of what the pre-fix commit did.

## Outcome

Do not begin an external agency beta yet. This focused pass found seven reproducible release blockers: one critical legal-evidence deletion race and six high-severity data-loss, privacy, billing, authorization, or run-reliability failures.

The public UI, signed-out intake, mobile layouts, review modal behavior, expired sign-in message, and invalid review/receipt states passed the inspected paths. The findings below are not speculative design suggestions; each is tied to a deterministic code path, a browser reproduction, or a fresh PostgreSQL concurrency/state reproduction.

## Confirmed blockers

### 1. Critical — an accepted legal hold can still lose evidence bytes

`set_privacy_legal_hold_atomic` checks whether deletion is pending without locking the record or artifact (`supabase/migrations/202607220001_beta_blocker_fixes.sql:179-184`). Deletion staging locks and marks the same rows in a separate transaction. In a two-session PostgreSQL reproduction, deletion staging began first, the legal-hold request began while staging was uncommitted, and both calls succeeded. The final state had an active legal hold and `PENDING` deletion.

The retention route then removes private Storage objects before the final database recheck (`apps/web/app/api/internal/retention/route.ts:39-59` and `:63-77`). The finalizer can refuse the database deletion after the object bytes have already gone. This violates the product's core evidence-retention promise.

Required correction: serialize hold placement and deletion staging on the same locked record, and atomically recheck the hold immediately before any Storage removal.

### 2. High — privacy exports can include another person's data

The verified privacy-request email is passed directly to seven PostgREST `.ilike(...)` filters (`apps/web/app/api/admin/privacy-export/[requestId]/route.ts:42-56`). `%` and `_` are legal email local-part characters and SQL pattern wildcards. Fresh database checks confirmed that `johnXdoe@example.com ILIKE john_doe@example.com` and `sales1@example.com ILIKE sales%@example.com` are true.

A request for an underscore/percent address can therefore export nearby subjects' reviewer notes, billing details, invoice URLs, feedback, or privacy-request data.

Required correction: use normalized exact equality for email identity matching, never a pattern operator.

### 3. High — a recoverable Stripe failure permanently traps invoicing

When more than one Stripe customer uses the billing email, processing fails with an instruction to select the correct customer (`apps/web/lib/stripe-invoicing.ts:67-69`). Saving that selected customer changes the invoice-plan hash, but `save_invoice_plan_atomic` rejects every changed plan after any invoice job exists (`supabase/migrations/202607220001_beta_blocker_fixes.sql:130-133`). There is no cancel, resolve, or replace path.

A fresh state-machine reproduction reached the exact dead end: approved record → plan without a customer ID → failed job → corrected plan with a customer ID → database rejection. Stale or deleted selected-customer failures can hit the same trap.

Required correction: permit a controlled correction while a job is `FAILED` and no remote invoice exists, or add an explicit audited cancel-and-replace workflow.

### 4. High — “Saved” signed-in edits can be discarded on resume

The workspace marks the UI `Saved` after only the localStorage write (`apps/web/components/milestone-studio.tsx:512-529`); the retained server PATCH starts later and is aborted on unload (`:542-564`). Dashboard/sign-in navigation preserves only the local copy (`:602-620`), and the visible Retry action also retries only localStorage.

The intended conflict resolution cannot recover those edits: `saveProjectDraft` writes a comparison timestamp only for anonymous drafts (`apps/web/lib/client-storage.ts:92-100`), while signed-in restore requires that timestamp before preferring the local draft (`apps/web/components/milestone-studio.tsx:423-430`). For signed-in drafts, `preferLocal` is therefore always false. A fast navigation or failed PATCH can show `Saved` and later replace the newer criteria/mappings with the older server snapshot.

Required correction: give local and server saves separate truthful states, write signed-in timestamps, and make account navigation await/flush a durable server save.

### 5. High — pasted SOW projects cannot restore their full source

Retained server snapshots intentionally omit the full source (`apps/web/components/milestone-studio.tsx:549`). After local state is gone, resume reconstructs only the cited quotes (`:440-444`). Normal sign-out clears account-local drafts (`apps/web/lib/client-storage.ts:200-218`). The reattach UI and API accept only a file (`apps/web/components/milestone-studio.tsx:1368-1384`; `apps/web/app/api/account/records/[recordId]/source-reattach/route.ts:18-24`).

A project originally created by pasting text therefore has no supported paste-based reattachment path after sign-out or on another device. Uncited context disappears and can block a change-request revision.

Required correction: add a paste reattachment path that extracts text and verifies the exact frozen source hash before restoring it locally.

### 6. High — a committed run can be stranded without ever reaching the runner

`/api/runs` commits a `QUEUED` job before the external runner dispatch (`apps/web/app/api/runs/route.ts:140-180`). If the serverless process terminates or is redeployed in that gap, the durable job exists but no queue message does. A same-key retry returns the existing `QUEUED` job without dispatch (`:68-76`), and a new-key retry on the record also returns the active job (`:130-132`).

The UI then polls a job that cannot advance. Automatic stale-job recovery runs only in the daily retention cron (`vercel.json`), so a tester can be wedged for up to a day and consume part of the three-run shared daily capacity.

Required correction: use a transactional outbox/dispatcher, or safely re-dispatch idempotent `QUEUED` jobs while recording dispatch-attempt state.

### 7. High — emergency account removal can admit new work after removal

Admission is checked in the web route before durable work is created. If a request passes that check, and an operator removes the beta account while the request is still running, `manage_beta_invite_atomic` cancels only jobs and links that already exist. The in-flight request can then call `queue_verification_job_idempotent_atomic`, `create_review_packet_atomic`, or `mint_receipt_session_atomic`; those RPCs do not recheck and lock the active invite at commit time.

A fresh database sequence confirmed that `owner_beta_active` was false after removal and the queue RPC still created a new `QUEUED` job. Runner lease and completion also do not require the owner to remain active. This defeats removal as an emergency control for a compromised or abusive tester.

Required correction: enforce and lock active-beta membership inside every durable admission RPC, using the same invite-row serialization as removal.

## Browser inspection steps

1. Landing page, desktop — primary CTA, agency sign-in, guided demo, and legal links rendered and navigated correctly. Screenshot: `01-landing-desktop.png`.
2. Signed-out real intake, desktop — business fields started blank, later phases stayed disabled, and the local draft reached a saved state. Screenshot: `02-signed-out-intake.png`.
3. Landing page at 320 × 568 — no horizontal overflow; agency sign-in and workspace CTA remained available. Screenshot: `03-landing-mobile-320.png`.
4. Guided workspace at 320 × 568 — source context and criteria remained visible without horizontal overflow. Screenshot: `04-workspace-mobile-320.png`.
5. Client review at 320 × 568 — supporting quotes and observed verification values remained present. Screenshot: `05-client-review-mobile-320.png`.
6. Approval modal at 320 × 568 — internal scrolling worked; initial focus, Escape close, and focus restoration passed; feedback did not cover the action. Screenshot: `06-client-decision-modal-mobile-320.png`.
7. Approval receipt at 320 × 568 — receipt and Print / Save as PDF control rendered without horizontal overflow. Screenshot: `07-receipt-mobile-320.png`.
8. Expired sign-in link, desktop — explicit error was shown beside the email field. Screenshot: `08-login-expired-desktop.png`.
9. Invalid client-review URL, desktop — generic unavailable state appeared without leaking record existence or details. Screenshot: `09-review-invalid-desktop.png`.
10. Invalid receipt URL, desktop — generic unavailable state appeared without leaking record existence or details. Screenshot: `10-receipt-invalid-desktop.png`.

## Confirmed but not classified as a blocker

Fresh production navigation to `/review/demo` and `/receipt/demo` produced React hydration error 418 in browser logs. Both pages recovered visually. The cause is dynamic `new Date()` / `Date.now()` values inside demo-only initial render functions (`apps/web/components/client-review.tsx:39-69`; `apps/web/components/approval-receipt.tsx:33-68`). Retained review/receipt pages begin with a stable null/loading state, so evidence does not show this affecting real transactions. Fix it, but do not confuse it with the seven rollout blockers.

## Evidence limits

This was a read-only audit. It did not create another retained production transaction, submit a client decision, send a live Stripe invoice, change an invitation, or execute a real privacy deletion/hold. Authenticated retained-record mutations and live Stripe delivery were deliberately excluded. The state-machine findings were corroborated against the current migration in disposable PostgreSQL; public and demo flows were checked against the deployed production build.
