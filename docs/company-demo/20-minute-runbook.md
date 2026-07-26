# Twenty-minute company demo runbook

## Meeting objective

Determine whether the agency has a recurring milestone-approval bottleneck worth testing with one bounded design-partner pilot. The objective is not to close a broad software subscription on the first call.

## 0:00–4:00 — diagnose the current workflow

Ask:

1. Which project milestone most often waits for approval?
2. Who prepares proof, who chases the client, and who decides?
3. Where do change requests become ambiguous new scope?
4. How many days usually pass between “done” and invoice-ready?
5. Is the relevant staging build available over public HTTPS with same-origin assets?

Listen for a named reviewer, repeated follow-up work, public staging, and a decision that materially affects invoicing.

## 4:00–6:00 — frame the product

Say:

> Greenlit is a closed design-partner beta for U.S. web agencies. It turns a confirmed SOW promise into bounded browser checks, a focused client decision, and an invoice-ready record. Today’s walkthrough uses synthetic information and creates no retained evidence or approval.

Do not say “one click,” “guaranteed payment,” “legally binding,” “certified,” or “works on every staging site.”

## 6:00–13:00 — run the synthetic walkthrough

Open `/workspace?demo=guided`.

1. Show the synthetic SOW and exact source citations.
2. Show that the agency confirms each criterion before verification.
3. Run `launch-rc1`.
4. Pause on AC-04: the page displays success while the underlying request returned HTTP 500.
5. Verify `launch-rc2` without changing the frozen promise.
6. Explain that the displayed frames come from the included fixture, while the outcomes are seeded for presentation reliability.

Core line:

> The useful part is not another test dashboard. It is keeping the exact promise, the observed result, and the client's decision together.

## 13:00–16:00 — show the client decision

Open the synthetic client review.

1. Expand one evidence section.
2. Show the exact source language, expected result, observed result, and fixture frame.
3. Show approve versus request changes.
4. Show how a correction to agreed scope differs from a new request.
5. Approve using clearly synthetic reviewer details.

## 16:00–18:00 — show the record and boundaries

Open the sample approval record.

- Point out the milestone value, frozen revision, build label, decision, and print/PDF action.
- State that the synthetic sample has no evidence hash, audit chain, secure token, server-side decision, or legal-record status.
- For the real beta, explain 90-day screenshot retention, four-year approval/audit retention defaults, a 72-hour review window, revocation, and privacy-request handling.

## 18:00–20:00 — decide the next step

Ask:

1. Which upcoming milestone would be the safest useful pilot?
2. Can it use a public HTTPS staging origin without client-confidential or regulated data?
3. Who owns setup at the agency?
4. Who is the one client reviewer?
5. What result after 30 days would make the pilot worth continuing?

If fit is strong, propose a qualification call using the selected offer from `design-partner-offer-draft.md`. Do not create beta access until capacity and operator readiness are confirmed.

## Fast recovery

- Demo route fails: open the screenshots in `apps/web/public/demo-evidence/`.
- Live runner is unavailable: stay on the synthetic path; do not attempt a real run.
- Review decision fails: open `/receipt/demo` directly and state that it is a sample format.
- Projector is unreadable: use browser zoom, not an untested layout change.
- A security question is uncertain: say you will confirm in writing and use `trust-brief.md`.
