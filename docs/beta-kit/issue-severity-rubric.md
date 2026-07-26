# Beta issue severity rubric

Use the highest applicable severity. Security, privacy, evidence integrity, reviewer identity, and invoice duplication take precedence over cosmetic impact.

## Severity 0, stop beta

Examples:

- Cross-account data or evidence access.
- Credential, token, or access-code exposure.
- Incorrect attribution of a client decision.
- Undetected modification of a retained approval record.
- A real invoice sent without the configured disclosure and valid approval.
- Duplicate invoice creation with no safe reconciliation.
- Uncontrolled testing against an unauthorized origin.
- Prohibited data sent to a provider contrary to the displayed mode.

Response:

1. Pause new retained runs or affected functionality.
2. Preserve logs and evidence.
3. Follow the incident-response runbook.
4. Notify the named operator and backup.
5. Resume only after the fix and regression test are verified.

## Severity 1, blocks the core workflow

Examples:

- Invited agency cannot sign in.
- Valid staging origin cannot be verified.
- A retained run cannot finish for supported checks.
- Client cannot access a valid review.
- Approve or request-changes decision cannot be completed.
- Approval record or invoice result cannot be retrieved.

Target:

- Acknowledge during the monitored beta support window.
- Provide a safe workaround or pause the tester.
- Fix before expanding the cohort.

## Severity 2, material friction

Examples:

- Confusing criteria confirmation.
- Recoverable mapping failure.
- Evidence presentation causes repeated reviewer questions.
- Mobile or keyboard use is materially difficult but still possible.
- Status or error text does not explain the next action.

Target:

- Triage within one business day.
- Group repeated problems by underlying workflow job.
- Fix before relying on the affected metric.

## Severity 3, minor issue

Examples:

- Cosmetic inconsistency.
- Non-blocking copy problem.
- Low-frequency convenience request.
- Small layout issue with an easy workaround.

Target:

- Record, deduplicate, and prioritize with cohort evidence.

## Required issue fields

- Public feedback or internal issue identifier.
- Date and environment.
- Agency account identifier, not pasted client content.
- Page or workflow step.
- Expected behavior.
- Observed behavior.
- Reproduction conditions.
- Severity and reason.
- Workaround.
- Owner and target.
- Regression-test status.
