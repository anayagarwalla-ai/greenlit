# MilestoneProof product-readiness audit

Audited July 20, 2026 against the deployed product at https://milestoneproof.vercel.app.

## Verdict

The product is visually strong and the complete guided story is understandable. The real Gemini import is working. The largest submission risk is that the verification, review, approval, evidence, and receipt screens use seeded demo values rather than data produced and persisted by the live flow.

## Flow health

1. **Landing page — Healthy.** Clear business problem, memorable positioning, and an obvious demo entry point.
2. **SOW intake — Mostly healthy.** Safe-data disclosure is strong, but the generate and guided-demo actions sit below the fold at a 1280×720 judge viewport.
3. **Guided criteria — Mostly healthy.** Exact quotes and confirmation are convincing. “Seeded fallback” sounds like a failure, and the synthetic document is simultaneously watermarked “CONFIDENTIAL.”
4. **Failure evidence — Visually healthy, technically simulated.** The false-success story is excellent, but the UI advances through a timer and renders static results.
5. **Passing evidence — Visually healthy, technically simulated.** Result IDs, timestamps, observed values, artifact claims, and hashes are seeded.
6. **Review-link creation — Visually healthy, technically simulated.** The displayed `milestoneproof.app` URL does not match the deployed Vercel URL, and the generated link is a static demo route.
7. **Client review — Visually excellent, technically simulated.** The no-login decision surface is very clear, but its expiry and run binding are not enforced by a stored token.
8. **Approval receipt — Visually excellent, technically simulated.** Printing works, but the name, date, IDs, hashes, amount, and run are hard-coded.
9. **Live Gemini criteria — Healthy.** Gemini returned three source-grounded, editable criteria with correct human-review boundaries.
10. **Custom verification handoff — Honest but incomplete.** It explains origin verification and typed mappings, but users cannot complete those steps in the product.

## Must complete before submission

1. **Connect one real fixture verification to the UI.** Submit confirmed typed checks to `/api/runs`, lease the submitted job rather than the current Example Domain smoke job, poll real status, and render the returned results.
2. **Produce real evidence metadata.** Capture at least one actual screenshot/network artifact from the Cloudflare run and calculate the IDs, timestamps, durations, and hashes shown in the report.
3. **Persist the run-to-approval chain.** Save the milestone, frozen criteria, run, results, and artifact metadata using the existing Supabase schema instead of component state and `sessionStorage`.
4. **Create a real review token.** Generate a stored, expiring, single-decision token; load the associated run on the review page; and reject invalid, expired, or already-used tokens.
5. **Make approval and receipt dynamic.** Store the reviewer name, note, decision, and timestamp, then render the receipt from that record. Remove hard-coded dates, hashes, IDs, client values, and build labels from the live path.
6. **Add real runner failure states.** Handle queued, running, retrying, failed, and timed-out jobs with recovery actions instead of relying on a fixed timer.

## Important judge-facing polish

1. Move **Generate acceptance criteria** and **Launch guided demo** above the fold or into a persistent action area.
2. Rename **Seeded fallback** to **Synthetic guided demo** or **Preloaded safe criteria** so it does not imply Gemini failed.
3. Replace the demo document’s **CONFIDENTIAL** watermark with an unmistakable **SYNTHETIC DEMO** marker.
4. Display the actual review URL/domain. Do not show `milestoneproof.app` until that domain really resolves.
5. Add project name, client, milestone value, build label, and target URL fields so the business record is not always Acme Outdoors and $12,000.
6. Increase the smallest workspace text. Several labels and evidence details are roughly 8–10px and will be hard to read in a projected demo.
7. Add focus trapping, Escape-to-close, and focus restoration to the client decision dialog; verify the entire flow at 200% zoom and on a phone.

## Safe to defer until after the hackathon

- Multi-project dashboard and search
- Team invitations and roles
- Billing or paid plans
- Jira, Slack, HubSpot, or invoicing integrations
- Approval-cycle analytics
- Arbitrary authenticated customer sites
- Fully automatic mapping for every possible SOW

## Evidence

- `01-landing.png`
- `02-sow-intake.png`
- `03-criteria-confirmation.png`
- `04-verification-evidence.png`
- `05-passing-evidence.png`
- `06-review-link.png`
- `07-client-review.png`
- `08-approval-receipt.png`
- `09-gemini-criteria.png`
- `10-verification-handoff.png`

## Evidence limits

The audit inspected the deployed desktop flow, current DOM structure, responsive styles, and the implementation behind the live path. It did not establish full WCAG compliance, test assistive technologies, or capture a separate mobile viewport. The Cloudflare runner health/smoke path exists, but the user-facing guided run does not currently consume its live results.

## Remediation implemented after this audit

The audit findings drove the submission-readiness implementation in the same work session. The current code now uses the real queue/browser runner, actual results and signed screenshot URLs, durable Supabase records, owner-bound sessions, expiring review packets, single final decisions, dynamic receipts, JSON exports, runner failure states, real business fields, clearer synthetic-demo wording, a non-confidential watermark, improved small-text legibility, and a sticky above-the-fold intake action. The original screenshots remain here as evidence of the audited baseline; final Devpost screenshots are recaptured from the remediated production deployment.
