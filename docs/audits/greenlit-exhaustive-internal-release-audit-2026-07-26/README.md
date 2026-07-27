# Greenlit exhaustive internal release audit

Audit date: 2026-07-26

Audited target: the optimized local production build at `http://127.0.0.1:3008`

Database target: a clean disposable PostgreSQL 18 database with every repository migration applied in filename order

Release boundary: internal implementation and local verification are complete. Supabase schema synchronization, Cloudflare runner deployment, and non-human Vercel configuration were completed after the original audit; the exact new web release still requires real legal/contact values before production promotion.

## Verdict

The current working tree has no known internally reproducible release blocker. Every identified code, control, accessibility, data-integrity, security, and operational defect that could be fixed without production credentials or third-party authority was fixed and retested.

This is not a production certification. Supabase and Cloudflare are now configured and verified as recorded below. The exact web release still needs founder-supplied legal/contact values and real email, Gemini, Stripe, DNS, backup, retained-transaction, and legal/operator exercises described under **External completion checklist**.

## Evidence limits

- Public, synthetic, signed-out, and demo journeys were exercised against an optimized local production build.
- Authenticated and provider-backed behavior was verified with unit, route, component, end-to-end, state-machine, SQL regression, and clean-schema tests.
- The linked Supabase, Cloudflare, and Vercel projects were changed only where the task could be completed without founder judgment: schema `202607260008` was applied, high-impact secrets were rotated/synchronized, owner access lists and a bounded run limit were set, and the runner was deployed with its queue and schedules. No external recipient was contacted, no invoice was sent, and no production privacy deletion was executed.
- The two `production-retained` Playwright cases intentionally remain skipped unless `PRODUCTION_SMOKE=1` and an authorized production account, retained record, and saved session are supplied.
- Chromium and WebKit passed locally. Firefox could not start on this managed macOS host because its `plugin-container` sandbox was denied before page interaction. That is a host limitation, not a website failure; Firefox must be run in external CI.
- Earlier production sign-off evidence is not treated as proof of this exact un-deployed working-tree release.

## Journey results

1. **Marketing home — healthy.** Navigation, synthetic walkthrough CTA, conversation CTA, legal footer, feedback control, responsive hero, and illustrative milestone record render correctly. The final 1280×720 and 390×844 captures show no horizontal overflow.
2. **Synthetic workspace intake and criteria — healthy.** The guided draft loads, source citations remain attached, criteria can be edited and confirmed, and invalid mappings are announced and block progression.
3. **Synthetic RC1 verification — healthy.** AC-04 correctly reports a needs-work result even when a superficial success surface is visible, preventing a false pass.
4. **Synthetic RC2 verification — healthy.** All six seeded checks pass, evidence is attached to the frozen revision, and the next review step becomes available.
5. **Client review — healthy.** The proof page, expandable fixture, source/evidence context, expiry messaging, keyboard-operable approve/request-changes dialogs, and focused client decision work.
6. **Approval record — healthy.** The immutable record displays the decision and audit evidence, supports print/save-to-PDF, and uses the correct receipt-access wording.
7. **Evidence download — healthy.** The browser downloads only an artifact frozen into the signed snapshot through a same-origin, authorized, attachment-only endpoint; snapshot hashes are checked before storage retrieval.
8. **Agency authentication and dashboard — healthy internally.** Neutral anti-enumeration messaging, safe return paths, Stripe OAuth result handoff, expiring-state updates, invitation states, reconnection guidance, and clipboard fallback behavior are covered and passing.
9. **Request-demo form — healthy.** Validation, submission, duplicate-safe request creation, notification handoff, and the returned `DR-…` reference are tested.
10. **Resources, trust, privacy, terms, records, contact, crawler boundaries — healthy.** Public routes, metadata, sitemap, robots rules, noindex boundaries, canonical/social metadata, security contact behavior, and founder-only 404 boundaries pass the site crawler.
11. **ROI calculator — healthy.** Valid inputs calculate, an out-of-range value exposes an accessible unavailable state and removes misleading numbers, and Reset assumptions restores the model.
12. **Privacy lifecycle — healthy internally.** Verification gating, export availability, deletion staging, legal holds, Auth cleanup, reviewer-only handling, stale reclaim, minimization, retry backoff, and orphan adoption races are covered.
13. **Verification runner and evidence pipeline — healthy internally.** Signed dispatch, exact-origin proof, safe typed checks, pause/capacity controls, immutable content-addressed upload, atomic metadata, stale-job recovery, and fail-closed error paths pass.
14. **Stripe test-mode implementation — healthy internally.** OAuth return states, token encryption, request timeouts, live-mode blocking, invoice state transitions, duplicate-customer recovery, durable webhook failure/retry, deauthorization, and cleanup paths pass. A real Stripe sandbox remains external.
15. **Operations and recovery — healthy internally.** Deep health contracts, version matching, bounded maintenance work, retention, notification/invoice retry, evidence limits, audit events, emergency pauses, backup/restore scripts, and release preflight checks exist and pass their local tests.

