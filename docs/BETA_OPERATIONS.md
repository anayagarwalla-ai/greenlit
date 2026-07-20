# Closed-beta operations runbook

This runbook is the minimum operating cadence for inviting web agencies. Assign one named operator and one backup before sending invitations.

## Before the first invitation

- Set `BETA_ALLOWED_EMAILS` to the exact business emails invited to use the retained workflow.
- Set `ADMIN_EMAILS`, `NEXT_PUBLIC_OPERATOR_NAME`, and `NEXT_PUBLIC_SUPPORT_EMAIL`.
- Confirm the Supabase Site URL is `https://milestoneproof.vercel.app` and the `/auth/callback` redirect is allowed.
- Keep `BETA_DAILY_RUN_LIMIT=8` and `BETA_DAILY_ANALYSIS_LIMIT=100` until actual usage demonstrates safe headroom.
- Test one magic-link sign-in, one custom staging ownership file, one passing run, one client decision from a separate browser, and receipt/export access from the agency dashboard.
- Tell testers to use only redacted, synthetic, or expressly non-confidential SOW sections while Gemini remains on the unpaid tier.

## Daily (business days)

1. Open `/admin` and triage new feedback, failed/stuck jobs, privacy requests, operational events, and notification delivery failures.
2. Contact a tester only through the monitored support channel and never copy their SOW text into a ticket.
3. Classify feedback as `REVIEWING`, `RESOLVED`, or `CLOSED`; keep a concise resolution note outside MilestoneProof if the operator needs a support system of record.
4. Check Cloudflare Browser Rendering usage before increasing the global run limit. A capacity response is preferable to silently enabling billing.
5. Confirm the daily retention job succeeded. Investigate a missed run before manually deleting any record.

## Weekly

- Review invite membership and remove departed or unintended users.
- Review Supabase Auth users, Vercel project members, Cloudflare members, and repository access.
- Export and spot-check one approval record against its audit-chain head.
- Review failed jobs for repeated causes and update the tester guidance.
- Check dependency and platform security notices.

## Privacy-request handling

The in-product form creates an intake record; it does not complete the request automatically.

1. Verify the requester through the monitored business email before disclosing or deleting data.
2. Locate account, transaction, reviewer, feedback, and operational records using the verified email and record identifiers.
3. Check whether a contractual or legal hold limits deletion.
4. Record the outcome and completion time in the privacy-request queue.
5. Send the response through the monitored support channel. Do not put exported personal data into an unauthenticated link.

## Beta pause criteria

Pause new retained runs and keep only the synthetic walkthrough available if any of the following occurs: suspected credential exposure, cross-account access, unexplained audit-chain mismatch, repeated evidence upload loss, uncontrolled provider billing, an unhandled privacy request, or a provider-terms change that conflicts with the current notice.
