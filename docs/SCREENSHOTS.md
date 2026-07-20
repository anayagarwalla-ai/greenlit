# Submission screenshot checklist

Final PNGs live in `docs/screenshots/`. Capture at 1440×900 or a similar 16:10 desktop viewport, with no browser chrome if possible. Do not show cloud dashboards or secrets.

| File | Moment | Devpost caption |
|---|---|---|
| `01-gemini-sow-import.png` | Workspace intake with the synthetic SOW loaded and confidentiality gate visible | Paste or upload a non-confidential SOW; Gemini turns contract language into proof-ready checks. |
| `02-source-grounded-criteria.png` | Live Gemini results with cited source and green exact-match badges | Human-controlled AI: every editable criterion carries an exact quote independently matched to the source. |
| `03-false-success-caught.png` | `launch-rc1` report with AC-04 failing | The UI claimed success, but the lead API returned HTTP 500—MilestoneProof caught the contradiction. |
| `04-client-review.png` | Passing no-login client review | Clients see the promises they signed and one clear decision, not CI jargon. |
| `05-invoice-ready-record.png` | Approval receipt after Mara Chen approves | An invoice-ready record binds the SOW revision, build, evidence hashes, client decision, timestamp, and value. |

Before upload, verify that every image:

- is readable at Devpost gallery size;
- contains only synthetic Acme/Northstar data;
- shows the deployed `milestoneproof.vercel.app` build;
- avoids cursor hover states over important copy;
- uses consistent viewport and zoom;
- has no toasts obscuring important information.

