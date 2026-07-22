# Greenlit approved-logo design QA

- Source visual truth: `artifacts/brand/greenlit-approved-source.png`
- Source pixels: 1774 × 887 px
- Primary implementation capture: `artifacts/brand/qa-home-desktop.png`
- Implementation pixels / CSS viewport: 1440 × 1000 px at device scale 1
- Focused comparison: `artifacts/brand/qa-source-vs-implementation.png`
- Additional states: `qa-workspace-desktop.png`, `qa-home-mobile-320.png`, `qa-workspace-mobile-320.png`, `qa-review-desktop.png`, and `qa-receipt-desktop.png` in `artifacts/brand/`
- Mobile viewport: 320 × 800 CSS px at device scale 1
- Rendered logo asset: 1200 × 270 transparent PNG, displayed at 154 × 35 CSS px on desktop and 138 × 31 CSS px on mobile
- State: light header, inverse dark header, signed-out workspace, client review, printable receipt, desktop, and 320 px mobile

## Full-view comparison evidence

The approved source and implemented desktop page are shown together in `artifacts/brand/qa-source-vs-implementation.png`. The approved two deep-ink outer frames, mineral-green center square, and supplied Greenlit wordmark all remain intact. The logo fits the existing header hierarchy and does not introduce horizontal overflow.

## Focused comparison evidence

The focused lower panels in `qa-source-vs-implementation.png` compare the extracted source lockup directly with the rendered landing-header lockup. A focused comparison was necessary because the normal 154 px header rendering is too small to judge the registration-square color and frame geometry from the full page alone.

## Required fidelity surfaces

- Fonts and typography: the supplied wordmark is retained as image artwork; no browser font substitutes or re-types it. The accessible link name remains “Greenlit home.”
- Spacing and layout rhythm: the lockup renders at 154 × 35 px on desktop and 138 × 31 px at 320 px. Header clear space remains intact, all tested routes have zero horizontal overflow, and no navigation/control overlap was introduced.
- Colors and visual tokens: the primary lockup preserves the approved raster colors. The dark-header derivative keeps the exact geometry while mapping ink to warm white and the registration square to a contrast-safe mineral green.
- Image quality and asset fidelity: the production lockup is a losslessly served 1200 × 270 source-derived PNG, not CSS art, an inline SVG approximation, or live text. It remains crisp at every tested display size. Favicon, Apple icon, app icons, and social card are derived from the same approved source.
- Copy and content: the visible brand name matches the supplied “Greenlit” wordmark. No duplicate HTML wordmark remains beside the image.

## Comparison history

1. Initial P1 finding: the unfinished repository logo draft had a green lower frame and dark center square, contradicting the approved source. It also redrew the mark inline and re-typeset the wordmark.
2. Fix: replaced the inline drawing and old public SVGs with deterministic source-derived raster assets; added primary/inverse lockups, standalone marks, favicon/Apple/PWA icons, and social-preview metadata.
3. Post-fix evidence: desktop landing, dark workspace, review, receipt, and 320 px landing/workspace captures show the approved geometry with zero horizontal overflow and no console errors.

## Findings

No actionable P0, P1, or P2 visual differences remain.

## Follow-up polish

None required for the logo rollout.

final result: passed
