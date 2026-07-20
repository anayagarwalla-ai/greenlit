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
- a Supabase schema, private buckets, row-level security, and seven-day expiry fields;
- shared Zod contracts and security tests.

## Demo

1. Open `/workspace`, load the synthetic sample, and generate live criteria with Gemini.
2. Review the exact citations, click **Confirm grounded**, and run the matching staging fixture.
3. Inspect AC-04: the page claims success, but `POST /api/leads` returned 500.
4. Verify the fixed `launch-rc2` build; all six checks pass.
5. Create the client review, approve as Mara Chen, and open the invoice-ready record.

If Gemini is unavailable, click **Launch the reliable guided demo**. The fallback is intentionally self-contained and clearly labels itself as seeded demo data. Custom imported SOWs stop at the staging-configuration handoff until their own verified origin and typed checks are connected; they never inherit the synthetic fixture’s results.

### Hosted build

- **Product:** [milestoneproof.vercel.app](https://milestoneproof.vercel.app)
- **Runner health:** [milestoneproof-runner.anay-agarwalla-581.workers.dev/health](https://milestoneproof-runner.anay-agarwalla-581.workers.dev/health)

The production build is connected to a Cloudflare Queue and Browser Run worker with signed HMAC callbacks. The deployed smoke path has been verified through dispatch, queue lease, browser execution, and completion callback. The Supabase production schema and row-level-security policies are also applied; the guided demo remains available if any optional cloud integration is unavailable.

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
- **Database/storage:** create a Supabase project and apply `supabase/migrations/202607190001_initial.sql`. Enable anonymous sign-ins.
- **Runner:** create the queue with `wrangler queues create milestoneproof-jobs`, set `RUNNER_HMAC_SECRET`, then run `pnpm runner:deploy`.
- **AI:** set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in Vercel. Free-tier use is gated behind the synthetic/non-confidential data attestation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for trust boundaries, [docs/JUDGE_DEMO.md](docs/JUDGE_DEMO.md) for the timed video script, [docs/DEVPOST_SUBMISSION.md](docs/DEVPOST_SUBMISSION.md) for submission copy, and [docs/JUDGING_NOTES.md](docs/JUDGING_NOTES.md) for the official-rubric walkthrough.

## Data policy

The free-tier build is for synthetic, demo, or explicitly non-confidential material only. Uploaded documents are extracted in memory and are not persisted by the analysis route; document text is excluded from verification logs. Evidence and approval records include seven-day expiry fields. MilestoneProof is not a legal e-signature, payment guarantee, invoice, or WCAG certification.
