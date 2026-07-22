# Greenlit legal and recordkeeping readiness

Last reviewed: July 20, 2026  
Product scope: U.S. business beta using synthetic or expressly non-confidential SOW material  
Status: hackathon-ready controls, not a substitute for advice from qualified counsel

## What the product records

Greenlit records a milestone-approval transaction, not a payment transaction or formal contract signature. The durable record includes:

- the agency, client, project, milestone, stated value, currency, and source name;
- SHA-256 hashes of the imported source and confirmed criteria, without persisting the full SOW;
- the exact criteria an owner confirmed, plus the notice version and owner acceptance event;
- each verification job, typed checks, observed results, timestamps, browser and runner versions;
- SHA-256 hashes and private storage paths for evidence screenshots;
- the frozen client-review snapshot and its hash;
- reviewer name, business email, decision, optional note, explicit authority/intent, electronic-record consent, notice version, and decision time;
- a sequential append-only event chain containing the previous hash and current event hash; and
- a final receipt hash plus a printable PDF view and downloadable JSON transaction export.

Raw IP addresses are not intentionally stored in the transaction record. Request context is converted to a keyed one-way actor hash. Original SOW text is processed in memory by Greenlit, but eligible Gemini requests are still subject to Google's data practices described below.

## Retention implemented

| Record | Default | Rationale / behavior |
| --- | ---: | --- |
| Review bearer link | 72 hours by default; 14-day hard limit | Limits exposure of a no-account review link; owners can revoke or extend it. |
| Screenshot evidence | 90 days | Keeps short-term visual evidence while minimizing retained page content. |
| Approval, verification, and audit record | 4 years | Aligns with California's four-year limitations period for actions on a written contract as a conservative beta default; it is not universal. |
| Privacy request | 24 months | Keeps a limited request-handling record. |
| Beta feedback / operational events | 24 months / 90 days | Supports issue handling while limiting diagnostic retention. |
| Agency notifications | 180 days | Keeps client-decision visibility without making the inbox a permanent ledger. |

A review link starts at 72 hours; the agency may revoke it or extend it within a 14-day hard limit. A daily, authenticated retention job removes expired screenshots, privacy requests, feedback, notifications, operational events, abuse counters, and transaction records after their retention date. A record-level or artifact-level legal hold prevents automatic deletion. Operators must document and periodically review legal holds.

## Legal design research

### Electronic records and attribution

