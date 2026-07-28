# Devpost submission copy

## Project name

Greenlit

## Tagline

Turn every SOW promise into client-ready proof.

## Elevator pitch (198 characters)

Greenlit uses Gemini to turn a statement of work into human-confirmed acceptance criteria, verify each promise against staging, and give clients evidence they can approve before the agency invoices.

## Inspiration

Agencies rarely wait to invoice because nobody shipped the work. They wait because “done” is trapped across a contract, a staging link, QA notes, email threads, and a client’s subjective review. That creates approval limbo: engineers know the build is finished, account managers cannot produce a clean proof packet, and clients do not want to read CI logs.

We wanted to make the statement of work—not the test suite—the center of acceptance.

## What it does

Greenlit gives an agency one guided flow:

1. Paste a non-confidential SOW excerpt or upload a selectable-text PDF, TXT, or Markdown document.
2. Gemini extracts atomic, measurable acceptance criteria and returns an exact supporting source quote, evidence type, and rationale for each one.
3. Greenlit independently grounds every quote against the extracted source. A human can edit and must confirm every criterion; ungrounded quotes cannot be frozen.
4. Confirmed promises are mapped only to safe, typed browser checks—never model-generated scripts.
5. An isolated staging run captures the observed outcome and integrity metadata for every promise.
6. The client receives a focused, no-login review packet and makes one clear decision: approve the milestone or request changes.
7. Approval creates an invoice-ready proof record tying together the SOW revision, build, evidence, decision, timestamp, and milestone amount.

The included demo deliberately contains a deceptive bug: the contact form shows “success” while its lead request returns HTTP 500. Greenlit catches the contradiction, then proves the fixed build against the same frozen scope.

For arbitrary imported SOWs, the agency proves ownership by serving a one-time token from the staging hostname, maps accessible labels and same-origin paths into typed checks, and explicitly authorizes any test-form mutation. It never presents fixture results as proof of a customer’s real project. A clearly labeled, non-retained synthetic walkthrough remains available if free runner capacity is unavailable.

## How we built it

The frontend and API are a TypeScript/React application built with Next.js and deployed on Vercel. The Gemini API uses structured JSON output with a low-temperature extraction prompt and Zod validation. PDF text extraction happens server-side and is limited to selectable-text files under 3 MB. Original source text is processed in memory and excluded from verification logs.

The verification architecture separates orchestration from execution. The web service dispatches a job identifier to a Cloudflare Queue using timestamped HMAC requests. A Cloudflare Worker leases a frozen, typed check revision, runs it in an isolated browser, hashes the evidence manifest, and posts structured results back through a signed callback. Supabase provides the relational schema, private object storage, row-level security, and expiry fields.

Security constraints are part of the product design: staging origins require ownership verification; private and reserved network destinations are rejected; checks allow accessible labels, same-origin paths, and typed assertions but not JavaScript, CSS/XPath selectors, credentials, arbitrary headers, or off-origin actions.

## Challenges we ran into

The hardest design problem was preserving the convenience of AI without letting AI become the authority. A polished paraphrase is dangerous if it changes what a client actually signed, so we made exact source grounding and human confirmation hard gates. PDF extraction also creates inconsistent whitespace, which required normalization that tolerates line wrapping without accepting invented words.

The second challenge was producing a memorable verification demo without overstating what had been proven. We built two controlled staging fixtures: one returns a false visual success with an HTTP 500, and the other fixes the endpoint. Custom SOWs must prove staging ownership and supply their own human-confirmed mapping; only the matching synthetic scope can run the included fixtures.

Finally, we treated the runner as an untrusted boundary. Queue messages carry only a job ID, leases and callbacks are HMAC-signed, execution is constrained by shared schemas, and the worker records evidence without logging document text or form secrets.

## Accomplishments we are proud of

- A real Gemini-powered import flow with paste and PDF/TXT/Markdown upload.
- Editable acceptance criteria with independent exact-quote validation and confirmation invalidation after edits.
- A complete, polished agency-to-client workflow rather than a disconnected AI demo.
- A safe typed-check model and a signed queue/runner architecture.
- Account-bound staging-origin verification and a polished custom check-mapping flow.
- Durable agency accounts, cross-device project history, revocable review links, and remote decision visibility.
- Invite, rate, capacity, feedback, retention, and operator-triage controls designed for a bounded closed beta.
- A failure story judges can see immediately: visible success, real HTTP failure, then proof of the fixed build.
- A responsive, keyboard-usable interface, client review, approval dialog, and printable receipt.
- A live production deployment plus an honest deterministic walkthrough that depends on neither AI nor browser capacity and never claims to be retained evidence.
- Automated tests for schema/security boundaries and source-grounding edge cases.
- No paid services enabled.

## What we learned

AI is most trustworthy when its role is narrow, visible, and reversible. Structured output improves reliability, but the meaningful safeguard is an independent invariant: every model-generated claim must point back to words the user can inspect. We also learned that client acceptance is a translation problem as much as a testing problem—raw technical results become useful only when attached to the promise they prove.

## What is next

- Team collaboration and role-based agency access beyond the current single-owner account.
- Framework adapters for Playwright/Cypress suites that import evidence without importing arbitrary execution.
- Change-order detection when a new SOW revision alters frozen acceptance criteria.
- Agency metrics for approval cycle time, revision causes, and value waiting for approval.
- Optional integrations with project management and invoicing systems, while keeping the approval record distinct from a legal signature or payment guarantee.

## Built with

TypeScript, React, Next.js, Gemini API, Google GenAI SDK, Zod, Cloudflare Workers, Cloudflare Queues, Cloudflare Browser Rendering, Supabase Postgres, Supabase Storage, Vercel, Vitest, ESLint, and pnpm.

## Links

- Live app: https://greenlitproof.vercel.app
- GitHub: https://github.com/anayagarwalla-ai/milestoneproof
- Presentation (PDF): https://github.com/anayagarwalla-ai/milestoneproof/blob/main/docs/hackathon/greenlit-blueprint-hackathon-deck.pdf
- Presentation (PowerPoint): https://github.com/anayagarwalla-ai/milestoneproof/blob/main/docs/hackathon/greenlit-blueprint-hackathon-deck.pptx
- Runner health: https://milestoneproof-runner.anay-agarwalla-581.workers.dev/health (legacy infrastructure hostname)

Add the final public YouTube or Vimeo demo URL to the Devpost video field after recording. Confirm all GitHub presentation links in an incognito window after the repository is public and `main` contains the submission release.

## Suggested Devpost gallery captions

1. **Product overview:** Greenlit connects the SOW, browser evidence, client decision, and invoice-ready approval record.
2. **Human-controlled AI:** Every measurable outcome, exact quote, evidence family, and rationale is editable and must be confirmed.
3. **A false success caught:** The page claimed the form worked, but Greenlit proved its lead request returned HTTP 500.
4. **Proof the client understands:** The review packet translates a passing browser run back into the six promises the client signed.
5. **Invoice-ready, not an invoice:** The approval record binds revision, build, evidence hashes, decision, timestamp, and milestone value.
