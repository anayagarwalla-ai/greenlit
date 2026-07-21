# MilestoneProof independent beta-readiness follow-up

Date: 2026-07-21
Scope: independent verification of Claude's implementation against the original beta-readiness audit, limited to browser behavior, responsive/keyboard quality, migration safety, and state-machine gaps.

## 1. Outcome

All independently reproducible product gaps found in this pass were fixed locally. The review deliberately preserved the existing identity and visual system; no broad redesign was performed.

## 2. Findings closed

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Anonymous drafts could not be safely claimed as a specific signed-in project | Added account-and-project-scoped v4 draft storage, a short-lived explicit claim marker, safe magic-link return paths, and full local draft restoration | Browser handoff retained source, agency, client, project, milestone, and `$12,000.50`; unit tests cover account/project isolation and stale claims |
| Server resume did not preserve the full workflow | Added versioned `workspace_state` persistence for criteria, mappings, confirmations, results, and review state | Typecheck/build plus route and storage tests |
| Full source text could accidentally enter server resume state | Added client-side omission and server-side recursive sanitization of source files, bearer links, and short-lived receipts while preserving exact frozen criterion quotations | `workspace-state.test.ts` |
| Revoked/expired reviews could strand records or block a replacement link | Added atomic review management, replacement-link rules, fresh sessions for decided receipts, and dashboard lifecycle logic | Real PostgreSQL checks 5–8 plus review lifecycle/session unit tests |
| Review decision, record state, audit entry, and notification were separate writes | Replaced the route sequence with one atomic RPC | Real PostgreSQL check 7 |
| Evidence/record deletion could leave storage and database state inconsistent | Added staged, retryable deletion states and atomic finalization/failure receipts | Real PostgreSQL checks 10–11 |
| Privacy and job operations were not fully actionable | Added verified exports, legal holds, lawful deletion scheduling, append-only corrections, notification retry, and unresolved-job acknowledgement | Production build and operator route review |
| Runner connections were not bound to the queued safe DNS set | Added frozen address manifests, origin revalidation, actual connection-address validation, and pinned ownership-proof HTTPS | Runner security tests |
| Mobile source context was hidden; the first correction caused the source sheet to overflow | Kept the source pane visible, bounded, scrollable, and keyboard-focusable with no overlap | [Corrected 320px criteria view](assets/criteria-source-mobile-320-fixed-2.png) |
| Desktop client action bar could obscure results | Kept the decision bar in normal document flow | [Desktop client review](assets/review-desktop-1440.png) |

## 3. Browser verification

1. Landing page at 320 × 844: header reflows, Agency sign in remains available, no horizontal overflow.
2. Sign-in at 320 × 844: primary action remains unobstructed and the email input has a visible focus indicator.
3. Workspace at 320 × 844: header controls do not overlap; business fields and value cents survive sign-in navigation.
4. Criteria at 320 × 844: source context is visible in a bounded keyboard-scrollable pane; criteria begin below it with no overlap.
5. Verification results at 320 × 844: observed values remain visible and explicit Passed/Failed text is present.
6. Feedback at 320 × 844: dialog fits the viewport, moves initial focus, closes on Escape, and restores trigger focus.
7. Client review at 320 × 844: observed evidence stays visible and the decision modal scrolls within the viewport.
8. Client review at 1440 × 900: the decision bar is static and does not cover the last result row.
9. Receipt at 320 × 844: toolbar wraps, exact cents remain visible, and no fake on-screen page counter is shown.
10. Browser console: no error or warning entries were produced during the walkthrough.

Selected captures:

- [Landing, 320px](assets/home-mobile-320-viewport.png)
- [Sign-in, 320px](assets/login-mobile-320-viewport.png)
- [Visible sign-in focus](assets/login-mobile-input-focus.png)
- [Workspace, 320px](assets/workspace-mobile-320-viewport.png)
- [Verification results, 320px](assets/results-mobile-ready-320.png)
- [Feedback dialog, 320px](assets/feedback-mobile-dialog.png)
- [Decision modal, 320px](assets/decision-modal-mobile-320.png)
- [Receipt, 320px](assets/receipt-mobile-320-viewport.png)

## 4. Migration and test evidence

- The complete migration chain through `202607210002_independent_audit_fixes.sql` applied successfully to an isolated PostgreSQL 18 database.
- Eleven functional state-machine groups passed, covering queue/lease/complete idempotency, active-job protection, review replacement, overlapping review safety, atomic decisions/notifications, stale retries, staged evidence deletion, legal holds, and staged record deletion.
- Typecheck passed for contracts, web, and runner.
- ESLint passed.
- Unit tests passed: contracts 7, web 73, runner 8.
- The 32-route Next.js production build passed.
- `git diff --check` passed.

## 5. Limits

No real client decision was submitted because the product requires an authorized adult business representative. The browser walkthrough used only local synthetic data. Production migration/deployment and a post-deploy read-only smoke pass are tracked separately from this local evidence.
