# MilestoneProof demo video script (2:45)

Target length: 2:30–2:55. Record at 1440p or 1080p with the browser at 100% zoom. Keep the cursor deliberate and captions on.

## 0:00–0:18 — Make the business pain concrete

**Screen:** Landing page, then open the workspace.

**Narration:**

“Web agencies often finish a milestone days before they get permission to invoice. The hard part is not delivery—it is proving, in language the client recognizes, that every promise in the statement of work is actually done. MilestoneProof turns that approval limbo into an evidence-backed workflow.”

## 0:18–0:52 — Real Gemini import

**Screen:** Click **Use the synthetic sample**, then **Generate acceptance criteria**. While Gemini runs, point out the non-confidential attestation. When the result appears, scroll just enough to show the source and criteria together.

**Narration:**

“An agency can paste a non-confidential scope or upload a PDF, text, or Markdown SOW. Gemini finds atomic, measurable acceptance criteria and returns the exact supporting quote for each one. MilestoneProof independently matches every quote against the extracted source, so the model cannot quietly invent a requirement.”

## 0:52–1:12 — Show the human/AI boundary

**Screen:** Briefly edit one quote so its green **Exact source match** badge turns red, then undo the edit. Click **Confirm grounded**.

**Narration:**

“AI drafts; a human decides what ‘done’ means. Every title, quote, evidence type, and rationale is editable. Editing clears confirmation, and an ungrounded quote cannot be frozen. The model never generates or executes arbitrary JavaScript—only typed, allowlisted evidence families move forward.”

## 1:12–1:38 — The memorable failure reveal

**Screen:** Continue into the included staging fixture. Run `launch-rc1` and point to AC-04.

**Narration:**

“The safe fixture lets us exercise the whole workflow. This release looks successful: the contact form displays a cheerful confirmation. But the lead request actually returned HTTP 500. MilestoneProof catches that false success and attaches the observed result to the exact SOW promise.”

## 1:38–1:58 — Prove the fix without moving the goalposts

**Screen:** Click **Verify fixed build**. On the passing report, point to **Specs frozen** and **Artifacts hashed**.

**Narration:**

“We rerun the fixed build against the same frozen scope—no re-analysis and no moving the goalposts. All six promises now pass in an isolated browser run, with timestamped evidence and integrity metadata.”

## 1:58–2:25 — Client decision and invoice-ready record

**Screen:** Click **Create client review**, **Open as the client**, and **Approve milestone**. Enter `Mara Chen`, confirm, and open the approval record.

**Narration:**

“The client never sees CI jargon. They see the promises they signed, the outcome observed for each one, and one clear decision. Approval produces an invoice-ready record tying the SOW revision, build, evidence hashes, client, timestamp, and twelve-thousand-dollar milestone together.”

## 2:25–2:45 — Technical credibility and close

**Screen:** Show `docs/ARCHITECTURE.md` or the GitHub README, then return to the passing report.

**Narration:**

“The app is live on Vercel, uses Gemini structured output, a signed Cloudflare Queue and Browser runner, private Supabase storage with row-level security, and shared Zod contracts. The complete guided path remains available if an optional service is unavailable, and the free-tier build enables no paid services. MilestoneProof: give the client proof, not a test report.”

## Recording safety net

- Use only the included synthetic SOW.
- If Gemini is slow or unavailable during the recording, click **Launch the reliable guided demo** and say, “The deterministic fallback keeps the judge path available; the live import is shown in the submitted screenshots.”
- Do one dry run through the approval dialog before recording so the browser has no permission prompts.
- Avoid opening Vercel, Supabase, or Cloudflare dashboards on camera; they may expose project metadata.

