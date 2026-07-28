# Greenlit interaction-polish audit

Date: 2026-07-28

## Audit scope

Combined UX and accessibility review of the public landing page, demo-request flow, guided workspace, client review, decision dialogs, feedback widget, shared navigation, responsive behavior, focus behavior, loading and success states, and shared controls. The review used current-run desktop (1280×800) and mobile (390×844) browser captures.

## User goal and accessibility target

An agency buyer should be able to understand the product, enter the synthetic walkthrough, request a conversation, inspect evidence, and make a sample client decision without abrupt state changes, covered controls, unclear disabled states, lost focus, or motion that ignores user preferences. The implementation targets WCAG 2.2 AA interaction fundamentals while avoiding a claim of full conformance.

## Research used

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for focus visibility, unobscured focus, and 24×24 CSS pixel minimum pointer targets.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) for initial focus, focus containment, Escape dismissal, and focus restoration.
- [web.dev Interaction to Next Paint guidance](https://web.dev/articles/inp) for immediate visual response after user input.
- [Material motion duration and easing](https://m1.material.io/motion/duration-easing.html) for brief, consistent desktop transitions.
- [Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons) for clear pressed states and comfortable 44×44 hit regions.

## Strengths retained

- The visual identity, content hierarchy, synthetic-data disclosures, evidence story, and primary calls to action were already strong.
- Core dialogs already used semantic roles, focus traps, Escape dismissal, and focus restoration.
- The guided workspace and review flow already gave users explicit status, scope, and recordkeeping context.
- Narrow layouts had no horizontal overflow in the audited states.

## UX and accessibility risks found

- Feedback and decision dialogs appeared abruptly, while the feedback dialog disappeared instantly.
- Opening feedback placed focus on the close button, producing a conspicuous focus box before the user had been oriented to the dialog.
- The feedback heading and close target occupied overlapping geometry.
- The background remained scrollable while dialogs were open.
- Feedback was disabled below ten characters and for malformed optional email without visible guidance.
- The two-step demo form changed state instantly and did not expose the current step semantically.
- The 390px landing header wrapped into an accidental-looking second row.
- Shared buttons and lightweight actions used inconsistent pressed, hover, and focus-adjacent feedback.

## Implemented improvements

- Added a restrained 150–280ms motion system for pages, content changes, dialogs, controls, and feedback, with a complete `prefers-reduced-motion` fallback.
- Added reversible feedback entrance and exit transitions, backdrop fading, initial title focus, focus restoration, scroll locking, clearer field guidance, a live character count, inline optional-email guidance, and a non-overlapping close target.
- Added global modal entrance treatment and scroll locking without changing existing focus-trap or decision semantics.
- Added consistent pressed, hover, input, and close-control states across shared controls.
- Added a one-row 390px header and a 320px fallback that preserves fit.
- Added a short transition and `aria-current="step"` to the demo-request progression.
- Changed the request-demo feedback affordance to a compact, expanding control so it no longer covers the conversion form.

## Evidence

Before:

- [Desktop feedback dialog](before/02-feedback-open-desktop.png)
- [Mobile landing header](before/07-home-mobile.png)
- [Mobile feedback dialog](before/08-feedback-mobile.png)
- [Desktop decision dialog](before/06-approve-dialog-desktop.png)

After:

- [Desktop feedback dialog](after/06-feedback-desktop.png)
- [Mobile landing header](after/01-home-mobile-top.png)
- [Mobile feedback dialog](after/02-feedback-mobile.png)
- [Desktop decision dialog](after/03-approve-dialog-desktop.png)
- [Demo-request step two](after/04-request-demo-step-2-desktop.png)

## Evidence limits and verification gaps

The screenshots prove rendered layout and visible states, not full WCAG conformance. Automated and current-run browser checks cover keyboard focus, pointer dismissal, responsive overflow, semantic state, scroll lock, reduced-motion CSS, and representative journeys. Real assistive-technology sessions and field INP data remain appropriate follow-up measurements after external users begin using the beta.
