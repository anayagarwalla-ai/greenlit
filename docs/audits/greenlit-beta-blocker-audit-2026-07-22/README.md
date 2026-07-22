# Greenlit beta-blocker audit

Date: 2026-07-22
Audited commit: `9464adb09608` (`main` = `origin/main`)
Mode: read-only product, browser, state-machine, security, billing, and retention review

## Verdict

Do not open the beta to external agencies until the seven release blockers below are fixed. The normal guided path is visually healthy, responsive, keyboard-usable, and internally consistent, but the failure paths include a wrong-recipient invoice, duplicate retained verification records, an internal-network boundary bypass, legal-hold/retention failures, and a privacy-export disclosure.

No application code or production data was changed during this audit.

## Confirmed release blockers

### 1. A manual Stripe invoice can go to the old/wrong recipient

Severity: Critical

Reproduction:

1. Save a manual invoice plan for billing contact A before client review.
2. The client approves the milestone.
3. Edit the approved invoice details to billing contact B.
4. The UI saves and confirms B, then calls the manual invoice endpoint.
5. `queue_approved_invoice_job_atomic` selects the invoice plan frozen in the earlier review snapshot whenever that snapshot has `invoicePlan.enabled=true`, so the queued job still contains A.

Evidence:

- `apps/web/components/invoice-plan-card.tsx:103-158`
- `supabase/migrations/202607210005_stripe_invoicing.sql:137-166`

Impact: Greenlit can display B in its final confirmation while Stripe uses A. A failed-job retry also reuses the old job plan without refreshing it.

### 2. Verification creation is not idempotent across a lost/error response

Severity: Critical

Reproduction:

1. Start the first retained verification for a new project.
2. The server commits the record and job through `queue_verification_job_atomic`.
3. Runner dispatch fails, times out, or the HTTP response is lost after the commit.
4. The API returns an error without the committed `recordId`/`jobId`; the browser never stores them.
5. Retry submits `recordId: undefined` and creates another retained record/job while also consuming more beta capacity.

Evidence:

- `apps/web/app/api/runs/route.ts:132-165`
- `apps/web/components/milestone-studio.tsx:803-874`

Impact: duplicate legal records, duplicate jobs, confusing audit trails, and avoidable free-run quota use.

### 3. IPv4-mapped IPv6 addresses bypass both SSRF filters

Severity: Critical security boundary

Direct reproduction against the current web implementation:

```text
isPrivateAddress("::ffff:127.0.0.1")       -> false
isPrivateAddress("::ffff:169.254.169.254") -> false
isPrivateAddress("::ffff:10.0.0.1")        -> false
```

The runner mirrors the same incomplete IPv6 logic and accepts mapped addresses in its frozen-address comparison.

Evidence:

- `apps/web/lib/security.ts:15-28`
- `workers/runner/src/security.ts:28-45`

Impact: a malicious or compromised staging hostname can potentially route the verification browser toward loopback, cloud metadata, or private-network targets despite the advertised network boundary.

### 4. Legal-hold and retention state can diverge from deleted evidence

Severity: Critical legal/data integrity

Two separately confirmed failures share the same destructive ordering:

- Evidence is staged in the database, deleted from object storage, and only then finalized in PostgreSQL. The latest legal-hold function checks record-level `PENDING` deletion but no longer checks evidence-level `PENDING`. A hold can therefore be applied after staging; the bytes are removed and finalization then refuses to delete the now-held row.
- Released `legal_holds_v2` rows remain in the table with an `ON DELETE RESTRICT` foreign key. The record finalizer does not delete those released rows. It can remove storage first and then fail forever while deleting the database record.

Evidence:

- `apps/web/app/api/internal/retention/route.ts:39-83`
- `supabase/migrations/202607210003_beta_launch_safety.sql:140-154`
- `supabase/migrations/202607210003_beta_launch_safety.sql:283-302`
- `supabase/migrations/202607210002_independent_audit_fixes.sql:290-318`

Impact: legally held evidence can lose its file, and records that previously had a hold can become undeletable after their files are already gone.

### 5. Privacy exports disclose unrelated people and agency data

Severity: Critical privacy

Reproduction:

1. Reviewer Alice requests changes on a project.
2. A later packet is approved by reviewer Bob.
3. Alice submits a verified privacy-access/export request.
4. `privacy_subject_record_ids` includes the whole shared record because Alice appears on one packet.
5. The export returns the entire record, all review packets, reviewer identities/notes, jobs, audit events, billing contacts, invoice plans/jobs, and invoice details—including Bob's data and agency information.

Evidence:

- `supabase/migrations/202607210003_beta_launch_safety.sql:156-168`
- `apps/web/app/api/admin/privacy-export/[requestId]/route.ts:23-53`

Impact: fulfilling one person's privacy request can itself become a third-party data disclosure.

### 6. A client can see “approval failed” after approval and invoicing already committed

Severity: Critical trust/financial side effect

Reproduction:

1. Submit client approval while automatic invoicing is enabled.
2. The database atomically commits the decision and invoice job.
3. Lose the HTTP response after commit.
4. The client catch path only displays an error; it does not reconcile with a GET.
5. A retry receives “decision already recorded,” while an invoice may already be processing.

Evidence:

- `apps/web/app/api/reviews/[packetId]/decision/route.ts:47-69`
- `apps/web/components/client-review.tsx:169-185`

