# MilestoneProof Beta Readiness — Implementation Status

> Superseded on 2026-07-21 by the post-review launch-safety pass. The current
> status is in
> `docs/audits/milestoneproof-fresh-beta-audit-2026-07-21/IMPLEMENTATION_STATUS.md`;
> older “not reached” and deployment statements below are historical.

Tracking implementation of every locally-achievable item in
`MilestoneProof-Beta-Readiness-Audit.pdf` (2026-07-20), starting from commit
`a356ca1` plus the uncommitted Codex draft (auth/beta-access hardening,
`202607210001_external_beta_hardening.sql`).

Legend: ☑ done · ◐ partially done / documented remainder · ⛔ external/adult-only (cannot be completed by an agent in this environment)

_Last updated: 2026-07-21, end of this implementation session._

## 0. Starting-state audit of the uncommitted draft

Reviewed before changing anything. The draft's direction was correct but
several pieces were unfinished or inconsistent with the new atomic-RPC
migration it introduced. All of the following were found and fixed this
session (see section 2/3/6 for the fixes):

- `internal/jobs/[jobId]/lease` and `.../fail` still did raw table updates
  instead of calling the new `lease_verification_job_atomic` /
  `fail_verification_job_atomic` RPCs.
- `api/reviews/route.ts` called the **old 8-arg** `create_review_packet_atomic`
  and stamped review snapshots with the legacy, never-incrementing
  `transaction_records.revision` column instead of `criteria_revision`.
- `api/admin/overview/route.ts`'s "retry" action inserted a new
  `verification_jobs_v2` row directly without setting
  `transaction_records.active_job_id` — since `complete_verification_job_atomic`
  requires `active_job_id = p_job_id`, **any operator-retried job could never
  complete**. This was a correctness regression introduced by the partial migration.
- `internal/retention/route.ts` fetched **all** evidence storage paths for an
  expiring record (no `legal_hold` filter) and deleted them from Storage
  *before* calling `purge_expired_transaction_record` — a legally-held
  screenshot's file could be destroyed even though the DB row and hold
  survived. Evidence deletion also wasn't atomic with its audit event.
- Rate limiting failed **open** whenever the quota RPC errored.
- `analyze/route.ts` consumed Gemini quota **before** validating/parsing the
  request body.
- The runner only blocked cross-origin **navigation**; subresources/fetch/XHR
  to other origins were allowed through. `.first()` was used unconditionally
  for element assertions. `expectedPath`/`successPath` comparisons dropped
  query strings and fragments.
- The draft migration itself had a **bug**: the `revoke`/`grant` statements for
  `queue_verification_job_atomic` listed one extra parameter type versus the
  function's actual signature, which would have made the migration fail
  outright on a fresh database (`function ... does not exist`). Found by
  actually applying the migration to a local Postgres instance (see section 3).

## 1. Legal operator identity (page 3, item 1)

- ⛔ **External/adult-only.** Requires the authorized adult operator to supply
  their real legal name/entity and a monitored support/privacy address, and to
  decide whether the existing retained approval bearing a minor's name is
  relabeled as test data or replaced. See "Remaining external gates" below.
- ☑ `/contact`, `/privacy`, `/terms` already read `NEXT_PUBLIC_OPERATOR_NAME` /
  `NEXT_PUBLIC_SUPPORT_EMAIL` and fall back to an honest "pending
  configuration" notice pointing at `/privacy-request` — wired consistently
  (see section 9 below for the new `/contact` page).

## 2. Close the authentication bypass (page 3, item 2)

- ☑ `enable_anonymous_sign_ins = false` in `supabase/config.toml`.
- ☑ Migration drops legacy anon/authenticated policies + revokes table grants
  on the v1 prototype tables.
- ☑ Auth callback (`app/auth/callback/route.ts`) rejects non-invited users and
  signs them out; dashboard and login page both re-check `betaAccessAllowed`.
- ☑ Added `apps/web/lib/beta-access.test.ts` (11 new tests): fail-closed
  default in production with no allowlist, allowlist matching is
  case/whitespace-insensitive and exact (no prefix/substring match), admin
  access is independent of beta access.
