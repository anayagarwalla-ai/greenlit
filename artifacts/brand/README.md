# Greenlit approved logo assets

`greenlit-approved-source.png` is the approved visual source supplied on July 22, 2026. It is the source of truth for every product logo. The two outer frames remain deep ink and the center registration square remains mineral green.

## Files

- `greenlit-approved-source.png` - untouched approved source image
- `greenlit-logo-transparent.png` - transparent production lockup derived from the approved source
- `greenlit-mark-512.png` - transparent standalone mark derived from the approved source
- `asset-report.json` - source hash and deterministic crop measurements

Production exports live in `apps/web/public/brand/`. Run `pnpm exec node scripts/render-greenlit-brand-assets.mjs` from the repository root to rebuild them from the approved source.

## Color

- Deep ink and mineral green are sampled directly from the approved raster source.
- The inverse lockup preserves the approved geometry, with warm white outer frames and wordmark plus a lighter mineral-green registration square for contrast.

Use deep ink as the visual anchor and mineral green as the accent. Do not recolor the full identity bright green. The monochrome version is the correct fallback when only one ink is available.

## Minimum size and spacing

- Standalone mark: 24 px minimum on screen
- Horizontal lockup: 120 px minimum width on screen
- Clear space: at least half the mark's width on all sides

Do not swap the colors of the lower frame and center square, add a containing circle, stretch the geometry, rotate it, add shadows, or replace the registration square with a checkmark.
