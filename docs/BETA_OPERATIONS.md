# Closed-beta operations runbook

This runbook is the minimum operating cadence for inviting web agencies. Assign one named operator and one backup before sending invitations.

## Before the first invitation

- Set `BETA_ALLOWED_EMAILS` to the exact business emails invited to use the retained workflow.
- Set `ADMIN_EMAILS`, `NEXT_PUBLIC_OPERATOR_NAME`, and `NEXT_PUBLIC_SUPPORT_EMAIL`.
- Confirm the Supabase Site URL is `https://greenlit.vercel.app` and the `/auth/callback` redirect is allowed.
- Keep `BETA_DAILY_RUN_LIMIT=3` and each run at six checks or fewer until measured Cloudflare usage demonstrates safe headroom.
- Confirm `/api/health` reports matching web, database, and runner versions with no stale jobs, notification failures, storage warning, or missing retention heartbeat.
- Run the protected deep check with `Authorization: Bearer $CRON_SECRET` against `/api/health?deep=1` before a cohort launch; it performs a real browser-binding launch without visiting a tester site.
- Verify custom SMTP, sender-domain SPF/DKIM/DMARC, corporate link-scanner behavior, Supabase Auth public signup disabled, and the production callback allowlist.
- Confirm the adult operator has reviewed the current Vercel entitlement and Supabase Free pause/recovery procedure before using the pilot commercially.
- Test one magic-link sign-in, one custom staging ownership file, one passing run, one client decision from a separate browser, and receipt/export access from the agency dashboard.
- Tell testers to use only redacted, synthetic, or expressly non-confidential SOW sections while Gemini remains on the unpaid tier.

## Daily (business days)

1. Open `/admin` and triage new feedback, failed/stuck jobs, privacy requests, operational events, and notification delivery failures.
2. Contact a tester only through the monitored support channel and never copy their SOW text into a ticket.
3. Classify feedback as `REVIEWING`, `RESOLVED`, or `CLOSED` in the operator console.
4. Check Cloudflare Browser Rendering usage before increasing the global run limit. A capacity response is preferable to silently enabling billing.
5. Confirm the daily retention job succeeded. Investigate a missed run before manually deleting any record.
6. Check the evidence-storage guardrail and stop new retained runs before private storage reaches 850 MB.

## Weekly

- Review invite membership and remove departed or unintended users.
- Review Supabase Auth users, Vercel project members, Cloudflare members, and repository access.
- Export and spot-check one approval record against its audit-chain head.
- Review failed jobs for repeated causes and update the tester guidance.
- Check dependency and platform security notices.
- Create an encrypted database/evidence backup and run the isolated restore test described in `docs/BACKUP_RESTORE.md`.

## Privacy-request handling

The in-product form creates an intake record; it does not complete the request automatically.

1. Verify the requester through the monitored business email before disclosing or deleting data.
2. Locate account, transaction, reviewer, feedback, and operational records using the verified email and record identifiers.
3. Check whether a contractual or legal hold limits deletion.
4. Assign an owner, update status, and record concise internal notes and the completion time in the privacy-request queue.
5. Send the response through the monitored support channel. Do not put exported personal data into an unauthenticated link.

Scheduling deletion immediately removes eligible ancillary account data and makes account-owned records due for hold-aware staged deletion. Auth cleanup runs only after those records are gone. Reviewer-only matches are retained for an explicit operator retain/deny decision so one client cannot erase another agency's legal transaction.

## Beta pause criteria

Pause new retained runs and keep only the synthetic walkthrough available if any of the following occurs: suspected credential exposure, cross-account access, unexplained audit-chain mismatch, repeated evidence upload loss, uncontrolled provider billing, an unhandled privacy request, or a provider-terms change that conflicts with the current notice.