## Final control inventory

The final static inventory covered 101 buttons, 37 raw anchors, 81 Next links, 11 forms, 72 inputs, 20 selects, 13 textareas, every literal internal route, and every fragment target.

- All 11 forms have a submit handler.
- Every literal internal route maps to an application or API route.
- Every fragment link resolves to a matching page ID.
- No empty, `#`, `javascript:`, TODO, FIXME, or placeholder action remains.
- No unhandled form, interactive nesting defect, unnamed control, or unlabeled form field remains.
- Dialogs provide initial focus, Escape handling, focus containment, and focus restoration.

The final inventory exposed 13 additional defects. All 13 were corrected:

1. Stripe OAuth results are surfaced, consumed once, and removed from the URL.
2. Privacy export remains disabled until verification succeeds.
3. Entering the separate synthetic walkthrough no longer overwrites an anonymous live draft.
4. Clipboard failure exposes the complete review URL in a selectable fallback.
5. Evidence downloads use the authorized same-origin attachment endpoint.
6. Authentication copy no longer reveals whether an email is registered or invited.
7. Dashboard expiry messaging updates every 30 seconds instead of going stale.
8. Fixture validation identifies each invalid field, announces the error, and focuses the first invalid control.
9. Resource download labels are generated from the actual file type.
10. Copy-token controls stay disabled and guarded until a token exists.
11. Expired review access asks for a replacement review link, not a receipt link.
12. Source reattachment file inputs have an accessible name.
13. Invited beta users render as pending and expose an explicit Activate action.

One additional cross-boundary defect was also corrected: an unauthenticated `stripe=session-expired` result now survives dashboard → login → magic-link handoff through a narrowly allowlisted return URL.

The exact Vercel preview exposed one deployment-only packaging defect after the local audit: an unanchored `artifacts/` ignore rule removed the nested private evidence-upload API route. All Vercel ignore rules are now repository-root anchored, the preview route manifest includes `/api/internal/jobs/[jobId]/artifacts`, an authenticated route probe reaches that route, and a regression test blocks unanchored deployment ignores.