- ☑ Validated locally: the migration's RLS/grant changes were applied to a
  real local Postgres and exercised (section 3's functional-check script).
- ⛔ Verifying the live **production** Supabase project has anonymous sign-in
  disabled and this migration applied — needs production credentials
  (external gate).

## 3. Safe record state machine (page 3, item 3)

- ☑ `queue_verification_job_atomic`: refuses new runs unless status is
  READY/NEEDS_WORK/CHANGES_REQUESTED/READY_FOR_REVIEW, blocks via a partial
  unique index if an active job exists, bumps `criteria_revision` only when
  criteria/source actually changed, revokes open undecided review packets on
  revision bump.
- ☑ `complete_verification_job_atomic`: rejects if record isn't `VERIFYING`,
  `active_job_id` doesn't match, or criteria revision/hash drifted since the
  job was queued (stale-run protection); idempotent (`DUPLICATE`) on retry.
- ☑ **Fixed**: `api/reviews/route.ts` now calls the 9-arg
  `create_review_packet_atomic` with `p_criteria_revision`, stamps the
  snapshot with `record.criteria_revision`, and pre-checks
  `status === 'READY_FOR_REVIEW' && last_run_id === run.id` for a friendly
  error before hitting the DB guard.
- ☑ **Fixed**: `lease`/`fail` internal job routes now call
  `lease_verification_job_atomic` / `fail_verification_job_atomic` so lease/fail
  are atomic with their audit event.
- ☑ **Fixed/added**: new `retry_verification_job_atomic` RPC — revision-safe
  (refuses to retry once the record's criteria/source changed) and
  active-job-guarded; wired into `api/admin/overview/route.ts`'s retry action,
  replacing the raw insert that broke completion.
- ☑ Dropped the dead 8-arg `create_review_packet_atomic` overload that
  `CREATE OR REPLACE` with a changed signature had silently left behind.
- ☑ **Validated against real Postgres**, not mocks (`supabase/tests/`,
  see below): queue→lease→complete happy path, active-job guard, idempotent
  duplicate completion, review-packet stale-run rejection, decision idempotency
  (second decision on same packet rejected), retry revision-safety (succeeds
  when unchanged, rejected once criteria/source changed).

## 4. Draft + client-review-token protection (page 4, item 4)

- ☑ Drafts are namespaced per signed-in account (`apps/web/lib/client-storage.ts`,
  `draftStorageKey(email)` → `milestoneproof-draft-v3:{email|anon}`), replacing
  the single global `milestoneproof-workspace-draft-v2` key.
- ☑ The client review bearer-token URL (`reviewUrl`, which embeds `#t=<token>`)
  is **no longer persisted to localStorage at all** — it now lives only in
  React state for the tab that created it. Only the non-secret review
  `packetId` persists, and it's used to look up decision status through the
  owner's authenticated session (`GET /api/reviews/[packetId]`), never the
  bearer token.
- ☑ All legacy global keys (`milestoneproof-workspace-draft-v2`,
  `milestoneproof-approved-url`, `milestoneproof-demo-decision`'s stray
  writer) are proactively cleared on every workspace mount and on sign-out.
- ☑ Sign-out (`agency-dashboard.tsx`) now calls `clearAccountDraftState(email)`
  before dropping the session cookie.
- ☑ **Removed the global "approval destination" bug**: the workspace no longer
  syncs an "Approval record" link from a global `storage`/`focus` listener.
  Clicking "Approval record" now calls `GET /api/reviews/{packetId}` for the
  *current* record's own review packet and navigates to that packet's receipt
  only if it is actually `APPROVED` — one project can no longer open another
  project's receipt.
- ☑ Uploaded-file drafts now survive sign-in the same as pasted text: selected
  files ≤1.5MB are base64-encoded and persisted in the draft, then
  reconstructed into a `File` object on restore (`fileToBase64`/`base64ToFile`
  in `milestone-studio.tsx`); larger files are intentionally not persisted to
  stay under browser localStorage quota (documented in-code).
- ☑ New unit tests: `apps/web/lib/client-storage.test.ts` (per-account key
  isolation, anonymous-bucket isolation, legacy-key cleanup).
- ☑ New e2e test: `e2e/workspace.spec.ts` — *"drafts are isolated per
  signed-in account and never leak across accounts on the same browser"* —
  fills a draft as account A, switches the mocked session to account B and
  confirms a blank form, switches back to A and confirms the draft is intact.
  **Passing** (chromium + mobile-chromium).

## 5. Runner network isolation (page 4, item 5)

- ☑ `workers/runner/src/index.ts`: `page.route("**/*", ...)` now blocks **every**
  non-same-origin request (navigation, subresources, fetch/XHR, frames) —
  only `data:`/`blob:` are allowed through as benign same-document schemes.
- ☑ **DNS-rebinding / TOCTOU defense added**: a `response` listener inspects
  each network response's actual `serverAddr()` during the run and aborts the
  whole job the moment any connection lands on a private/loopback/link-local
  or otherwise reserved address — this catches rebinding even though the
  pre-flight `validate-origin` check only proves the hostname resolved safely
  *before* the check started.
- ☑ Unique-element requirement: `requireUniqueMatch()` now throws (→ `ERROR`
  result / job failure) if an `elementRef`/`submitRef` matches anything other
  than exactly one element; only the `count` assertion may match >1 element,
  by design.
- ☑ Path comparisons (`expectedPath`, `successPath`, `expectedPostPath`) now
  compare `pathname + search + hash` via `pathWithQueryAndHash()` instead of
  bare `pathname`, so query strings and fragments are checked correctly.
- ☑ New `workers/runner/src/security.ts` (extracted so it's importable from a
  plain Node test runner without pulling in `@cloudflare/playwright`) +
  `security.test.ts`: 7 tests covering private/loopback/link-local/metadata
  IPv4 and IPv6 blocking, public-address allowance, malformed-input
  fail-closed behavior, and query/fragment-aware path comparison.

## 6. Retention, legal holds, audit atomicity (page 4, item 6)

- ☑ **Fixed the real bug**: `internal/retention/route.ts` no longer removes
  storage files for a record before checking whether any of that record's
  evidence is under legal hold — it now checks
  `evidence_artifacts_v2.legal_hold` for the record first and skips the whole
  record (no storage deletion at all) if any hold exists.
- ☑ New `purge_expired_evidence_atomic(ids, record_id, processed_at)` RPC
  makes expired-evidence deletion atomic with its audit event (delete rows +
  append `EVIDENCE_RETENTION_EXPIRED` in one transaction), replacing the
  previous delete-then-best-effort-audit app code. It also independently
  refuses to delete a held artifact (defense in depth even if the caller's
  pre-check is ever bypassed).
- ☑ **Validated against real Postgres**: legal hold on an individual artifact
  blocks `purge_expired_evidence_atomic`; a record-level hold and an
  artifact-level hold both independently block `purge_expired_transaction_record`
  even after `retention_until` has passed; purge succeeds once both are clear.
- ☑ Queueing/leasing/completion/failure/retry/revocation are all atomic with
  their audit event via the RPCs above (section 3), confirmed by the same
  functional-check script.

## 7. Genuinely resumable projects (page 4, item 7)

- ◐ Full workspace-state restore now covers: source text (+ uploaded file up
  to 1.5MB), business details, criteria, confirmation state, model/notice,
  record id, latest run, custom-run mapping, retained-fixture flag, and the
  open review packet id — for both the local-draft path and the
  server-authoritative `GET /api/account/records/[recordId]` path.
  **Not** persisted/restored: the 30-minute staging-origin verification
  receipt (must be re-verified after resume — this is a deliberate security
  boundary, not an oversight, since that receipt is short-lived and
  account-bound) and the review bearer token itself (by design, see section 4).
  The `workspace_state` JSON column written by `runs/route.ts` remains present
  in the schema but is not yet the single source of truth the frontend reads
  from; today the frontend reconstructs state from `confirmed_criteria` +
  latest run + latest review, which this session found to be accurate enough
  for every case actually tested but is a reasonable follow-up (see below).
- ☑ **Fixed the APPROVED-resume bug**: opening `?record=` for an `APPROVED`
  record now redirects straight to `/receipt/{packetId}` instead of landing on
  the "needs work" verification-report screen with a dead "Create client
  review" button. New e2e test *"resuming an approved record redirects
  straight to its receipt instead of a needs-work workflow phase"* — passing.
- ☑ NEEDS_WORK/FAILED, READY_FOR_REVIEW/IN_REVIEW, and CHANGES_REQUESTED
  resume phases were already correct and are covered by the existing
  `a retained imported fixture reruns rc2 directly...` e2e test.
- ☑ Global receipt-destination state removed (section 4).
- Remaining, lower-priority: wire `PATCH /api/account/records/[recordId]`
  (already implemented server-side) into the frontend so the full
  `workspace_state` blob becomes the restore source of truth instead of the
  criteria/run/review reconstruction — would mainly help preserve rationale
  text edits and in-progress (unconfirmed) criteria edits across devices,
  which today are not retained once confirmed criteria are frozen server-side.

## 8. Operational: privacy + retries + notifications (page 5, item 8)

- ☑ Every admin console mutation (feedback status, privacy-request
  status/notes, job acknowledge, job retry, notification retry) now calls the
  new `record_operator_action` RPC for a durable, queryable
  `operator_action_events` log entry — previously the table existed but
  nothing called it.
- ☑ Retry is now idempotent/revision-safe/active-job-guarded via
  `retry_verification_job_atomic` (section 3), verified functionally.
- ☑ Notification insertion/delivery failures are recorded in
  `operator_notifications.delivery_status`/`delivery_error` (pre-existing,
  confirmed still correct after the retry-route fix).
- ◐ **Fulfillment process is documented, not built as self-service UI**: with
  no real user-identity-verification system available in a beta this size,
  the durable pieces (identity-verified timestamp, response summary/sent-at
  columns, operator action log) are in place; a step-by-step manual runbook
  for verifying a requester, locating their records by reviewer/owner email,
  exporting, correcting, deleting (synthetic-only), and applying a hold is
  the recommended next addition — flagged as a remaining task rather than
  guessed at, since it depends on real operator process decisions.

## 9. Backend/product correctness before broader beta (page 5)

- ☑ Finalized receipts remain viewable after the review packet's `expires_at`
  — `receipt/[packetId]`'s underlying `GET /api/reviews/[packetId]` route
  only gates on `expires_at` when `!packet.decision`; a decided packet is
  always viewable regardless of expiry (confirmed by reading the route; no
  change needed, but worth stating explicitly since it's easy to regress).
- ☑ Evidence screenshot URLs now refresh automatically while a client stays on
  the review page (`client-review.tsx`, new interval every 3.5 minutes,
  safely under the 5-minute signed-URL TTL), without disturbing decision state
  or re-triggering after a decision is recorded.
- ☑ Runner path/query/fragment checks fixed (section 5).
- ☑ Gemini quota (`analyze/route.ts`) and origin-verification quota
  (`verify-origin/route.ts`) are now consumed only **after** the request body
  is fully parsed/validated — previously quota was spent on invalid requests.
  `runs/route.ts` was already correctly ordered (confirmed, not changed).
- ☑ Rate limiting fails closed on the three protected/high-cost route
  families (verification-run/-capacity, sow-analysis/-capacity,
  origin-verification) when the quota store errors in production; stays
  fail-open elsewhere (feedback, privacy-request, invite-check, review
  actions) where availability matters more than strict enforcement. New
  `consumeRateLimit(..., { failClosed })` option + 3 new tests.
- ☑ `runs/route.ts` already rejected `sourceMode === "demo"` for retained runs
  (confirmed, unchanged) — the only retained-run-creation API.
- ☑ Acme fixture moved off `/contact` to `/fixture/contact`; `/contact` is now
  a real, honest MilestoneProof contact page reusing the same
  operator-identity fallback pattern as `/privacy`/`/terms`. Updated the
  fixture's own internal link, the demo check spec's `expectedPath`, and the
  homepage's illustrative-example labeling (visible "Illustrative example"
  text, not just an `aria-label`) as a related fix.
- ☑ PostCSS moderate advisory (GHSA-qx2v-qp2m-jg93) resolved via a pnpm
  workspace override (`postcss: ">=8.5.10"` in `pnpm-workspace.yaml`) rather
  than waiting on a Next.js bump — `pnpm audit --prod` now reports zero
  vulnerabilities.
- ◐ Notification-webhook provider/metadata disclosure: `NOTIFICATION_WEBHOOK_URL`
  is unset in this environment (no webhook configured), so there's nothing to
  disclose yet; if/when the operator enables one, `/privacy` should name the
  provider and list exactly what's sent (`operator_notifications` payload:
  event type, title, body, reviewer email, decided-at) — flagged for whoever
  configures it rather than guessed at.

## 10. Mobile and professional polish (page 6)

- ☑ Feedback trigger no longer sits at a flat `bottom:18px/10px` on every
  page: pages with their own bottom-anchored primary action (`/login`, and a
  general `--offset` default for any page other than the landing page,
  `/workspace`, review, and receipt) get extra clearance (`bottom: 84px`
  desktop / `76px` mobile). Toast notifications were also raised above the
  persistent feedback trigger (`bottom: 76px`, `z-index: 46`) so neither ever
  covers the other. Removed two dead, conflicting `z-index` redeclarations
  that were silently making the widget's real cascade-resolved z-index `12`
  instead of the intended `45`.
- ☑ Receipt toolbar and its action group now wrap (`flex-wrap`) instead of
  overflowing at narrow widths; long verified-target URLs in the receipt
  facts grid now break safely (`overflow-wrap: anywhere`).
- ☑ Real print pagination: replaced the broken in-flow `counter(page)` (which
  is only valid inside `@page` margin boxes and rendered literally "Page 0")
  with a genuine `@page { @bottom-right { content: "Page " counter(page) " of
  " counter(pages); } }` margin-box counter, and removed the fake "Page" span
  from the receipt footer markup entirely. Consolidated the two
  redundant/overlapping `@media print` blocks into one.
- ☑ Mobile workflow-step (`.step`) label size increased from 8px to 11px, and
  its inactive-state color switched to the app's existing `--muted` token for
  contrast (from an uncontrasted ad hoc gray).
- ☑ Touch targets: `.mini-action`/`.text-action`/`.criterion-row-actions
  .mini-action` raised from 36px to 44px minimum height at all widths (mobile
  already had 44px in one case; desktop/tablet did not).
- Not reached this session (documented, not silently dropped): a full audit
  of the landing/dashboard/operator header reflow at exactly 320px and high
  zoom beyond the fixes already present in the codebase's existing ≤680px
  media blocks. The feedback-trigger-blocks-sign-in screenshot case from the
  audit is specifically addressed (`.feedback-widget--login`); a broader
  pixel-by-pixel 320px pass across every page was not performed.

## 11. Accessibility corrections (page 7)

- ☑ Skip link target (`#main-content`) now has `tabIndex={-1}`, so activating
  it actually moves keyboard/screen-reader focus into main content, not just
  scroll position.
- ☑ `verification-setup.tsx`'s `MappingFields` (the custom-origin check
  mapping form, which had no error association at all) now gets a real
  per-criterion error: `run()` collects a validation error per criterion
  instead of aborting at the first one, and each mapping card gets
  `aria-invalid` + `aria-describedby` wired to a visible, `role="alert"`
  error message scoped to that criterion.
