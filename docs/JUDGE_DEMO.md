# Greenlit demo video script (2:45)

Target length: 2:30 to 2:55. Record at 1440p or 1080p with the browser at 100% zoom. Keep the cursor deliberate and captions on.

## 0:00 to 0:15 | Cold open on the hidden failure

**Screen:** Open the failed `launch-rc1` result at AC-04. Hold on the visible “Request sent” message, then reveal the HTTP 500 response.

**Narration:**

“This page says the contact request was sent. The API says it failed. A screenshot would call this done. Greenlit catches what actually happened.”

## 0:15 to 0:32 | State the problem in plain language

**Screen:** Return to the homepage hero, then enter the public walkthrough.

**Narration:**

“A web agency says the milestone is finished. The client asks for proof. Greenlit follows each promise from the statement of work to an observed result, a client decision, and an invoice-ready record.”

## 0:32 to 0:55 | Turn one promise into a cited criterion

**Screen:** Show the synthetic SOW beside the generated criteria. Point to AC-04 and its exact source quote, then confirm the criteria.

**Narration:**

“Greenlit turns the scope into measurable acceptance criteria and keeps the exact supporting language beside each one. The agency reviews every criterion before it is frozen. AI can draft the structure, but a human decides what ‘done’ means.”

## 0:55 to 1:20 | Run typed checks and reveal the failure

**Screen:** Continue to the typed-check summary, run `launch-rc1`, and return to AC-04. Show the visible confirmation and failed request together.

**Narration:**

“Each supported promise maps to an allowlisted check, not arbitrary generated code. On the first build, the interface looks successful while the lead request returns HTTP 500. Greenlit records the failed observation against the exact promise.”

## 1:20 to 1:42 | Fix and rerun without moving the goalposts

**Screen:** Click **Verify fixed build**. On `launch-rc2`, point to the passing AC-04 result and the frozen-criteria label.

**Narration:**

“The agency fixes the build and reruns the same frozen criteria. There is no rewording the requirement to make the failure disappear. The corrected request succeeds, and all six sample promises now pass.”

## 1:42 to 2:10 | Client decision and invoice-ready record

**Screen:** Create the sample client review, open it as the client, approve the milestone, and open the printable sample record.

**Narration:**

“The client sees the promise, expected outcome, and observed result together. One clear approval turns the milestone into an invoice-ready sample record. In a retained project, the record also links the frozen source revision, evidence manifest, reviewer intent, and transaction history.”

## 2:10 to 2:30 | Say exactly what is real

**Screen:** Open `/trust` and hold on **What is real today**.

**Narration:**

“This public walkthrough runs live on the deployed app with no account. Its outcomes are seeded, synthetic, and do not create a customer record. The account-based Gemini, queued browser, private storage, and Stripe paths require configured services and available capacity. Broader production guarantees remain planned, not promised.”

## 2:30 to 2:45 | Architecture and close

**Screen:** Show the README architecture diagram, then finish on the homepage proof card.

**Narration:**

“Vercel serves the product, Gemini supports source analysis, Cloudflare runs queued browser checks, Supabase stores private records, and Stripe supports the optional invoice handoff. Greenlit: the page says success; the evidence tells the truth.”

## Recording safety net

- Use only the included synthetic SOW.
- Start with a new private browser window and the production walkthrough URL. No sign-in or prior session should be required.
- Use the public walkthrough for the main recording. Its seeded outcomes create no browser-evidence, approval, or transaction record.
- If showing the retained project path separately, use only a pre-approved test account and synthetic data. Do not describe optional infrastructure as part of the seeded walkthrough.
- Do one dry run before recording so the browser has no permission prompts.
- Avoid opening Vercel, Supabase, Cloudflare, Stripe, or personal email dashboards on camera because they may expose project metadata.
