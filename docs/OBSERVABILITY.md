# Greenlit observability and release evidence

This runbook defines the minimum signals for a company demo and closed design-partner beta. It does not replace provider monitoring or an on-call owner.

## Health contracts

- `GET /api/health` is a cached **liveness** probe only. It proves the web process can answer and returns the web version. It does not authorize a beta invitation.
- `GET /api/health?deep=1` with `Authorization: Bearer $CRON_SECRET` is the protected **readiness** probe. `ok` covers deployed service health; `readyForBeta` additionally requires legal, provider, secret, workflow-control, and paid Gemini configuration.
- Run `HEALTHCHECK_BASE_URL=https://YOUR-DOMAIN CRON_SECRET=... pnpm ops:health` from a restricted monitor. The command exits nonzero and lists only failed check names when the deployment is not ready.
- Never place `CRON_SECRET`, health-response details, or authenticated monitor output in a public status page.

## Alert thresholds

Treat these as blocking for a real retained demo:

| Signal | Warning | Blocking |
| --- | --- | --- |
| Protected readiness | One failed probe | Two consecutive failed probes or any `readyForBeta=false` before a meeting |
| Verification queue | Active for 8 minutes | Active for 12 minutes or any unacknowledged failed job |
| Notification / invoice job | One retry | Failed or stranded for 10 minutes |
| Retention heartbeat | Older than 30 hours | Missing or failed at 36 hours |
| Invoice / notification heartbeat | Older than 2 hours | Missing or failed at 3 hours |
| Evidence capacity | 80% of configured limit | At or above the configured admission limit |
| Daily run capacity | 75% of configured limit | No capacity for the planned demo plus one recovery run |
| HTTP errors | Any repeated route-specific error | A core workflow route fails twice in the same session |

The public synthetic walkthrough remains the fallback when a blocking retained-demo signal is active.

## Request and product evidence

- The request proxy assigns a fresh `x-request-id` to accepted and rejected requests. Record the ID with the timestamp and page when investigating an incident; do not add personal data to logs.
- The private operator console shows unresolved operational events and a privacy-safe 30-day scorecard for demo requests, completed analyses, completed verifications, and client decisions.
- Product-event properties use an explicit allowlist. Email addresses, names, agency names, source text, URLs, access codes, and billing details are excluded.
- The release gate writes `artifacts/release/release-manifest.json` with the exact Git commit, lockfile hash, migration range, runner version, and database version. Tagged `v*` releases run the same gate.

## Meeting-day evidence

Before a company meeting:

1. Confirm the release-gate artifact belongs to the deployed commit.
2. Run the protected readiness check.
3. Confirm the three maintenance heartbeats and empty failure queues in the operator console.
4. Open the synthetic walkthrough, sample review, sample receipt, deck, one-page brief, and fallback video locally.
5. If any retained-demo gate is blocking, use only the synthetic path and say so explicitly.

## External monitor still required

A responsible operator must configure a restricted scheduler or monitoring provider to run the readiness command, deliver alerts to a monitored channel, and name the primary and backup responders. Provider setup is not considered complete until one forced failure produces a received alert and a recovery notification.
