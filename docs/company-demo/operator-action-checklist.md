# Founder-required action checklist

These items require identity, commercial authority, provider access, counsel, or a real external account. The product must not begin external invitations until all release-blocking items are complete.

## Completed without founder input

- [x] Supabase project is healthy, remote migrations match the repository through `202607260008`, the clean-database regression suites pass, and the linked schema linter is clean.
- [x] Cloudflare runner is deployed with independent runner/cron secrets, the browser binding, `milestoneproof-jobs` producer and consumer, and all three maintenance schedules.
- [x] Vercel production and preview access lists use the authenticated owner account; high-impact secrets were rotated and synchronized without displaying them.
- [x] The existing production deployment was rebuilt after provider configuration changes. The new working-tree web release remains a preview until the legal/operator fields below are supplied.
- [x] Automated application, accessibility, responsive, security, release, backup/restore-script, and production-build gates are implemented and passing on supported local browsers.
- [x] Editable pitch deck, tagged one-page brief, synthetic screenshots, and silent outage-fallback video are generated and visually reviewed.

## Release-blocking

- [ ] Choose the operating legal entity/name and public operator name.
- [ ] Create and monitor the support/security email.
- [ ] Obtain counsel review of Terms, Privacy Notice, retention, incident notification duties, electronic-record language, and the selected pilot offer.
- [ ] Choose the pilot price and no-auto-renewal/refund/tax terms.
- [ ] Name the four incident roles.
- [ ] Confirm paid Gemini API terms or keep the deployment explicitly restricted to synthetic/redacted/non-confidential input.
- [ ] Supply the remaining real-world legal/contact values and operational confirmations from `.env.example`.
- [ ] Promote the exact tested web preview only after those real-world values pass the production preflight.
- [ ] Execute backup plus restore verification.
- [ ] Complete one retained production transaction with an authorized allowlisted test account.
- [ ] Verify link scanners and email security tools do not consume review or receipt access unexpectedly.
- [ ] Exercise Stripe in test mode, including duplicate-customer recovery and webhook status.

## Before the first outreach message

- [ ] Approve the ICP, design-partner offer, demo claims, follow-up email, and pitch collateral.
- [ ] Choose two or three target agencies with a suitable public-staging workflow.
- [ ] Rehearse the 20-minute runbook and the outage fallback.
- [ ] Record and review the 90-second fallback video.
- [ ] Decide where meeting notes and request ownership will be tracked.
- [ ] Confirm operator capacity for onboarding, support, incidents, and weekly feedback.

## Later enterprise work

- [ ] Decide whether to pursue SOC 2, SSO, DPAs, data residency, SLAs, and procurement requirements only after design-partner evidence justifies them.
