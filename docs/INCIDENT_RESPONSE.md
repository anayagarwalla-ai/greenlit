# Incident-response runbook

This is an operational template, not legal advice. Before beta invitations, replace every unassigned role with a named person and have counsel confirm notification duties for the operating entity and tester jurisdictions.

## Roles

- Incident lead: **unassigned**
- Technical lead: **unassigned**
- Privacy/legal contact: **unassigned**
- Tester communications owner: **unassigned**

## First 30 minutes

1. Preserve relevant Vercel, Cloudflare, Supabase, GitHub, and application operational logs. Do not paste secrets or customer content into chat or tickets.
2. Stop the affected capability. Prefer revoking a specific review link, pausing invites/runs, or rotating one credential over broad destructive changes.
3. Record detection time, reporter, affected service, suspected data categories, and the last known-good deployment.
4. If a secret may be exposed, rotate it in the provider and deployment environment, redeploy, then invalidate the old value.

## Investigation and containment

- Identify affected accounts, record IDs, time range, and providers.
- Validate authorization boundaries with a non-production test account.
- Compare transaction audit-chain hashes and provider logs; never claim “no impact” solely because the application has no error.
- Place a scoped legal hold only when directed; document the reason, owner, and review date.
- Do not delete affected evidence until the incident lead and legal contact approve the retention decision.

## Notification and recovery

- Counsel decides whether and when users, customers, regulators, insurers, or law enforcement must be notified.
- Communications must state confirmed facts, affected data/capabilities, containment steps, user actions, and a monitored contact. Avoid speculation.
- Restore from a reviewed commit, validate migrations, run the full test/build/browser checklist, and verify one end-to-end transaction before reopening the capability.

## Post-incident

Within five business days, document root cause, timeline, affected scope, control gaps, corrective actions, owners, and due dates. Add a regression test or monitoring signal for the failure mode and review whether provider agreements, notices, retention, or access controls must change.