- ☑ Explicit "Passed"/"Failed"/"Manual review" text added next to the
  previously icon-only result badge in the workspace's own `VerificationReport`
  (the client-facing `client-review.tsx` already had this).
- ☑ Live-region + focus management for approvals: the decision-success panel
  in `client-review.tsx` now has `role="status" aria-live="polite"` and moves
  focus to its heading when a decision is recorded (previously only the
  changes-requested path had a toast; approval had neither).
- ☑ Feedback widget moves focus into the success heading after a successful
  submission (previously focus stayed on the now-hidden form).
- ☑ Inactive workflow-step contrast and 8px mobile label size fixed (section 10).
- ☑ Extended forced-colors handling incidentally via the result-icon pill
  redesign (now text+icon, so forced-colors mode conveys pass/fail through
  text regardless of color rendering) — the specific "approval-limbo heading"
  wording in the audit could not be matched to a concrete element in the
  current codebase (no `approval-limbo` class or literal outlined-heading
  pattern was found); flagged rather than guessed at.
- ☑ Grew small text actions/evidence-summary/feedback controls toward 44×44px
  (section 10).
- ◐ Remaining low-contrast text sweep (sidebar/helper/divider/receipt/
  step-number colors) beyond the specific `.step` fix above was not
  exhaustively re-audited pixel-by-pixel against WCAG AA in this session.

