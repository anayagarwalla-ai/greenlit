# Fresh beta audit — implementation status

Updated: July 21, 2026

The audit's locally achievable product, security, privacy, accessibility, testing, and operations work is implemented. The reviewer-age change was deliberately excluded at the user's request; the existing business-owner attestation and published 18+ Terms remain unchanged, and the authorized adult operator must conduct the real acceptance transaction.

## Implemented

- Account-only record authorization; legacy owner-cookie access retired and cleared.
- Server-gated invitation provisioning, persistent invite/removal ledger, fresh access checks on every protected mutation, and versioned public-signup disablement.
- Expiring/revocable review links, per-packet cookies, narrow 30-day receipt sessions, recomputed snapshot integrity, and receipt-to-decision-audit binding.
- Atomic queue/lease/complete/fail/expire/retry/review/decision transitions with active-job, lineage, criteria-revision, result, evidence, and manifest guards.
- Runner version `0.6.0`, six-check/48-second limits, isolated browser contexts, hydration/layout waits, real Axe, same-origin egress policy, connected-address/DNS-rebinding validation, and individual compressed evidence uploads.
- Owner/reviewer/feedback privacy discovery and export; separate legal-hold matters; append-only corrections; hold-aware staged deletion; account-owner cleanup queue; and protection against a reviewer deleting another agency's legal record.
- Claim-based notification delivery with attempt history, stranded-job recovery, visible deletion failures, durable maintenance heartbeats, privacy-safe product events, capacity/storage health, and a protected real browser-launch readiness check.
- Draft/file handoff through sign-in, account/project isolation, 24-hour disclosed handoff, local-source merge on resume, active review recovery, evidence-capture consent, and blank real imports.
- Narrow/mobile/keyboard/contrast/touch-target/evidence semantics and inspection corrections covered by the desktop/mobile browser suite.
- GitHub release gate, encrypted database/evidence backup tooling, isolated restore verification, and guarded legacy source inventory/purge tooling.
- Dependency audit clean, including patched PostCSS and Sharp/libvips versions.

## Verified locally

- TypeScript, ESLint, production build, and whitespace checks pass.
- Unit tests: contracts 7, web 74, runner 8.
- Browser regression: 20 desktop/mobile tests pass; two retained-production tests are intentionally gated on real credentials/record IDs.
- Every migration applies from zero on Postgres 18.
- Twelve functional database checks pass, including state transitions, incomplete/stale protections, decision/receipt atomicity, retry lineage, legal holds, deletion recovery, and owner-versus-reviewer privacy deletion isolation.

## External production sign-off still required

These facts or external-provider actions cannot be fabricated in code: publish the father's/operator's legal identity, address, governing law/venue, and monitored support/privacy contact; configure/test production SMTP; confirm the hosting entitlement; choose a restricted off-site backup destination and perform/record a restore; review real invite/admin membership; inventory/purge any production legacy source data; verify the production migration ledger and Auth dashboard settings; and have the authorized adult complete the retained production acceptance transaction. Use `docs/PRODUCTION_SIGNOFF.md`.
