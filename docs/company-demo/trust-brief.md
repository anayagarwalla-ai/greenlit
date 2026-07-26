# Greenlit trust brief

## What the product does

Greenlit links a human-confirmed SOW promise, typed staging checks, captured evidence, a named reviewer decision, and an invoice-ready record.

## Current closed-beta controls

- Invitation-only agency accounts and owner-scoped records.
- Recipient-bound, expiring review access with a separately shared code.
- Public-HTTPS origin ownership verification before custom checks.
- Typed checks rather than generated arbitrary browser scripts.
- Restricted runner networking and authenticated callbacks.
- Private evidence storage, evidence hashes, immutable review snapshots, and hash-chained transaction events.
- Revocable review links, legal holds, privacy requests, retention maintenance, and operator pause controls for runs, reviews, and invoices.
- Stripe test mode by default; Greenlit stores invoice metadata, not payment credentials.

## Data and retention defaults

- Use only authorized business data within the displayed service mode.
- Screenshot evidence: 90 days by default.
- Approval and audit records: four years by default.
- Review access: 72 hours by default, extendable within a 14-day hard limit.
- Legal holds can suspend deletion for scoped records or artifacts.

## Explicit non-claims

Greenlit does not claim SOC 2, ISO, PCI, WCAG certification, legal-signature status, guaranteed payment, universal staging compatibility, security testing, performance certification, or correctness of unconfirmed AI output.

## Current technical limitations

- Best fit: public HTTPS staging with same-origin assets.
- Protected previews, VPN-only sites, client-controlled credentials, arbitrary scripts, and many cross-origin dependencies may be unsupported.
- The product is not for health, financial-account, government-identifier, child, employment, or other regulated data.
- Availability, incident response, support coverage, and commercial commitments remain closed-beta best effort unless separately agreed in writing.

## Escalation

Publish a legal operator name and monitored support/security email before inviting external testers. Use the privacy-request form for data-subject requests. Do not put credentials, access codes, complete SOW text, or regulated data in an issue report.