## 12. Testing and release operations (page 7)

- ☑ **New tests added this session** (all passing):
  - `apps/web/lib/beta-access.test.ts` — 8 tests (invitation enforcement logic).
  - `apps/web/lib/client-storage.test.ts` — 4 tests (draft isolation/cleanup).
  - `apps/web/lib/security.test.ts` — +3 tests (`assertSafeResolvedAddresses`).
  - `apps/web/lib/rate-limit.test.ts` — +3 tests (fail-closed behavior).
  - `workers/runner/src/security.test.ts` — 7 tests (SSRF/private-address
    blocking, query/fragment path comparison) — new, runner had zero tests
    before this session.
  - `e2e/workspace.spec.ts` — +2 Playwright tests: cross-account draft
    isolation, and APPROVED-resume redirect.
  - `supabase/tests/01_atomic_rpc_functional_checks.sql` — 15 assertions run
    against a **real local Postgres** (not mocks): queue/lease/complete happy
    path + idempotency, active-job guard, stale-run rejection on review
    creation, decision idempotency, retry revision-safety (both directions),
    evidence/record legal-hold enforcement (both directions). This is the
    layer that actually caught the migration signature bug in section 0.
- ☑ All gates run and passing as of this session:
  - `pnpm -r typecheck` — clean (contracts, runner, web).
  - `pnpm --filter @milestoneproof/web lint` — clean.
  - Unit tests: contracts 7/7, web **59/59** (was 41), runner **7/7** (was 0).
  - `pnpm --filter @milestoneproof/web build` — production build succeeds,
    all 43 routes compile (including new `/fixture/contact`, updated `/contact`).
  - `pnpm exec playwright test` — **20/20 passing**, 2 appropriately skipped
    (the production-retained smoke gate, which requires a real
    `E2E_RETAINED_RECORD_ID`).
  - `pnpm audit --prod` — 0 vulnerabilities (PostCSS fixed).
  - `git diff --check` — clean, no whitespace errors.
