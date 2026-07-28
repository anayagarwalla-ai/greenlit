# Submission screenshot checklist

Current Greenlit production PNGs live in `docs/screenshots/` and were recaptured on July 28 at 1440×900 with no browser chrome. They are true PNG files. Do not show cloud dashboards or secrets.

| File | Moment | Devpost caption |
|---|---|---|
| `01-product-overview.png` | Greenlit landing page and illustrative milestone proof card | Greenlit connects the SOW, browser evidence, client decision, and invoice-ready approval record. |
| `02-source-grounded-criteria.png` | Live Gemini results with cited source and green exact-match badges | Human-controlled AI: every editable criterion carries an exact quote independently matched to the source. |
| `03-false-success-caught.png` | Clearly labeled synthetic `launch-rc1` walkthrough with AC-04 failing | A seeded walkthrough illustrates how Greenlit surfaces a false-success HTTP 500 without presenting the sample as evidence. |
| `04-client-review.png` | Clearly labeled synthetic client-decision walkthrough | Clients see the promises they signed and one clear decision; this sample is explicitly not retained. |
| `05-invoice-ready-record.png` | Clearly labeled sample approval format | The printable format is demonstrated without implying that a real client transaction occurred. |

The 3:2 Devpost thumbnail is `docs/hackathon/greenlit-devpost-thumbnail.png` at 1350×900.

Before upload, verify that every image:

- is readable at Devpost gallery size;
- contains only synthetic Acme/Northstar data;
- shows the deployed `greenlitproof.vercel.app` build;
- avoids cursor hover states over important copy;
- uses consistent viewport and zoom;
- has no toasts obscuring important information.