Impact: Greenlit can tell a client that approval failed while the legal decision and an external billing action succeeded.

### 7. Removing a beta user does not actually offboard their active workflows

Severity: High financial/control risk

`manage_beta_invite_atomic` only changes the invite status. It does not revoke undecided client-review packets, cancel invoice jobs, remove invoice plans, or disconnect Stripe. The client decision endpoint does not check whether the owning agency is still active. An already-issued review link can therefore approve a removed agency's milestone and queue the frozen automatic invoice.

Evidence:

- `supabase/migrations/202607210003_beta_launch_safety.sql:108-122`
- `apps/web/app/api/reviews/[packetId]/decision/route.ts:20-58`

Impact: the operator can believe an account is disabled while external client and invoice side effects remain live.

## High-impact reliability issues

These are also real and should be fixed before a broader beta, although they are below the seven blockers above.

1. **Workspace restoration can silently show a blank or older workspace.** Session-fetch failures are treated as signed-out; retained-record fetch failures silently fall through to local restore. Locally flushed criteria/business edits are read but ignored in favor of the older server snapshot. A transient network failure or closing within the 450 ms server-save debounce can make work appear lost. (`apps/web/components/milestone-studio.tsx:366-457`, `:511-523`)
2. **Unfinished custom verification mappings are not resumable.** Target URL, token, ownership receipt, evidence consent, and every check-field draft live only inside `VerificationSetup`; the parent receives them only after Run is clicked. Reloading midway discards the setup. (`apps/web/components/verification-setup.tsx:188-250`)
3. **A transient invite-provisioning failure permanently traps the tester.** The first attempt inserts `INVITED`; any later Auth/activation failure tells the tester to retry. The retry precheck rejects every `INVITED` row before it can resume provisioning. (`apps/web/app/api/auth/invite/route.ts:11-44`, `apps/web/lib/beta-access.ts:15-26`)
4. **Initial Stripe/invoice loading failure becomes an endless spinner.** The catch stores an error message while leaving `connection=null`; the render path shows only “Checking Stripe connection…” and never exposes the error or a retry. (`apps/web/components/invoice-plan-card.tsx:39-58`, `:187-200`)
5. **Some change requests cannot be completed on another device.** Raw source is deliberately excluded from server workspace state and deleted locally on sign-out; restore reconstructs only existing criterion quotations. The criteria screen has no reattach-and-hash-match action, so a requested criterion from a previously uncited SOW paragraph cannot be grounded. (`apps/web/lib/workspace-state.ts:1-20`, `apps/web/components/milestone-studio.tsx:405-440`, `:1230-1325`)
6. **The expired-review recovery instruction does not exist.** A decided packet that has expired tells the client to request “a new authorized receipt link,” but there is no receipt-link minting endpoint. The owner can export the record manually, but the advertised recovery path is unavailable. (`apps/web/app/api/reviews/[packetId]/redeem/route.ts:19-23`)

## Browser flow checked

1. Landing page — healthy at desktop and 320×568; primary actions and agency sign-in remain available.
2. Signed-out intake — healthy; business fields are blank, workflow navigation is disabled, and draft data survives the trip to the sign-in page.
3. Guided criteria — healthy; six source-backed criteria are clearly tied to the synthetic SOW.
4. Failed verification sample — healthy; the single failure and lack of real evidence are disclosed rather than disguised.
5. Fixed verification sample — healthy; all six outcomes are present before client review becomes available.
6. Client handoff/review — healthy in the synthetic path; no retained-record claim is made.
7. Client decision dialog — healthy at desktop/mobile; initial focus, Escape, focus restoration, internal scrolling, and no horizontal overflow were confirmed.
8. Feedback dialog — healthy at 320×568; it uses a real modal and does not create horizontal overflow.
9. Public legal/contact/demo routes — returned usable 200 responses locally. Local `/api/health` returned 503 because production-only services are intentionally absent from the local audit environment.

No browser console warnings or errors were recorded during these flows.

## Screenshots

- `01-landing-viewport.png`
- `02-criteria.png`
- `03-failed-run.png`
- `04-client-handoff.png`
- `05-client-review.png`
- `06-mobile-workspace.png`
- `07-mobile-decision-dialog.png`
- `08-mobile-landing.png`
- `09-mobile-feedback-dialog.png`

## Evidence limits

- The production origin was not available to the controlled browser in this audit. Browser testing ran against the exact checked-out `main` commit (`9464adb09608`), which matches `origin/main`.
- I did not submit a real magic link, create a retained production job, make a real client decision, or call Stripe.
- Authenticated dashboard, production runner dispatch, Stripe, and legal/retention findings were verified by direct implementation/state-machine inspection rather than by creating external side effects.
- A fresh-environment storage policy still appears to allow PNG/WebP but not JPEG while the runner uploads JPEG. Prior retained-run evidence indicates production was likely corrected manually; codify that correction, but this audit does not claim current production is broken.

## Confirmed strong areas

- Account-scoped drafts and 24-hour anonymous draft expiry
- Invitation gating before browser-side auth-user creation
- Per-packet review cookies
- Frozen criteria/result/evidence count and hash checks
- Atomic review decision/audit-event commit
- Integer-cent milestone storage and display
- Stripe OAuth state, webhook signature, and Stripe API idempotency handling
- Review/receipt visual clarity, mobile reflow, and modal focus management
- Public-table RLS and restricted SECURITY DEFINER execution
