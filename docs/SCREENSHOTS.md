# Submission screenshot checklist

Final production PNGs live in `docs/screenshots/` and were captured at 1512×772 with no browser chrome. Do not show cloud dashboards or secrets.

| File | Moment | Devpost caption |
|---|---|---|
| `01-gemini-sow-import.png` | Workspace intake with the synthetic SOW loaded and confidentiality gate visible | Paste or upload a non-confidential SOW; Gemini turns contract language into proof-ready checks. |
| `02-source-grounded-criteria.png` | Live Gemini results with cited source and green exact-match badges | Human-controlled AI: every editable criterion carries an exact quote independently matched to the source. |
| `03-false-success-caught.png` | Clearly labeled synthetic `launch-rc1` walkthrough with AC-04 failing | A seeded walkthrough illustrates how MilestoneProof surfaces a false-success HTTP 500 without presenting the sample as evidence. |
| `04-client-review.png` | Clearly labeled synthetic client-decision walkthrough | Clients see the promises they signed and one clear decision; this sample is explicitly not retained. |
| `05-invoice-ready-record.png` | Clearly labeled sample approval format | The printable format is demonstrated without implying that a real client transaction occurred. |

Before upload, verify that every image:

- is readable at Devpost gallery size;
- contains only synthetic Acme/Northstar data;
- shows the deployed `milestoneproof.vercel.app` build;
- avoids cursor hover states over important copy;
- uses consistent viewport and zoom;
- has no toasts obscuring important information.
