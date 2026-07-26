# Greenlit

**Turn your SOW into proof.** Greenlit turns acceptance criteria into human-confirmed browser checks, evidence a client can understand, a recorded approval, and an invoice-ready proof record.

The repository contains a complete judge-first vertical slice for the Blueprint Hackathon:

- a polished agency workspace and guided demo;
- a live Gemini SOW import with paste and PDF/TXT/Markdown upload;
- editable, independently source-grounded criteria with human confirmation gates;
- six source-grounded, typed acceptance checks;
- two real staging fixtures, including a deceptive UI-success/API-failure bug;
- a client review and approval flow;
- durable magic-link agency accounts, a cross-device dashboard, revocable review links, and in-app client-decision notifications;
- custom public-HTTPS staging verification with account-bound origin proofs and explicit typed-check mappings;
- beta feedback, operator triage, invite allowlists, abuse limits, and global free-tier capacity controls;
- an accessible approval record that prints cleanly to PDF;
- a Gemini structured-output adapter with exact-quote grounding;
- a Cloudflare Queue + Browser Run worker;
- a Supabase schema, private evidence storage, row-level security, legal holds, and automated retention;
- shared Zod contracts and security tests.

## Demo

1. Open `/workspace`, load the synthetic sample, and generate live criteria with Gemini.
2. Review the exact citations, click **Confirm grounded**, and run the matching staging fixture.
3. Inspect AC-04: the page claims success, but `POST /api/fixture/leads` returned 500.
4. Verify the fixed `launch-rc2` build; all six checks pass.
5. Create the client review, approve as Mara Chen, and open the invoice-ready record.

If Gemini or free browser capacity is unavailable, click **Launch the reliable guided demo**. It uses clearly labeled seeded outcomes and creates no browser-evidence or transaction record. Custom imported SOWs require an agency account, a one-time ownership file at `/.well-known/greenlit.txt`, and a typed mapping for every automated promise; manual promises remain explicitly client-reviewed.

### Hosted build

- **Product:** [greenlitproof.vercel.app](https://greenlitproof.vercel.app)
- **Runner health:** [milestoneproof-runner.anay-agarwalla-581.workers.dev/health](https://milestoneproof-runner.anay-agarwalla-581.workers.dev/health) (legacy infrastructure hostname)

The production build is connected to a Cloudflare Queue and Browser Run worker with signed HMAC callbacks. The real verification flow records each run, result, evidence hash, review packet, and client decision in Supabase. Gemini has a short deadline and a local, source-grounded analysis fallback; real verification still requires the deployed database and runner.

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000/workspace`. The Gemini key is only needed for `POST /api/analyze`; the guided demo does not require it. Use synthetic or explicitly non-confidential source material only.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## Deployment

- **Web/API:** import this repository into Vercel with the repository root as the project root. `vercel.json` contains the monorepo build settings.
- **Database/storage:** create a Supabase project and apply all migrations in `supabase/migrations/` in filename order. Configure Supabase Auth Site URL and redirect URLs for `/auth/callback`. Application data remains server-only; authenticated browser sessions are used only for account identity.
- **Runner:** create the queue with `wrangler queues create greenlit-jobs`, set `RUNNER_HMAC_SECRET`, then run `pnpm runner:deploy`.
- **Scheduled recovery:** set the same distinct `CRON_SECRET` on the web app and runner. Cloudflare Cron Triggers run daily retention and hourly invoice/outbox recovery without requiring a paid Vercel plan. Retention purges expired evidence, privacy requests, and transaction records unless a legal hold applies.
- **AI:** set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in Vercel. The default is the latency-optimized `gemini-3.1-flash-lite`; calls have an 8-second deadline and fall back to a local, source-grounded draft when Gemini is unavailable. Free-tier use requires the non-confidential-data, provider-use, and 18+/business/terms acknowledgments.
- **Stripe invoicing (optional):** create a backend-only Stripe App with customer, invoice, and event access; set `STRIPE_APP_CLIENT_ID`, its external-test `STRIPE_APP_INSTALL_URL`, a test-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and a random base64 32-byte `STRIPE_TOKEN_ENCRYPTION_KEY`. Keep `STRIPE_ALLOW_LIVE_MODE=false` for beta testing. Register `/api/stripe/callback` as the OAuth callback and `/api/stripe/webhook` for invoice and deauthorization events.
- **Closed beta:** set `BETA_ALLOWED_EMAILS`, `ADMIN_EMAILS`, `NEXT_PUBLIC_OPERATOR_NAME`, and `NEXT_PUBLIC_SUPPORT_EMAIL`. Daily defaults are 8 retained browser runs and 100 analyses globally; tune them with `BETA_DAILY_RUN_LIMIT` and `BETA_DAILY_ANALYSIS_LIMIT` without enabling paid services.
- **Notifications:** every client decision appears in-app. Optionally set a public HTTPS webhook URL, a webhook secret, and the disclosed provider name for immediate external delivery; failed deliveries remain in the outbox and are retried by the bounded hourly notification job.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries, [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md) for the timed video script, [docs/DEVPOST_SUBMISSION.md](docs/DEVPOST_SUBMISSION.md) for submission copy, and [docs/JUDGING_NOTES.md](docs/JUDGING_NOTES.md) for the official-rubric walkthrough. Beta operators should also use [docs/BETA_OPERATIONS.md](docs/BETA_OPERATIONS.md) and [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md).

## Agency resources

The public `/resources` center contains the agency quick-start, client reviewer guide, milestone templates, acceptance-criteria guide, approval email pack, beta handbook, FAQ, integration and troubleshooting playbooks, and an approval-delay calculator. Founder-only sales, case-study, and demo-production materials remain in the internal beta and company-demo kits. `/trust` provides the plain-language security and beta-boundary overview.

The internal [beta operating kit](docs/beta-kit/README.md) contains onboarding, interview, weekly reporting, severity triage, success measurement, case-study permission, office-hours, pricing, inactivity follow-up, and video-production templates. It must not contain client SOW text, credentials, review access codes, or regulated data.

The internal [company-demo kit](docs/company-demo/README.md) contains the 20-minute runbook, design-partner offer draft, reset and production-smoke checklists, trust brief, follow-up copy, fallback-video shot list, and founder-required action list. Run `pnpm demo:preflight` before rehearsals and run it with `DEMO_PREFLIGHT_PRODUCTION=1` inside the production environment before external invitations.

## Data policy

The free-tier build is for synthetic, redacted, or explicitly non-confidential material only. Uploaded documents are extracted in memory and are not persisted by the analysis route; Google may still process eligible unpaid-tier Gemini inputs under its terms. Screenshot evidence defaults to 90 days, approval/audit records to four years, and review links to 72 hours (extendable within a 14-day hard limit), with legal-hold support and daily retention cleanup. Greenlit can create an invoice in an agency’s connected Stripe account, but it is not a legal e-signature, payment guarantee, accounting ledger, or WCAG certification. See [docs/LEGAL_READINESS.md](docs/LEGAL_READINESS.md).