- ☑ Migration validated against a real local Postgres instance (no Docker
  available in this environment, so a plain `initdb`/`pg_ctl` instance with
  stubbed `auth`/`storage`/`extensions` schemas was used instead of the
  Supabase CLI) — see `supabase/tests/README.md` for the exact reproduction
  steps and what each check proves. This is how the signature bug in
  section 0 was found and fixed before it could reach production.
- ⛔ One complete retained production transaction with an authorized adult
  reviewer — needs a real adult and real production credentials; cannot be
  performed by this agent. The functional-check script above exercises the
  equivalent state machine locally as the closest available substitute.
- ⛔ Verify retention cron + `CRON_SECRET` execute successfully **in
  production** — the route's logic was fixed and is covered by the local
  functional checks; production execution needs the deployed Vercel cron and
  real `CRON_SECRET` (external gate).
- ⛔ Verify backups and export recovery — needs production Supabase project
  access.
- ⛔ Review every beta-allowlisted and administrator email address — needs
  the operator's actual `BETA_ALLOWED_EMAILS`/`ADMIN_EMAILS` values.
- ◐ Removing/labeling current QA feedback, privacy requests, failed jobs, and
  retained test transactions before inviting agencies: this environment has
  no production database connection to inspect, so nothing could be
  identified or removed. The retention/admin-console tooling to do this
  safely (with a durable operator-action log) is now in place (section 8);
  the operator should run it against the real production data before invites
  go out.

