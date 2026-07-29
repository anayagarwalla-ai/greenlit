# Judging notes and rubric map

The official rubric scores 12 project dimensions at 0 to 4 points (48 total) plus three video dimensions at 0 to 2 points (6 total). These notes are a presenter checklist, not claims of a guaranteed score.

## Technical achievement (12 points)

### Innovation and creativity

- Lead with the category shift: the SOW is the acceptance interface, not a test suite or generic AI chatbot.
- Show the exact-quote invariant and the false-success/API-failure reveal.
- Explain the four authorities: Gemini drafts, the agency confirms, the browser observes, and the client decides.

### Technical complexity

- Gemini structured output → Zod validation → independent source grounding → editable confirmation state.
- PDF/TXT/Markdown extraction with size, type, confidentiality, and text-length gates.
- Shared typed-check contracts instead of arbitrary model-generated code.
- Signed Vercel → Cloudflare Queue → Browser runner → callback path.
- Origin ownership, DNS/private-network rejection, evidence hashing, RLS, private storage, and expiry.

### Scalability

- Stateless Next.js web/API layer on Vercel.
- Queue-backed execution separates user requests from browser work and absorbs bursts.
- Workers can scale independently from the web app; the database stores frozen revisions and compact metadata.
- Evidence retention is bounded; original source is kept out of logs.

## Implementation (12 points)

### Code quality

- TypeScript end to end, shared Zod contracts, small domain helpers, strict typed evidence families.
- Gemini concerns, browser runner, persistence, UI, and fixtures are separate packages/routes.
- Point judges to `apps/web/lib/analysis.ts`, `packages/contracts`, and `workers/runner`.

### Documentation

- README: product, setup, hosted URLs, validation, deployment, and data policy.
- `docs/ARCHITECTURE.md`: data flow, trust boundaries, and status model.
- `docs/JUDGE_DEMO.md`: timed 2 to 5 minute video script.
- `docs/DEVPOST_SUBMISSION.md`: ready-to-paste submission copy.

### System architecture

- Show the Mermaid diagram in `docs/ARCHITECTURE.md`.
- Emphasize that the web service never sends executable test code through the queue.
- Queue messages carry a job ID; the runner leases the already validated frozen revision.

## User experience (12 points)

### Interface design

- Capture both desktop and mobile screenshots.
- Show the two-column source/criteria review, compact status language, progress stepper, and client-facing review.
- The guided walkthrough is a reliable, clearly labeled presentation fallback; it never claims seeded outcomes are real evidence.

### Accessibility

- Semantic headings, landmarks, labeled fields, visible focus styles, real buttons, `aria-pressed`, `aria-live`, and status roles.
- Full keyboard path through import, confirmation, verification, and approval.
- High-contrast status colors are paired with text/icons; reduced-motion CSS is included.
- Be precise: the product demonstrates accessibility care but does not claim formal WCAG certification.

### User flow

- One narrative: source → criteria → verification → client decision → approval record.
- Errors are actionable: confidentiality gate, unsupported/oversized file, scanned PDF fallback, missing Gemini, ungrounded quote, and custom-origin handoff.
- Custom scopes never inherit the synthetic fixture’s results.

## Project completion (12 points)

### Feature completeness

- Real production Gemini analysis and file/paste intake.
- Editable, human-confirmed criteria with exact source quotes.
- Two staging fixtures, failing and passing evidence reports, client review, approval, and receipt.
- Production schema, queue, runner, HMAC callbacks, and health endpoint are deployed.

### Testing

- Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` immediately before submission.
- Unit coverage includes source normalization/grounding, staging URL validation, private-address rejection, and shared contracts.
- Production smoke test should cover live Gemini analysis, all guided-demo transitions, client approval, receipt, mobile layout, and runner health.

### Deployment

- App: https://greenlitproof.vercel.app
- Repository link (make public before submission): https://github.com/anayagarwalla-ai/greenlit
- Runner health: https://milestoneproof-runner.anay-agarwalla-581.workers.dev/health (legacy infrastructure hostname)
- Mention the repeatable deployment files: `vercel.json`, `wrangler.toml`, Supabase migration, and README commands.

## Video evaluation (6 points)

### Problem statement

Use one sentence and one consequence: agencies finish the work but wait to invoice because proof is fragmented and clients do not speak CI.

### Solution demo

Show, do not enumerate: live Gemini import, grounding lock, false-success catch, fixed rerun, client approval, receipt.

### Technical explanation

Spend the final 20 seconds on the trust boundary and architecture. Name Gemini, typed checks, HMAC queue/runner, Supabase RLS/private storage, and the deterministic fallback.

## Judge-facing answers

**Why is this not just Playwright with an AI prompt?**  Playwright starts from test code. Greenlit starts from the client’s contractual language, requires exact source grounding and bilateral scope confirmation, then translates evidence back into a client decision and invoice-ready record.

**Can Gemini execute anything?**  No. Gemini returns structured criterion drafts only. It cannot submit selectors, JavaScript, credentials, headers, or off-origin actions. Human-confirmed data must pass a shared typed schema before the runner sees a job ID.

**Are the demo results real?**  There are two distinct paths. The production queue/lease/browser/callback path creates retained evidence from the included synthetic fixture. The always-available guided walkthrough uses seeded outcomes, labels them on every result/review/receipt screen, and creates no transaction record. A custom imported SOW stops at staging setup until its own origin and checks are configured.

**What data goes to Gemini?**  Only text the user explicitly pasted or uploaded after attesting that it is synthetic or non-confidential. It is processed in memory and omitted from verification logs. This free-tier build is not for confidential client documents.

**What business value is measurable?**  The first production KPI would be median time from agency “ready” to client decision, with guardrails for change requests, false-positive verification, and value waiting for approval.

**Did you enable paid services?**  No. The submission uses free-tier resources and the guided demo remains functional if an optional integration is unavailable.
