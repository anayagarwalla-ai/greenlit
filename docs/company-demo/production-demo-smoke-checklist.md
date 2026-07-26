# Production company-demo smoke checklist

Run this against the exact deployed release, not a local branch.

## Automated release gate

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
pnpm test:e2e
pnpm demo:preflight
```

Run the database migration jobs on PostgreSQL 17, including both SQL regression suites.

## Public surfaces

- `/` has the U.S. web-agency positioning and two clear paths: synthetic walkthrough and request conversation.
- `/request-demo` records a synthetic business-only request and returns a `DR-…` reference.
- `/resources`, `/trust`, `/privacy`, `/terms`, `/records`, and `/contact` return 200.
- Founder-only resource slugs return 404.
- `/robots.txt` and `/sitemap.xml` contain the intended public/private boundaries.

## Product surfaces

- Synthetic rc1 shows AC-04 failing despite visible success.
- Synthetic rc2 shows all six seeded checks passing.
- The client review expands the included fixture frame.
- Approve and request-changes dialogs are keyboard operable.
- The sample receipt prints or saves as PDF.

## Production-only retained gate

Use an authorized, non-confidential retained record. First open an instrumented browser, complete the magic-link sign-in with the allowlisted smoke account, and save its authenticated browser state outside the repository:

```bash
pnpm exec playwright codegen \
  --save-storage=/private/tmp/greenlit-production-smoke.json \
  https://YOUR-DOMAIN/login
```

Close the instrumented browser after the signed-in workspace loads. Then run the retained gate with that exact account and record:

```bash
PRODUCTION_SMOKE=1 \
PRODUCTION_SMOKE_BASE_URL=https://YOUR-DOMAIN \
PRODUCTION_SMOKE_RECORD_ID=YOUR-AUTHORIZED-RETAINED-RECORD-ID \
PRODUCTION_SMOKE_EMAIL=YOUR-ALLOWLISTED-TEST-EMAIL \
PRODUCTION_SMOKE_STORAGE_STATE=/private/tmp/greenlit-production-smoke.json \
pnpm exec playwright test e2e/production-retained.spec.ts --project=chromium
```

When `PRODUCTION_SMOKE=1`, missing or invalid production URL, record, account, or saved-session settings fail during Playwright configuration. The production gate never starts the local development server and does not silently skip. The test also confirms that the saved session belongs to the named allowlisted account before loading the retained record. Never commit the storage-state file; delete it after the gate because it contains an authenticated session.

Verify one database record, queued run, private artifact, review packet, decision, receipt, notification, and—only if intended—Stripe test invoice.

## Operator and recovery

- `/api/health?deep=1` is healthy and reports schema `202607260007`.
- Runner deep health is healthy and matches the deployed runner version.
- RUNS, REVIEWS, and INVOICES can each be paused and resumed with a recorded reason.
- Backup completes and restore verification succeeds.
- The incident owner, technical lead, privacy/legal contact, and tester communications owner are reachable.
- The fallback synthetic walkthrough and screenshots work while RUNS is paused.