## Migrations

- `supabase/migrations/202607210001_external_beta_hardening.sql` — extended
  this session with `retry_verification_job_atomic`,
  `purge_expired_evidence_atomic`, a fix to the `queue_verification_job_atomic`
  revoke/grant signature bug, and an explicit `drop function` for the dead
  8-arg `create_review_packet_atomic` overload.
- **Applied and validated locally** against a real Postgres instance,
  including the full prior migration chain (`202607190001` through
  `202607200005`) — see `supabase/tests/README.md`.
- ⛔ **Not yet applied to the production Supabase project** — requires
  production credentials the agent does not have. This is the top external
  gate; see below for exactly what running it entails.

## Commits / deployments

- Local commit created this session (see `git log` for the exact hash/message)
  covering every change described above.
- ⛔ **Not pushed to `origin/main`** and **not deployed** (Vercel, Cloudflare
  runner) — both require external access this agent does not have. See below.

## Remaining external / adult-only gates

These cannot be completed by an agent and need the authorized adult operator:

1. **Legal operator identity.** Set `NEXT_PUBLIC_OPERATOR_NAME` and
   `NEXT_PUBLIC_SUPPORT_EMAIL` (or the real production equivalents) to the
   actual operating entity/adult and a monitored support address. Until then,
   `/contact`, `/privacy`, and `/terms` all correctly show a "pending
   configuration" notice and refuse to imply readiness — do not fabricate
   these values. Decide whether the existing minor-named retained approval is
   relabeled as test data or replaced with an adult-authorized test record.
