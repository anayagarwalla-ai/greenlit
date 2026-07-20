# MilestoneProof agency beta-readiness audit

Date: 2026-07-20

## Remediation update

This document preserves the pre-remediation audit and its screenshots. The product changes completed later the same day resolve the six P0 product blockers and the listed P1 product controls: custom account-bound staging verification, typed check mapping, durable agency accounts/dashboard, remote decision visibility, revocable/extendable review links, invite/rate/global-capacity controls, operator triage, in-product feedback, legal/provider tier copy, and mobile header cleanup. The remaining launch dependencies require the operator's identity, support address, invite list, provider/billing choices, and legal review; see `docs/BETA_OPERATIONS.md` and the current handoff.

## Verdict

At the time these screenshots were taken, MilestoneProof was ready only for invited agencies to evaluate the synthetic walkthrough. This verdict is the baseline that drove the remediation above; it is not the current implementation status.

## Audited flow

1. Landing and demo entry — healthy for a guided product demonstration.
2. SOW intake — polished, but the unpaid Gemini boundary restricts input to synthetic or expressly non-confidential material.
3. Criteria review — healthy source grounding and editing; custom criteria cannot yet be mapped to a real target.
4. Verification evidence — strong explanation of failure and evidence boundaries; current executable path is the included fixture only.
5. Client review handoff — clear for the synthetic walkthrough; real review packets lack owner-side status management.
6. Client review — clear and trustworthy on desktop.
7. Approval dialog — strong intent and electronic-record confirmations; small supporting text should be checked for contrast and mobile readability.
8. Mobile client review — usable at 390px, but the header is crowded and needs a small responsive cleanup.

## P0 blockers for a real-project beta

1. Build custom target verification end to end: staging URL, origin token, check mapping, and server/runner support for user-confirmed typed checks.
2. Add durable agency identity and access: sign-in, project/history dashboard, multi-record access, recovery, and sessions longer than the current single 24-hour owner cookie.
3. Add owner-side decision visibility: status polling or notifications, approval/change-request history, and owner access to receipts/exports.
4. Add invite-only capacity and abuse controls: per-user/IP analysis and run limits, a daily browser budget, queue/retry visibility, and basic error monitoring. Cloudflare Workers Free currently permits only 10 browser minutes per day.
5. Keep the first real beta limited to redacted/non-confidential acceptance sections, or move Gemini to a paid-data-processing arrangement/BYO provider before accepting client-confidential SOWs.
6. Add an operational contact and workflow for support, privacy requests, incidents, and failed jobs; the form currently records requests but there is no operator-facing workflow in the product.

## P1 improvements during the first beta

- Add an in-product feedback control that includes the current step and record ID.
- Explain supported and unsupported check types before SOW import.
- Let owners revoke, resend, and extend review links.
- Add a narrow beta onboarding checklist for staging ownership verification.
- Tighten the mobile review header and validate contrast, keyboard navigation, zoom/reflow, and screen-reader output with dedicated accessibility testing.
- Add privacy-respecting funnel events for import, criteria confirmation, run success/failure, review creation, and final decision.
- Replace hackathon-only product and legal copy with the real operator identity, support contact, beta eligibility, and pilot terms reviewed for the launch jurisdiction.

## Existing strengths

- Exact source quotes remain visible while criteria are confirmed or edited.
- AI cannot directly generate executable JavaScript; the runner accepts typed, validated checks.
- Review links use fragment bearer tokens exchanged for HttpOnly sessions.
- Results, evidence metadata, snapshots, decisions, and audit events are hashed and retained under documented policies.
- The synthetic walkthrough is clearly labeled and does not claim retained evidence.
- Live pages produced no MilestoneProof console errors during this audit.

## Evidence limits

At the time of the baseline audit, testing covered the production synthetic path, code-backed API behavior, responsive review layout at 390px, and console errors. It did not create a new real transaction or execute a custom browser run because custom target mapping had not yet been implemented and free runner capacity was constrained. The later remediation added that workflow, but these historical screenshots do not establish full WCAG compliance, penetration-test results, or legal compliance.
