# Provider readiness record — 2026-07-26

This record contains provider identifiers, configuration state, and verification outcomes only. It deliberately excludes secret values.

## Supabase

- Project: `zfwqehopmwczfnccknez` (`MilestoneProof`)
- Status: `ACTIVE_HEALTHY`
- Region/database: `us-west-2`, PostgreSQL 17.6.1
- Migration state: local and linked histories match through `202607260008`
- Schema lint: no errors or warnings
- Independent clean-database gate: all migrations plus all four SQL regression suites passed on PostgreSQL 18

## Cloudflare

- Worker: `milestoneproof-runner`
- URL: `https://milestoneproof-runner.anay-agarwalla-581.workers.dev`
- Queue: `milestoneproof-jobs`, one producer and one consumer
- Bindings: Browser Rendering, queue producer, queue consumer, production web URL
- Configured secret names: `RUNNER_HMAC_SECRET`, `CRON_SECRET`
- Schedules:
  - `17 4 * * *` — retention
  - `7 * * * *` — invoice recovery
  - `37 * * * *` — notification recovery
- Shallow health: HTTP 200, `{"ok":true,"service":"greenlit-runner"}`
- Direct protected deep health: HTTP 200, runner `0.9.0`, browser launch successful (`128.0.6613.137`)
- Latest tested source deployment: runner `0.9.0`, triggers applied successfully

## Vercel

- Project: `milestoneproof` (`prj_uqzehgsSDgA5X0rc6v31rYvlHzfR`)
- Production alias: `https://greenlitproof.vercel.app`
- Production deployment: Ready; rebuilt after access-list, capacity, and secret configuration
- Exact working-tree preview: `https://milestoneproof-pnp31ig1c-anayagarwalla-7935s-projects.vercel.app`
- Preview status: Ready and protected by Vercel SSO
- Authenticated preview liveness: HTTP 200 with liveness type, version, request ID, and production security headers
- Deployment manifest parity: all 63 application pages/routes are present, including the private `/api/internal/jobs/[jobId]/artifacts` upload route; root-anchored ignore rules and a regression test prevent that route from being omitted again
- Production access lists: authenticated owner configured for beta and admin access
- Production capacity: 10 retained runs/day; existing analysis and evidence limits remain bounded
- High-impact configuration: runner, record-attribution, and scheduler secrets are independent and rotated; runner and scheduler values are synchronized with Cloudflare
- Protected production readiness correctly remains HTTP 503 until the exact web preview is promoted and the founder-owned legal/contact and operational gates below are completed. Database connectivity, backlog, recovery queues, retention, evidence capacity, daily capacity, shallow runner health, and workflow controls are healthy.

## Deliberately not completed

The following require the founder's real identity, authority, external mailbox/provider, or a real transaction:

- operator name/address, governing law, venue, and monitored public support/security contacts;
- custom SMTP plus SPF/DKIM/DMARC and corporate link-scanner testing;
- incident-role assignment and documented operational attestations;
- off-site encrypted backup destination and isolated restore target;
- paid Gemini confirmation, Stripe sandbox account/app, and optional notification provider;
- authorized retained production transaction and human/legal/commercial sign-off;
- production promotion of the exact working-tree preview after those gates pass.
