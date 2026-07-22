# Greenlit Stripe invoicing integration plan

Date: 2026-07-21
Scope: Product and engineering design only; no Stripe account, paid service, production key, or live invoice was created.

## Decision

For the first agency beta, Greenlit should be a **backend-only public Stripe App using OAuth 2.0**. Each agency installs the app into its existing Stripe account. Greenlit then creates and sends the invoice inside that agency's Stripe account.

This keeps the agency as the seller and merchant of record, keeps its customers and invoices in its own Stripe account, and avoids asking agencies to paste secret keys into Greenlit. Do not create agency invoices in Greenlit's own Stripe account, and do not collect an application fee in the beta.

Stripe Apps external testing is suitable for the closed beta: it supports up to 25 testers, but the app must use public distribution, installers must be Stripe account administrators, and testers must be told that the app is in development and has not been reviewed by Stripe.

Longer term, if Greenlit becomes a complete payment platform that onboards agencies without existing Stripe accounts, evaluate Stripe Connect Accounts v2 with direct charges. That is more infrastructure and responsibility than this beta needs.

## Exact product flow

### 1. Connect Stripe once from the agency dashboard

Add a quiet secondary control beside **New milestone** in the dashboard heading:

- Disconnected: `Connect Stripe`
- Connected: `Stripe connected` with a `Manage` link
- Connection problem: `Reconnect Stripe`

The connect action sends the agency administrator through Stripe's OAuth install screen. It must not appear on the client review page.

### 2. Configure the invoice before creating the client review

On a passing verification report, add a compact **Invoice after approval** card immediately above the existing action banner that contains **Create client review**.

Fields:

- `Automatically send through Stripe when approved` toggle, default off
- Billing contact name
- Billing email (required; never assume the reviewer is the billing contact)
- Payment terms: Net 7, Net 15, Net 30, or a custom due date
- Memo / purchase-order reference (optional)
- Stripe customer selector when more than one customer matches

The milestone amount and currency are read-only and come from the retained record. In v1, taxes, discounts, deposits, and amount changes must be completed in Stripe or in the milestone before the review packet is created.

If Stripe is disconnected, the toggle remains off and the card offers `Connect Stripe`. Users can still create a client review without Stripe.

When the review link is created, freeze the invoice plan into the review snapshot and include it in the snapshot hash. The client review should show a small neutral summary near the milestone facts:

> If approved, Northstar Studio will issue a $12,000.00 Stripe invoice to the designated billing contact, due in 30 days.

The approval modal should repeat that summary so an automatic invoice is never a surprise.

### 3. Place the manual send button on the approved dashboard card

The primary manual invoice action belongs in the **existing empty action row at the bottom of an approved record card**, directly below the green **Client approved** strip. It should be right-aligned on desktop and full width on mobile.

Do not put the primary send action inside the printable approval receipt. The receipt is an immutable evidence record, it can also be opened by a client session, and invoice sending is an agency-only operational action.

Button and status states:

| State | Dashboard control |
| --- | --- |
| Stripe disconnected | `Connect Stripe` |
| Connected; no invoice | `Review & send invoice` |
| Creating | `Creating invoice…` |
| Draft | `Review & send invoice` |
| Sending | `Sending invoice…` |
| Open / sent | `Invoice sent · Due Aug 20` plus `Open in Stripe` |
| Paid | `Paid Aug 12` plus `View invoice` |
| Failed | `Invoice failed` plus `Retry` |
| Voided | `Invoice voided` plus `Open in Stripe` |

`Review & send invoice` opens a confirmation dialog showing the exact Stripe account, client, billing email, line item, amount, currency, and due date. The destructive external action is the final `Send $12,000.00 invoice` button inside that dialog.

If automatic sending was enabled before review, approval creates and sends the invoice without another agency click. The dashboard card changes to `Invoice sent` and offers `View invoice`.

### 4. Keep the approval receipt immutable

After an invoice exists, signed-in agency owners may get a secondary `Open Stripe invoice` link in the non-print receipt toolbar. Hide it from print and from client-only receipt sessions. The receipt body and its approval hash must not change.

The receipt can include a separate downstream transaction section that is not part of the original approval digest:

- Stripe invoice ID and invoice number
- Status and due date
- Amount due and amount paid in integer minor units
- Hosted Invoice Page and invoice PDF links
- Invoice-created, sent, paid, voided, and failed event times

### 5. Give the client clear feedback, not controls

The client success page must not contain a send button. After approval:

- Automatic sending enabled: `Approval recorded. Stripe will email the invoice separately to billing@client.com.`
- Manual sending: `Approval recorded. The agency can now issue the invoice.`