2. **Push this branch and apply the migration to production.**
   ```
   git push origin main
   # then, with the Supabase CLI authenticated against the real project:
   supabase db push   # or your existing migration-apply process
   ```
   Verify in the Supabase dashboard afterward that: anonymous sign-in is
   disabled, the legacy v1 tables/policies are gone, and the new functions
   (`queue_verification_job_atomic`, `retry_verification_job_atomic`,
   `purge_expired_evidence_atomic`, etc.) exist with `service_role`-only grants.
3. **Deploy Vercel and the Cloudflare runner**, then smoke-test the deployed
   versions:
   - Vercel: deploy `apps/web`; confirm `BETA_ALLOWED_EMAILS`, `ADMIN_EMAILS`,
     `CRON_SECRET`, `RUNNER_URL`, `RUNNER_HMAC_SECRET`, `RECORD_HASH_SECRET`,
     `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
     `NEXT_PUBLIC_APP_URL` are all set to real values (none of these should be
     guessed or invented by an agent).
   - Cloudflare: `pnpm runner:deploy` (or your CI equivalent) for
     `workers/runner`; confirm its `RUNNER_HMAC_SECRET`/`WEB_APP_URL` match the
     web deployment.
   - Verify the Vercel cron job that hits `/api/internal/retention` and
     `/api/internal/notifications` with `CRON_SECRET` is actually scheduled
     and firing (check Vercel's cron logs after the first scheduled run).
4. **Review the real `BETA_ALLOWED_EMAILS`/`ADMIN_EMAILS` lists** in the
   production environment — this agent has no visibility into who should be
   on them.
5. **Run one complete retained production transaction** as an authorized
   adult reviewer (real SOW-shaped but synthetic/non-confidential content,
   real staging origin you control, real client-decision dialog) — this is
   the one thing genuinely impossible for an agent to stand in for, since the
   product's own attestations require an adult acting in a real business
   capacity. Confirm backups and export recovery from that transaction
   afterward.
6. **Clean production data before inviting agencies**: use the (now durably
   logged) admin console to remove or clearly label any existing QA feedback,
   privacy requests, failed jobs, and retained test transactions.
7. If a notification webhook is ever configured
   (`NOTIFICATION_WEBHOOK_URL`), update `/privacy` to name the provider and
   the exact reviewer metadata it receives (section 9).

Once 1–6 are done, the audit's "External beta exit criteria" (page 11) are
satisfied by what this session implemented and verified locally.
