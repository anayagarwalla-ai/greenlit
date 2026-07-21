# MilestoneProof production sign-off

Complete this with the adult operator before inviting an agency. Never paste secret values into this document; record only who verified each item, when, and the provider screen or internal ticket used as evidence.

## Identity, contracts, and contacts

- [ ] Publish the adult operator/legal name, monitored support/privacy email, mailing address, governing law, and venue.
- [ ] Adult operator has reviewed the current Terms, Privacy notice, provider terms, and the hosting entitlement for a business beta.
- [ ] Name the incident lead, backup, privacy lead, and tester-communications owner in `docs/INCIDENT_RESPONSE.md`.

## Authentication and delivery

- [ ] Supabase public signup is disabled and an uninvited Auth request is rejected in production.
- [ ] Site URL and callback allowlist contain only the intended production URLs.
- [ ] Custom SMTP is configured; SPF, DKIM, and DMARC pass; magic links reach a non-team agency mailbox.
- [ ] A corporate link scanner does not consume the usable sign-in flow.
- [ ] `BETA_ALLOWED_EMAILS` and `ADMIN_EMAILS` were reviewed by the adult operator; removed invitees are removed from Auth as appropriate.

## Secrets and deployments

- [ ] `RECORD_HASH_SECRET` is separate from `RUNNER_HMAC_SECRET`; web and runner HMAC values match.
- [ ] Gemini is labeled with the actual unpaid/paid service tier and no paid Cloudflare/Vercel/Supabase service was enabled accidentally.
- [ ] `/api/health` is green and reports the expected web, runner `0.6.0`, and database `202607210003` versions.
- [ ] GitHub release-gate CI passes typecheck, lint, unit tests, build, and migration/state-machine tests.
- [ ] Production migration history contains every file in `supabase/migrations` exactly once.

## Capacity, recovery, and retention

- [ ] Run limit is 3/day, checks are capped at 6/run, and testers know what the capacity message means.
- [ ] Retention cron has a successful heartbeat within 36 hours; notification and stale-job queues are empty.
- [ ] Postgres and private evidence storage have encrypted off-site backups with restricted access.
- [ ] A backup was restored into an isolated environment and one record, audit chain, and screenshot hash matched.
- [ ] Protected `/api/health?deep=1` successfully launched the deployed browser binding; the result and timestamp were recorded without exposing `CRON_SECRET`.
- [ ] Supabase Free pause-warning email is monitored; the adult operator and backup know how to resume and what testers see during a pause.
- [ ] Production legacy source-document rows and bucket objects were inventoried, securely removed, and the result logged.

## Acceptance transaction

- [ ] Adult-authorized production flow passed: invited external login → redacted SOW → Gemini → owned staging origin → real run/evidence → separate client browser → decision → dashboard → receipt/JSON → privacy export.
- [ ] Evidence screenshots and audit/receipt hashes were inspected; exact currency cents remained correct.
- [ ] Privacy access, correction, hold, deletion scheduling, notification retry, stranded-job expiry, and failed-deletion retry were tested without manual database edits.