Once sent, the client may see a `View invoice` link to Stripe's Hosted Invoice Page. Payment-card or bank details remain entirely on Stripe-hosted pages and never pass through Greenlit.

## Stripe object flow

1. Refresh the agency's OAuth access token server-side.
2. Find the explicitly selected Stripe customer, or create one with the confirmed billing name and email.
3. Create a draft invoice with `collection_method=send_invoice`, the selected due terms, and Greenlit record metadata.
4. Add one invoice item for the exact approved milestone amount in integer minor units.
5. Show the draft summary to the agency for the manual path.
6. Finalize and send the invoice with Stripe.
7. Save the Stripe invoice ID, number, Hosted Invoice Page URL, PDF URL, and status.
8. Keep the local status current from signed Stripe webhook events.

Recommended metadata:

- `greenlit_record_id`
- `greenlit_record_public_id`
- `greenlit_review_packet_id`
- `greenlit_receipt_sha256`
- `greenlit_criteria_revision`

Do not place source text, client evidence, or other sensitive content in Stripe metadata.

## Required Stripe App permissions

Request only the permissions needed for this feature:

- `customer_write` — select, create, and maintain the agency's Stripe customers
- `invoice_write` — create, retrieve, finalize, send, and void invoices
- `event_read` — receive the required invoice lifecycle events

The exact event permissions must be validated against the final event list before uploading the app manifest. Do not request payments, refunds, payouts, transfers, or application-fee permissions for the first beta.

## Database additions

### `stripe_connections`

- `owner_user_id` unique foreign key
- `stripe_account_id`
- `livemode`
- encrypted refresh token and token rotation metadata
- connection status, connected time, deauthorized time, last error

OAuth refresh tokens must be encrypted with a server-only key and never returned to the browser, logs, exports, or admin UI.

### `record_invoice_plans`

- `record_id` and `criteria_revision`
- billing name and email
- due terms / due date
- optional memo or PO reference
- `auto_send_on_approval`
- frozen `amount_minor` and `currency`
- plan revision and plan hash

### `record_invoices`

- `record_id`, `review_packet_id`, and invoice-plan revision
- Stripe account, customer, and invoice IDs
- local status: `PENDING`, `DRAFT`, `OPEN`, `PAID`, `VOID`, `UNCOLLECTIBLE`, or `FAILED`
- `amount_due_minor`, `amount_paid_minor`, and `currency`
- billing email, due date, invoice number
- Hosted Invoice Page URL and PDF URL
- last error and lifecycle timestamps

### `stripe_webhook_events`

- unique Stripe event ID
- Stripe account ID, event type, object ID
- received, processed, and failed timestamps
- safe error detail

### `invoice_jobs`

- unique review packet / invoice-plan revision
- status, attempts, lease time, next attempt, last error
- stable idempotency keys for customer, invoice, invoice-item, finalize, and send operations

## Atomicity and duplicate prevention

The current review decision is recorded atomically in Postgres. Preserve that boundary:

1. When an `APPROVED` decision is committed, the same database transaction inserts one `invoice_jobs` row if the frozen plan has automatic sending enabled.
2. Stripe calls happen only after the approval transaction commits.
3. Every Stripe POST uses a stable idempotency key derived from the review packet and invoice-plan revision.
4. If Stripe succeeds but Greenlit loses the response, retrying with the same key must recover the same Stripe object instead of creating a duplicate.
5. A failed invoice never rolls back or changes the valid approval record. It becomes a visible `Invoice failed` operational state with retry.

Webhook handling must verify Stripe's signature against the raw request body, reject unrecognized accounts, record event IDs for deduplication, and not rely on event order. When status is uncertain, retrieve the invoice from Stripe and reconcile it.

Add append-only Greenlit audit events for `STRIPE_CONNECTED`, `INVOICE_PLAN_FROZEN`, `INVOICE_CREATED`, `INVOICE_SENT`, `INVOICE_PAID`, `INVOICE_FAILED`, `INVOICE_VOIDED`, and `STRIPE_DEAUTHORIZED`. These are downstream events; they do not rewrite the `MILESTONE_APPROVED` event or approval receipt hash.

## Route and component map

Suggested server modules and routes:

- `apps/web/lib/stripe.ts` — Stripe SDK client, token refresh, idempotency helpers
- `apps/web/lib/stripe-crypto.ts` — authenticated encryption for OAuth refresh tokens
- `apps/web/app/api/stripe/install/route.ts` — signed OAuth state and redirect
- `apps/web/app/api/stripe/callback/route.ts` — state verification and code exchange
- `apps/web/app/api/stripe/webhook/route.ts` — raw-body signature verification and event reconciliation
- `apps/web/app/api/account/stripe/route.ts` — connection status and disconnect
- `apps/web/app/api/account/records/[recordId]/invoice-plan/route.ts` — validate and save the pre-review plan
- `apps/web/app/api/account/records/[recordId]/invoice/route.ts` — create, send, retry, and fetch invoice status
- `apps/web/components/agency-dashboard.tsx` — connection control, approved-card send action, invoice states
- `apps/web/components/milestone-studio.tsx` — pre-review invoice plan
- `apps/web/components/client-review.tsx` — frozen invoice-plan disclosure and post-decision message
- `apps/web/components/approval-receipt.tsx` — owner-only non-print invoice link and downstream status

The review-creation route must add the frozen invoice plan to the review snapshot. The existing atomic review-decision function must add the invoice job without performing a network call inside Postgres.

## Safety, legal, and privacy changes

- Update Terms to explain that the agency, not Greenlit, issues the invoice and remains responsible for customer identity, tax, invoice content, refunds, disputes, and legal compliance.
- Update Privacy to name Stripe and describe billing contact, invoice, payment-status, and account-connection data.
- Update the recordkeeping notice so the Greenlit approval and the Stripe invoice/payment record are linked but remain separate records.
- Add Stripe to privacy exports and deletion workflows, while preserving legally held records according to the agency's instructions and Stripe's own retention obligations.
- Never claim that approval guarantees payment.
- Do not automatically enable Stripe Tax. The agency must activate and configure tax behavior in Stripe and remain responsible for it.
- An authorized adult operator must own and configure Greenlit's Stripe developer/app account before any live integration is offered.

## Accessible interaction requirements

- The confirmation dialog needs initial focus, a focus trap, Escape support, focus restoration, `aria-modal`, and an explicit title and summary.
- Announce creating, sending, success, and failure through a polite live region.
- Do not use color alone for invoice states.
- Keep the card action at least 44 pixels tall on touch screens and full width at narrow breakpoints.
- Hide invoice controls from printed receipts.
- Never disable the only recovery action; failed states must expose a readable error and retry path.

## Test plan

Run the complete flow in Stripe Sandbox before live mode:

1. OAuth connect, CSRF rejection, token refresh, token rotation, and uninstall/deauthorization.
2. Existing customer, new customer, duplicate-email customer selection, and invalid billing email.
3. Manual draft, confirm, finalize, send, open Hosted Invoice Page, and PDF.
4. Automatic send after approval without blocking or corrupting the approval decision.
5. Double click, network timeout, route retry, webhook duplicate, and out-of-order webhook events.
6. `invoice.sent`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, and `invoice.marked_uncollectible` states.
7. Exact cents and non-USD currencies.
8. Disconnected Stripe account before approval and after invoice creation.
9. Owner versus client permissions on dashboard, review, and receipt.
10. Desktop, 320px mobile, 200% zoom, keyboard-only, screen-reader status announcements, and print output.

Do one retained end-to-end sandbox transaction: Gemini import -> criteria -> verified run -> frozen invoice plan -> separate client approval -> Stripe invoice email -> Hosted Invoice Page -> paid event -> Greenlit dashboard and receipt link -> JSON/privacy export.

## Rollout sequence

1. Implement only sandbox mode and gate it behind an invite flag.
2. Test with Greenlit's own Stripe sandbox and fake customers.
3. Upload a public OAuth Stripe App and start an external test.
4. Invite no more than 25 agency Stripe administrators and disclose that Stripe has not reviewed the test app.
5. Keep automatic sending off by default for the first testers; enable it per agency after one successful manual invoice.
6. Do not move to live invoices until the adult-owned operator account, legal copy, privacy disclosures, support path, webhook monitoring, and failure recovery are complete.

## Current Stripe references

- [Stripe Apps authentication methods](https://docs.stripe.com/stripe-apps/api-authentication)
- [Stripe Apps OAuth](https://docs.stripe.com/stripe-apps/api-authentication/oauth)
- [Stripe Apps permissions](https://docs.stripe.com/stripe-apps/reference/permissions)
- [External testing](https://docs.stripe.com/stripe-apps/test-app)
- [Stripe App events](https://docs.stripe.com/stripe-apps/events)
- [Create and send an invoice](https://docs.stripe.com/invoicing/integration/quickstart)
- [Invoice finalization and status transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions)
- [Webhook handling](https://docs.stripe.com/webhooks)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe Invoicing pricing](https://stripe.com/invoicing/pricing)
- [Connect invoices](https://docs.stripe.com/invoicing/connect)

As of this review, Stripe's US Invoicing Starter price is 0.4% per paid invoice, with Stripe Payments pricing also applying. Pricing varies by country and can change, so verify it again before enabling live mode.