- The federal E-SIGN Act generally prevents denying legal effect solely because a record or signature is electronic. Its retention rule requires the retained record to accurately reflect the information, remain accessible for the legally required period, and be reproducible. It also contains transaction-specific exclusions and consumer-disclosure rules. Source: [15 U.S.C. § 7001](https://uscode.house.gov/view.xhtml?req=%28title%3A15+section%3A7001+edition%3Aprelim%29).
- California's Uniform Electronic Transactions Act recognizes electronic records and signatures, permits attribution using the surrounding circumstances and security procedures, and requires retained electronic records to accurately reflect the original and remain accessible. Source: [California Civil Code §§ 1633.1–1633.17](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?division=3.&lawCode=CIV&part=2.&title=2.5.).
- The four-year beta retention default is informed by California's limitations period for an action on a written contract. Other claims, jurisdictions, tax rules, industries, and contracts can require different periods. Source: [California Code of Civil Procedure § 337](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?chapter=3.&lawCode=CCP&part=2.&title=2).

Product response: the reviewer must state a name and business email, affirm authority and intent, consent to electronic records, and take an unambiguous decision action. The frozen snapshot, decision, notice version, event chain, and reproducible export are retained together. The UI says this is a business approval record—not a notarization, payment guarantee, or general-purpose e-signature product.

### Privacy, notice, minimization, and security

- California law requires notice at or before collection, disclosed purposes and retention, reasonably necessary and proportionate collection/use, reasonable security, and appropriate processor contracts when the CCPA applies. Source: [California Civil Code § 1798.100](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.100.).
- CalOPPA requires a conspicuously posted privacy policy for covered commercial sites collecting California consumers' personal information, including categories, third-party categories, change notice, effective date, and online-tracking disclosures. Source: [California Business and Professions Code § 22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575).
- The FTC recommends collecting only what is needed, limiting access, protecting data in transit and at rest, verifying service providers, and having an incident plan. Source: [FTC, Start with Security](https://www.ftc.gov/business-guidance/resources/start-security-guide-business).
- The FTC has also warned AI companies to honor privacy and confidentiality commitments made to customers. Source: [FTC, AI Companies: Uphold Your Privacy and Confidentiality Commitments](https://www.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/01/ai-companies-uphold-your-privacy-confidentiality-commitments).

Product response: the app provides just-in-time collection notices, Privacy/Terms/Recordkeeping pages, a privacy-request form, source minimization, server-only database credentials, private evidence storage, HMAC-authenticated runner callbacks, authenticated agency accounts, HttpOnly reviewer sessions, revocable/expiring review links, abuse and capacity limits, operational triage, and authenticated retention automation.

### Accounting and tax-record boundary

- The IRS says a business may choose a recordkeeping system that clearly shows income and expenses, but must keep supporting records for as long as they may be needed to substantiate a tax return. It identifies invoices, receipts, payment records, journals, and ledgers as accounting support, and requires electronic tax records to remain complete, accurate, accessible, and reproducible. Sources: [IRS Recordkeeping](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping) and [IRS Publication 583](https://www.irs.gov/publications/p583).

Product response: Greenlit records a milestone-evidence and client-decision event only. It does not record payment settlement, revenue recognition, tax treatment, the final invoice, or the general ledger entry. Businesses must keep the Greenlit export alongside—never instead of—their contract, invoice, payment, and accounting records for the period their tax adviser and governing law require.

### Gemini unpaid-tier restriction

Google's Gemini API Additional Terms effective March 23, 2026 state that for unpaid services Google may use submitted content and generated responses to provide, improve, and develop products, and human reviewers may process API inputs and outputs. The terms instruct users not to submit sensitive, confidential, or personal information to unpaid services, limit EEA/Swiss/UK availability to paid services, and require 18+ professional or business use. Source: [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms).

Product response: no paid service was enabled. The UI requires separate non-confidential-data, unpaid-tier disclosure, and 18+/business/terms acknowledgments before calling Gemini. Requests identified as coming from the EEA, Switzerland, or the UK stay local and use the source-grounded fallback. This is a risk reduction, not a perfect geolocation or residency control.

## Controls that still require a real operator before commercial launch

The app should not be represented as generally “legally approved” or production-ready for arbitrary businesses until all of these are resolved:

1. Insert the actual operating entity's legal name, mailing address, monitored privacy/support contact, governing law, venue, and any required state business registrations.
2. Have counsel review the clickwrap, privacy notice, E-SIGN/UETA flow, liability language, evidence claims, retention schedule, and the intended contract and customer jurisdictions.
3. Do not send real customer SOWs through Gemini's unpaid tier. A commercial version should use provider terms and data controls approved by counsel and customers; that may require a paid or enterprise arrangement, which is intentionally outside this no-paid-services hackathon build.
4. Execute and retain applicable data-processing terms with Vercel, Cloudflare, Supabase, Google, and any future subprocessors; maintain a subprocessor register.
5. Add verified operator identity and monitored privacy-request operations. The database form is an intake mechanism, not a complete request-response program by itself.
6. Adopt the included incident-response and beta-operations runbooks; then schedule access reviews, secret rotation, backups/restore testing, dependency monitoring, and alert escalation with named owners.
7. Add stronger reviewer identity verification if customers will rely on decisions for payment disputes. Email text entry and contextual evidence support attribution but are not high-assurance identity proofing.
8. Define contract-specific legal holds and retention by jurisdiction and industry. Four years is only a beta default.
9. Keep invoices, payments, tax records, accounting ledgers, and formal signatures in the appropriate systems of record. Greenlit does not replace them.
10. Complete a full accessibility audit and security assessment before public commercial use.

## Operator checklist for the hackathon demo

- Use only the included synthetic SOW and staging fixture.
- Explain that AI drafts, the owner confirms, the browser observes, and the client decides.
- Show the exact-quote grounding, a real failing `rc1` network check, the passing `rc2` rerun, secure review, explicit approval intent, printable receipt, and JSON audit export.
- Avoid claims such as “legally binding everywhere,” “immutable,” “tamper-proof,” “certified,” or “guaranteed payment.” Use “append-only,” “hash-chained,” “tamper-evident,” “business approval record,” and “retained according to policy.”
- Keep the clearly labeled synthetic walkthrough separate from real verification: it creates no browser evidence, audit event, client transaction, or export. Only the real Cloudflare-backed flow creates a retained record.
