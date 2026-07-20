# MilestoneProof

**Turn your SOW into proof.** MilestoneProof turns acceptance criteria into human-confirmed browser checks, evidence a client can understand, a recorded approval, and an invoice-ready proof record.

The repository contains a complete judge-first vertical slice for the Blueprint Hackathon:

- a polished agency workspace and guided demo;
- a live Gemini SOW import with paste and PDF/TXT/Markdown upload;
- editable, independently source-grounded criteria with human confirmation gates;
- six source-grounded, typed acceptance checks;
- two real staging fixtures, including a deceptive UI-success/API-failure bug;
- a client review and approval flow;
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

If Gemini is unavailable, click **Launch the reliable guided demo**. It uses clearly labeled synthetic criteria and the real production verification runner. Custom imported SOWs stop at the staging-configuration handoff until their own verified origin and typed checks are connected; they never inherit the synthetic fixture’s results.

### Hosted build

- **Product:** [milestoneproof.vercel.app](https://milestoneproof.vercel.app)
- **Runner health:** [milestoneproof-runner.anay-agarwalla-581.workers.dev/health](https://milestoneproof-runner.anay-agarwalla-581.workers.dev/health)

The production build is connected to a Cloudflare Queue and Browser Run worker with signed HMAC callbacks. The deployed flow records each run, result, evidence hash, review packet, and client decision in Supabase. Gemini has an eight-second deadline and a local, source-grounded analysis fallback; verification still requires the deployed database and runner.

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
- **Database/storage:** create a Supabase project and apply both migrations in `supabase/migrations/` in filename order. The current public workflow uses server-only service-role access; anonymous database access is not required.
- **Runner:** create the queue with `wrangler queues create milestoneproof-jobs`, set `RUNNER_HMAC_SECRET`, then run `pnpm runner:deploy`.
- **Retention:** set `CRON_SECRET`; the daily Vercel cron purges expired evidence, privacy requests, and transaction records unless a legal hold applies.
- **AI:** set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in Vercel. The default is the latency-optimized `gemini-3.1-flash-lite`; calls have an 8-second deadline and fall back to a local, source-grounded draft when Gemini is unavailable. Free-tier use requires the non-confidential-data, provider-use, and 18+/business/terms acknowledgments.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries, [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md) for the timed video script, [docs/DEVPOST_SUBMISSION.md](docs/DEVPOST_SUBMISSION.md) for submission copy, and [docs/JUDGING_NOTES.md](docs/JUDGING_NOTES.md) for the official-rubric walkthrough.

## Data policy

The free-tier build is for synthetic, demo, or explicitly non-confidential material only. Uploaded documents are extracted in memory and are not persisted by the analysis route; Google may still process eligible free-tier Gemini inputs under its terms. Screenshot evidence defaults to 90 days, approval/audit records to four years, and review links to 72 hours, with legal-hold support and daily retention cleanup. MilestoneProof is not a legal e-signature, payment guarantee, invoice, or WCAG certification. See [docs/LEGAL_READINESS.md](docs/LEGAL_READINESS.md).