## Verification matrix

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test` | Pass: 245 tests total (5 contracts, 205 web, 24 runner, 6 preflight, 4 operations, 1 deployment-package guard) |
| `pnpm build` | Pass: optimized production build; 63 pages generated |
| `git diff --check` | Pass |
| `pnpm audit --prod --audit-level=high` | Pass: no vulnerabilities |
| Chromium Playwright desktop/mobile | Pass: 126 unaffected checks plus 2 corrected contrast checks rerun successfully; 2 production-retained tests intentionally skipped |
| WebKit supplemental accessibility/company-demo/invoice | Pass: final 7/7 critical-path rerun against the optimized build; earlier broader 13/13 pass retained |
| Firefox local launch | Environment-blocked before page interaction; external CI required |
| Public-site smoke crawler | Pass: 34 pages, 48 assets, 94 fragment links, 6 access boundaries, 7 auxiliary endpoints |
| Clean database migration | Pass through `202607260008`; linked Supabase migration history matches and schema lint is clean |
| SQL regression suites | Pass: atomic RPC, beta blocker, atomic evidence artifact, and release integrity |
| Chunked request-body limit | Pass: oversized streaming request rejected with HTTP 413 |
| Fixed RC2 lead handoff | Pass: HTTP 201 |
| Mobile layout check | Pass: 390 px viewport, 390 px document width, 0 px horizontal overflow |

## Security, data, and operational coverage

- Forwarded-origin CSRF handling, production CSP, route authorization, security headers, cache controls, and fail-closed launch configuration were exercised.
- Request bodies are bounded while streaming; the server does not rely solely on `Content-Length`.
- Evidence is immutable and content-addressed, and review/receipt/owner authorization is enforced before download.
- Public notification webhooks must use a validated public HTTPS endpoint, do not follow redirects, are signed, and support idempotent retries.
- Runner, record-hash, cron, Stripe encryption, and webhook secrets have separate configuration contracts; unsafe secret reuse fails readiness.
- Retention, invoice recovery, and notification recovery have separate bounded schedules and observable heartbeats.
- Privacy deletion and legal-hold transitions are atomic, race-tested, retryable, and preserve legally shared reviewer records for an operator decision.
- Stripe calls time out, webhook failures remain durable and retryable, and live-mode activity stays blocked while `STRIPE_ALLOW_LIVE_MODE=false`.
- The health endpoint reports expected web, runner `0.9.0`, and database `202607260008` versions and distinguishes service health from `readyForBeta`.

## UX and accessibility findings

- The desktop and mobile marketing hierarchy is clear: problem statement, synthetic proof path, conversation path, illustrative record, then supporting value propositions.
- The 390 px capture preserves readable typography and CTA priority without horizontal overflow. The example record begins below the primary actions rather than competing with them.
- Validation states use visible text plus `aria-invalid`/descriptions rather than color alone. The ROI invalid capture shows the focused field, explicit recovery guidance, and unavailable result placeholders.
- Keyboard focus, skip links, dialog trapping/restoration, form error focus, printable receipt behavior, and serious/critical Axe scans pass on the tested routes.
- No remaining internally reproducible serious or critical accessibility issue is known.

## Screenshot index

- `01-homepage-viewport.png` — original desktop home checkpoint
- `02-guided-criteria.png` — confirmed synthetic criteria
- `03-guided-rc1-needs-work.png` — intentional RC1 failure
- `04-guided-rc2-pass.png` — all six RC2 checks passing
- `05-client-review.png` — focused proof and decision page
- `06-approval-record.png` — approval record
- `07-request-demo.png` — business demo-request surface
- `08-resources.png` — public resource hub
- `09-trust-center.png` — trust and operating-boundary page
- `10-final-homepage-desktop-viewport.png` — final optimized build at 1280×720
- `11-final-homepage-mobile.png` — final optimized build at 390×844
- `12-roi-invalid-state.png` — accessible invalid-state behavior

## External completion checklist

These items require production credentials, provider consoles, a real identity/account, legal authority, or a real external transaction. They cannot be completed safely from the local repository.

### 1. Deploy the exact tested release and schema

1. Review the working-tree changes and commit the exact release you intend to deploy.
2. Supabase is already synchronized through `202607260008_receipt_hash_audit_context.sql`; re-confirm migration parity before production promotion.
3. The Cloudflare runner is deployed. Promote the exact tested web preview after the remaining legal/operator preflight fields are supplied.
4. Confirm `/api/health` reports database `202607260008`, runner `0.9.0`, the intended web release, and `readyForBeta: true`.
5. Run the protected deep check with `Authorization: Bearer <CRON_SECRET>` against `/api/health?deep=1`.

### 2. Complete production environment and operator configuration

1. Copy every applicable key from `.env.example` into the production secret stores.
2. Use independent random values for `RUNNER_HMAC_SECRET`, `RECORD_HASH_SECRET`, `CRON_SECRET`, `STRIPE_TOKEN_ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET`, and the notification secret. The first three must not be reused.
3. Set the real legal/operator name, monitored support and security emails, address, governing law, venue, allowlisted beta emails, admin emails, public app URL, provider name, and capacity limits.
4. Leave `STRIPE_ALLOW_LIVE_MODE=false`.
5. Run `DEMO_PREFLIGHT_PRODUCTION=1 pnpm demo:preflight` inside the configured production environment; resolve every failure rather than bypassing it.

### 3. Configure Supabase Auth, email, and DNS

1. Disable public signup and allow only the intended production Site URL and `/auth/callback`.
2. Configure custom SMTP using the monitored sender domain.
3. Publish and verify SPF, DKIM, and DMARC.
4. Send a magic link to a non-team agency mailbox and confirm delivery, callback, session creation, and logout.
5. Test the same email through the recipient’s corporate link scanner/security tooling and confirm the scanner cannot consume the usable sign-in, review, or receipt flow.

### 4. Deploy and prove the Cloudflare runner

1. Retain or create the queue configured in `workers/runner/wrangler.toml`: `wrangler queues create milestoneproof-jobs`.
2. Configure the runner’s `RUNNER_HMAC_SECRET` to match the web application and deploy with `pnpm runner:deploy`.
3. Configure production DNS and the documented staging-origin proof file on an authorized non-confidential test site.
4. Verify shallow and protected deep health, a real browser launch, queue consumption, private evidence upload, completion callback, and all retention/invoice/notification heartbeat schedules.

### 5. Choose the Gemini data mode

1. If the API project is not visibly on a paid tier with usable billing, keep `NEXT_PUBLIC_GEMINI_SERVICE_TIER=unpaid` and `GEMINI_PAID_TIER_CONFIRMED=false`; testers must use only synthetic, redacted, or expressly non-confidential text.
2. To allow the paid data mode, verify the exact API project/key and provider terms, then set both `NEXT_PUBLIC_GEMINI_SERVICE_TIER=paid` and `GEMINI_PAID_TIER_CONFIRMED=true`, redeploy, and confirm the health response reports the paid mode.

### 6. Exercise Stripe in sandbox only

1. Create/configure a test-mode Stripe App and register `/api/stripe/callback` and `/api/stripe/webhook`.
2. Set the client ID, external-test install URL, test secret key, API version if pinned, webhook secret, and a base64-encoded random 32-byte token-encryption key.
3. Connect a test account, reconnect after a simulated reauthorization requirement, exercise duplicate-customer recovery, create/send a test invoice, replay a webhook, verify idempotency, and deauthorize the account.
4. Confirm the dashboard status and durable audit events match Stripe.
5. Keep live mode disabled until an authorized operator separately approves it.

### 7. Connect and test notification delivery

1. Configure a public HTTPS `NOTIFICATION_WEBHOOK_URL`, secret, and the public provider name.
2. Make the receiving service verify the bearer secret and deduplicate by Greenlit’s idempotency key.
3. Test a demo request, client decision, a temporary provider failure, and the hourly retry path; confirm only one final message is delivered.

### 8. Configure backups and prove restore

1. Set the production database URL, restricted off-site output location, encryption recipient, isolated restore database, and expected Supabase host.
2. Run `pnpm ops:backup`.
3. Run `pnpm ops:restore-check` against an isolated target.
4. Compare at least one approval record, audit-chain head, and evidence hash, then record the operator, timestamp, and evidence in `docs/PRODUCTION_SIGNOFF.md`.

### 9. Run the retained production transaction

1. Use an allowlisted smoke account and an authorized non-confidential retained record.
2. Save a signed-in browser state outside the repository:

   ```bash
   pnpm exec playwright codegen \
     --save-storage=/private/tmp/greenlit-production-smoke.json \
     https://YOUR-DOMAIN/login
   ```

3. Run:

   ```bash
   PRODUCTION_SMOKE=1 \
   PRODUCTION_SMOKE_BASE_URL=https://YOUR-DOMAIN \
   PRODUCTION_SMOKE_RECORD_ID=YOUR-AUTHORIZED-RETAINED-RECORD-ID \
   PRODUCTION_SMOKE_EMAIL=YOUR-ALLOWLISTED-TEST-EMAIL \
   PRODUCTION_SMOKE_STORAGE_STATE=/private/tmp/greenlit-production-smoke.json \
   pnpm exec playwright test e2e/production-retained.spec.ts --project=chromium
   ```

4. Verify the database record, job, private artifact, review packet, separate-browser decision, receipt/export, notification, and—only if intended—the Stripe test invoice.
5. Delete the saved storage-state file after the gate because it contains an authenticated session.

### 10. Complete human/legal/commercial sign-off

1. Have the responsible adult/operator and counsel review the Terms, Privacy Notice, retention, incident-notification duties, electronic-record language, and pilot terms.
2. Choose the legal entity/public operator identity, mailing address, governing law, venue, pilot price, tax/refund/no-auto-renewal terms, and monitored contacts.
3. Name the incident lead, backup, privacy lead, and tester-communications owner.
4. Approve the ICP, target-company list, demo claims, offer, follow-up copy, and fallback video.
5. Complete and date `docs/PRODUCTION_SIGNOFF.md` with evidence references, never secret values.

### 11. Run Firefox in external CI

Run the same Playwright suite in a Linux CI host with the Firefox browser installed. Treat any page-level failure as a release blocker; the local macOS launch denial is not a substitute for this check.
