export type ResourceTemplate = {
  label: string;
  content: string;
};

export type ResourceSection = {
  title: string;
  eyebrow?: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: Array<{ title: string; detail: string }>;
  table?: {
    columns: string[];
    rows: string[][];
  };
  templates?: ResourceTemplate[];
  callout?: {
    title: string;
    body: string;
    tone?: "neutral" | "warning" | "success";
  };
};

export type ResourceGuide = {
  slug: string;
  category: "Start here" | "Run a milestone" | "Work with clients" | "Grow the beta";
  title: string;
  summary: string;
  audience: string;
  readTime: string;
  downloadHref?: string;
  sections: ResourceSection[];
};

export const resourceGuides: ResourceGuide[] = [
  {
    slug: "agency-quickstart",
    category: "Start here",
    title: "Agency quick-start",
    summary: "Go from a scoped milestone to a client-ready proof packet in one focused session.",
    audience: "Agency owners and project leads",
    readTime: "8 min",
    downloadHref: "/resources/downloads/greenlit-agency-quickstart.md",
    sections: [
      {
        eyebrow: "Before you begin",
        title: "Choose one small, reviewable milestone",
        paragraphs: [
          "For your first Greenlit project, use a milestone that is already described in a signed or agreed scope and has a staging build ready for review.",
          "The best first milestone has three to six outcomes that a client can understand. Avoid using an entire website launch as one milestone.",
        ],
        bullets: [
          "Use a public HTTPS staging URL that your agency controls.",
          "Use a redacted, synthetic, or expressly non-confidential SOW section unless the analysis screen confirms a paid data mode.",
          "Choose one client decision-maker and agree on a review deadline.",
          "Keep contracts, formal signatures, accounting records, and payments in their existing systems.",
        ],
      },
      {
        eyebrow: "First milestone path",
        title: "Complete the first proof flow",
        steps: [
          { title: "Open the workspace", detail: "Sign in with the invited agency email and choose New import. If you want to learn the flow first, launch the guided synthetic demo." },
          { title: "Add the promise", detail: "Paste or upload the relevant SOW section. Include only the language needed to define this milestone." },
          { title: "Review every criterion", detail: "Check each exact source quote, rewrite vague outcomes, choose whether the criterion is automated or client-reviewed, then confirm the grounded revision." },
          { title: "Verify staging ownership", detail: "Add the one-time Greenlit ownership file to the approved staging origin and complete the origin check." },
          { title: "Map and run checks", detail: "Map each automated promise to a supported typed check. Run the verification and review expected versus observed results." },
          { title: "Resolve failures", detail: "If a check fails, fix the build and run the frozen criteria against the corrected version. Do not rewrite the requirement to make a failure disappear." },
          { title: "Prepare client review", detail: "Name one reviewer, set a clear deadline, confirm the milestone value, and decide whether Greenlit should only prepare an invoice or create a configured Stripe invoice after approval." },
          { title: "Share securely", detail: "Send the one-time review link and its separate access code through different business channels. Do not post either publicly." },
          { title: "Record the decision", detail: "The client reviews the criteria and evidence, then approves or requests changes. New scope should be classified separately from a correction to the agreed milestone." },
          { title: "Finish the handoff", detail: "Export or print the approval record, confirm the invoice result, and store the record with the agency's normal project and accounting files." },
        ],
      },
      {
        title: "Definition of a successful first use",
        bullets: [
          "The agency confirms at least one source-grounded criterion.",
          "A retained browser run completes against an authorized staging origin.",
          "A client opens the focused review without needing product training.",
          "The client makes a clear approve or request-changes decision.",
          "The agency can retrieve the resulting record from its dashboard.",
        ],
        callout: {
          title: "Start with a real bottleneck, not the biggest project",
          body: "The ideal beta test is one milestone where the agency would otherwise chase approval through email. A narrow real workflow will teach Greenlit more than a broad hypothetical evaluation.",
          tone: "success",
        },
      },
    ],
  },
  {
    slug: "client-reviewer-guide",
    category: "Work with clients",
    title: "Client reviewer guide",
    summary: "A forwardable explanation of what a client will see, decide, and retain.",
    audience: "Client reviewers",
    readTime: "4 min",
    downloadHref: "/resources/downloads/greenlit-client-reviewer-guide.md",
    sections: [
      {
        eyebrow: "Why you received a link",
        title: "Review the agreed milestone, with the proof beside it",
        paragraphs: [
          "Your agency is using Greenlit to show how a specific milestone matches the acceptance criteria agreed for the project. The review page keeps the promise, observed result, and supporting evidence together.",
          "You do not need to understand the agency's testing tools. Read each outcome in plain language and decide whether the milestone is ready to approve or needs changes.",
        ],
      },
      {
        title: "How to complete the review",
        steps: [
          { title: "Open the private link", detail: "Use the review link from your agency and enter the separately shared access code if requested." },
          { title: "Confirm the context", detail: "Check the client, project, milestone, value, build, reviewer identity, and response deadline." },
          { title: "Read each criterion", detail: "Compare the exact source language, expected outcome, observed result, and available evidence." },
          { title: "Choose a decision", detail: "Approve when the agreed milestone is acceptable. Request changes when an agreed criterion has not been met or when clarification is needed." },
          { title: "Classify new requests", detail: "If the request adds work not contained in the frozen milestone, identify it as possible new scope so the agency can estimate it separately." },
          { title: "Keep your receipt", detail: "After a final decision, use the receipt view to print or save the record for your files." },
        ],
      },
      {
        title: "What your decision means",
        bullets: [
          "Approval records your business decision about this milestone and the evidence shown.",
          "Requesting changes does not automatically decide whether a request is included in the original price.",
          "Approval may make the milestone invoice-ready or trigger a previously disclosed Stripe invoice workflow.",
          "Approval does not charge a card or bank account.",
          "Greenlit is not a notarization service, accounting ledger, payment guarantee, or replacement for a contract or formal signature product.",
        ],
        callout: {
          title: "Only use the link intended for you",
          body: "Do not forward the review link or access code. Contact the agency if the project, milestone, value, reviewer, or evidence appears incorrect.",
          tone: "warning",
        },
      },
      {
        title: "Message an agency can send with the link",
        templates: [
          {
            label: "Client introduction",
            content: `Hi [Client first name],

We have finished the [milestone name] milestone and prepared a focused Greenlit review.

Greenlit shows the agreed acceptance criteria, what we observed on the staging build, and the supporting evidence in one place. Please review it by [deadline] and choose Approve or Request changes.

Review link: [private link]

I will send the one-time access code separately. The review should take about [X] minutes. If anything in the project details or milestone value looks incorrect, please stop and contact me.

Thanks,
[Agency contact]`,
          },
        ],
      },
    ],
  },
  {
    slug: "milestone-templates",
    category: "Run a milestone",
    title: "Website milestone template library",
    summary: "Ten practical starting points for scoping, reviewing, and approving agency work.",
    audience: "Project leads, designers, developers, and QA",
    readTime: "12 min",
    downloadHref: "/resources/downloads/greenlit-milestone-templates.md",
    sections: [
      {
        title: "How to use the templates",
        paragraphs: [
          "Copy only the criteria that match the signed scope. Replace every bracketed value with a measurable project-specific value, then attach the exact supporting source language.",
          "These are workflow examples, not contract language. The agency remains responsible for confirming that each criterion is authorized, accurate, and appropriate for the project.",
        ],
      },
      {
        eyebrow: "01",
        title: "Discovery and requirements approval",
        bullets: [
          "The approved sitemap contains [number] primary pages and identifies their parent-child relationships.",
          "The documented audience includes [named audience segments].",
          "The approved feature list identifies included, excluded, and deferred functionality.",
          "The client has supplied or assigned an owner for every required content and access dependency.",
        ],
      },
      {
        eyebrow: "02",
        title: "Wireframe approval",
        bullets: [
          "Wireframes are provided for [named page types] at desktop and mobile widths.",
          "Every required content section in the approved sitemap appears in its corresponding wireframe.",
          "Primary calls to action and their destinations are identified on each applicable page.",
          "Open comments are resolved or explicitly deferred before visual design begins.",
        ],
      },
      {
        eyebrow: "03",
        title: "Visual design approval",
        bullets: [
          "Approved designs are supplied for [named templates] at [desktop width] and [mobile width].",
          "The design uses the approved logo, color palette, typography, and imagery direction.",
          "Navigation, interactive states, forms, errors, and empty states are represented where applicable.",
          "The client has approved the presented visual direction before development begins.",
        ],
      },
      {
        eyebrow: "04",
        title: "Development milestone",
        bullets: [
          "The staging build contains [named templates and features] from the approved scope.",
          "Primary navigation reaches the expected destination from desktop and mobile layouts.",
          "Required forms validate inputs and produce the agreed success behavior.",
          "The build has no horizontal overflow at the approved mobile viewport.",
          "No known severity-one or severity-two defects remain in the milestone.",
        ],
      },
      {
        eyebrow: "05",
        title: "Staging and UAT approval",
        bullets: [
          "The reviewer can complete [named primary user journey] on the approved staging build.",
          "Expected success and error states are visible for [named forms or transactions].",
          "All agreed browser and device combinations have been reviewed.",
          "Every blocking issue is resolved; non-blocking issues are listed with an agreed disposition.",
          "The named client reviewer has approved the frozen milestone revision.",
        ],
      },
      {
        eyebrow: "06",
        title: "Content and SEO approval",
        bullets: [
          "Final approved copy is present on [named pages].",
          "Every indexable page has a unique title and meta description within the agreed limits.",
          "One H1 is present on each agreed page and matches the approved topic.",
          "Images use approved alternative text or are marked decorative where appropriate.",
          "Redirects from [source URL list] reach their approved destinations.",
        ],
      },
      {
        eyebrow: "07",
        title: "Responsive and accessibility review",
        bullets: [
          "The agreed journeys remain usable at [named viewport widths].",
          "Interactive controls are reachable and operable using a keyboard.",
          "Visible focus styling is present for interactive controls.",
          "Form fields have programmatic labels and errors are described in text.",
          "Automated checks report no [agreed severity] issues on the named pages.",
        ],
        callout: {
          title: "Do not call this a certification",
          body: "A limited automated or manual review does not prove full accessibility conformance. Describe the pages, standards, tools, and checks actually included.",
          tone: "warning",
        },
      },
      {
        eyebrow: "08",
        title: "Launch readiness",
        bullets: [
          "The production domain, DNS, TLS, analytics, and approved redirects are configured.",
          "Forms deliver to the agreed destination and have been tested using production-safe data.",
          "The current backup and rollback procedure has been verified.",
          "The client has approved the final launch candidate identified as [build or release].",
          "The agency and client have agreed on launch timing, support coverage, and rollback authority.",
        ],
      },
      {
        eyebrow: "09",
        title: "Post-launch stabilization",
        bullets: [
          "The named primary journeys have been checked on the production domain.",
          "Launch-critical monitoring reports no unresolved blocking incident.",
          "Issues reported during the stabilization window are resolved or documented with an owner and target date.",
          "The client has received the agreed credentials, documentation, and handoff materials.",
        ],
      },
      {
        eyebrow: "10",
        title: "Monthly maintenance or retainer release",
        bullets: [
          "The agreed updates for [month or cycle] are deployed to the identified environment.",
          "The agency has supplied a concise list of completed work and any deferred items.",
          "Required backups, dependency updates, and monitoring checks were completed as scoped.",
          "The client has reviewed and accepted the cycle before the related invoice is finalized.",
        ],
      },
    ],
  },
  {
    slug: "acceptance-criteria",
    category: "Run a milestone",
    title: "Writing measurable acceptance criteria",
    summary: "Turn vague scope language into outcomes that an agency and client can review consistently.",
    audience: "Anyone preparing a milestone",
    readTime: "9 min",
    downloadHref: "/resources/downloads/greenlit-acceptance-criteria-guide.md",
    sections: [
      {
        title: "Use the ACT test",
        table: {
          columns: ["Test", "Question", "Good signal"],
          rows: [
            ["Atomic", "Does the criterion describe one outcome?", "One pass or fail decision"],
            ["Concrete", "Can a client recognize the expected result?", "Named page, action, value, or state"],
            ["Traceable", "Can it be tied to exact agreed language?", "A precise SOW quote or approved amendment"],
          ],
        },
      },
      {
        title: "A useful criterion formula",
        templates: [
          {
            label: "Criterion formula",
            content: `On [approved environment or page], when [authorized action or condition occurs], the product must [observable outcome] within/at [measurable threshold], as required by “[exact source quote].”`,
          },
        ],
      },
      {
        title: "Rewrite vague promises",
        table: {
          columns: ["Vague", "More measurable"],
          rows: [
            ["The website will be responsive.", "At 390 px viewport width, the approved pages have no horizontal overflow and the primary navigation remains operable."],
            ["The form should work.", "Submitting valid name, business email, and message values creates the agreed success response without a client-visible error."],
            ["The site will be fast.", "The agreed landing page meets the named performance threshold using the stated tool, device profile, and test conditions."],
            ["SEO will be implemented.", "Each named indexable page has one unique title, one meta description, one H1, and the approved canonical URL."],
            ["The design will match the mockup.", "The named components, content hierarchy, colors, type styles, and states match the approved design revision at the agreed viewports."],
            ["The site will be accessible.", "The named pages and journeys pass the listed keyboard, labeling, focus, contrast, and automated checks in the agreed review scope."],
          ],
        },
      },
      {
        title: "Choose the right evidence",
        table: {
          columns: ["Claim", "Best evidence"],
          rows: [
            ["Visible content or layout", "Screenshot plus page URL and viewport"],
            ["Navigation behavior", "Recorded browser action and final URL/state"],
            ["Form submission", "Browser action plus observed network and success state"],
            ["Client preference or subjective quality", "Explicit client review decision"],
            ["External business outcome", "Authorized system record outside Greenlit"],
            ["Compliance or certification", "Qualified assessment, not a generic browser check"],
          ],
        },
      },
      {
        title: "Final review questions",
        bullets: [
          "Would two reasonable reviewers interpret the criterion the same way?",
          "Is the environment, page, action, threshold, or expected state named?",
          "Does the source quote actually support the criterion?",
          "Can Greenlit collect the required evidence safely and without unapproved side effects?",
          "Is a human client decision more appropriate than automation?",
          "Would changing this criterion after work is finished alter the agreed scope?",
        ],
      },
    ],
  },
  {
    slug: "approval-email-templates",
    category: "Work with clients",
    title: "Approval email template pack",
    summary: "Copy-ready messages for requesting, reminding, revising, approving, and invoicing.",
    audience: "Account and project managers",
    readTime: "7 min",
    downloadHref: "/resources/downloads/greenlit-approval-email-templates.txt",
    sections: [
      {
        title: "First review request",
        templates: [{
          label: "Subject: [Milestone] is ready for your review",
          content: `Hi [First name],

The [milestone name] milestone is ready for review.

We prepared a Greenlit proof page that keeps the agreed criteria, staging results, and supporting evidence together. Please review it and choose Approve or Request changes by [day, date, time zone].

Review link: [private link]

I will send the one-time access code separately. The review should take about [X] minutes.

If the project, value, build, or reviewer details look incorrect, please stop and reply to this email.

Thanks,
[Name]`,
        }],
      },
      {
        title: "Friendly reminder",
        templates: [{
          label: "Subject: Quick reminder: [Milestone] review",
          content: `Hi [First name],

A quick reminder that the [milestone name] review is waiting for your decision by [deadline].

Review link: [private link]

If you need another reviewer, more context, or a different deadline, let me know and I will update the review rather than forwarding the private link.

Thanks,
[Name]`,
        }],
      },
      {
        title: "Deadline approaching",
        templates: [{
          label: "Subject: [Milestone] review is due [day]",
          content: `Hi [First name],

The review window for [milestone name] closes [day, date, time zone]. We need your approval or change request before we can complete the billing handoff and move to [next phase].

Review link: [private link]

If something is blocking the review, reply with the issue and the right decision-maker so we can resolve it.

Thanks,
[Name]`,
        }],
      },
      {
        title: "Changes requested",
        templates: [{
          label: "Subject: We received your [Milestone] changes",
          content: `Hi [First name],

We received your change request for [milestone name].

We are reviewing each item against the frozen milestone criteria. We will confirm which items correct the agreed scope, which need clarification, and which may be new scope by [date].

No invoice will be created from this review decision.

Thanks,
[Name]`,
        }],
      },
      {
        title: "Updated build ready",
        templates: [{
          label: "Subject: Updated [Milestone] build is ready",
          content: `Hi [First name],

We addressed the agreed changes and verified the updated build identified as [build/release].

Please use this new review link and decide by [deadline]:
[private link]

The prior review remains part of the project history. This review shows the current evidence and results.

Thanks,
[Name]`,
        }],
      },
      {
        title: "Approval received",
        templates: [{
          label: "Subject: [Milestone] approved",
          content: `Hi [First name],

Thank you. Your approval of [milestone name] was recorded on [date and time zone].

[Choose one: The milestone is now ready for our normal invoicing process. / The previously disclosed Stripe invoice workflow has been started.]

You can retain the Greenlit receipt for your files:
[receipt link or attached PDF]

Next, we will [next step].

Thanks,
[Name]`,
        }],
      },
      {
        title: "Possible new scope",
        templates: [{
          label: "Subject: Follow-up on your [Milestone] request",
          content: `Hi [First name],

We reviewed your request: “[short request summary].”

The frozen milestone covers [relevant agreed outcome]. The new request appears to add [new outcome or deliverable], so we are treating it as a possible scope change rather than silently adding it to the current milestone.

We will send a short impact summary covering price, timing, and dependencies by [date]. The existing milestone decision remains [status].

Thanks,
[Name]`,
        }],
      },
    ],
  },
  {
    slug: "beta-handbook",
    category: "Start here",
    title: "Closed beta handbook",
    summary: "The working agreement for agencies helping test Greenlit.",
    audience: "Invited beta agencies",
    readTime: "8 min",
    downloadHref: "/resources/downloads/greenlit-beta-handbook.md",
    sections: [
      {
        title: "What the beta is testing",
        paragraphs: [
          "Greenlit is testing whether evidence-backed milestone review helps web agencies shorten approval delays, separate fixes from new scope, and move approved work into invoicing with a clearer record.",
          "The beta is not a test of whether every possible website requirement can be automated. Human confirmation and client judgment remain deliberate parts of the workflow.",
        ],
      },
      {
        title: "Good beta projects",
        bullets: [
          "A web-design or development milestone with three to six clear acceptance criteria.",
          "An agency-controlled public HTTPS staging site.",
          "One named client reviewer who can respond within a defined window.",
          "A milestone where approval delay or disputed completeness is a real concern.",
          "A team willing to spend 20 minutes onboarding and 20 minutes giving feedback.",
        ],
      },
      {
        title: "Do not use the beta for",
        bullets: [
          "Secrets, credentials, payment-card data, government identifiers, health data, employment records, or other regulated information.",
          "A third-party site you are not authorized to test.",
          "A legal signature, notarization, certification, accounting ledger, or payment guarantee.",
          "An unbounded production test that could place orders, send messages, or modify real customer data.",
          "A promise that depends on evidence Greenlit cannot safely observe.",
        ],
      },
      {
        title: "What we ask from each agency",
        steps: [
          { title: "Onboarding", detail: "Complete the guided sample and one real project setup." },
          { title: "Real use", detail: "Run at least one staging verification and invite one client reviewer when appropriate." },
          { title: "Feedback", detail: "Report confusing steps and failures through the in-product Beta feedback button without pasting client data." },
          { title: "Conversation", detail: "Join one short feedback interview after the workflow is complete or abandoned." },
          { title: "Evidence permission", detail: "Choose separately whether Greenlit may quote or publish any result. Beta participation does not grant automatic publicity rights." },
        ],
      },
      {
        title: "Current beta boundaries",
        bullets: [
          "Access is invitation-only and may be removed.",
          "Review links expire and may be revoked.",
          "Verification capacity is intentionally limited.",
          "Some staging protections, cross-origin assets, or unusual application flows may not be supported.",
          "The guided sample is synthetic and does not create a retained transaction.",
          "Live invoicing remains subject to the agency's Stripe configuration and the disclosures shown in product.",
        ],
        callout: {
          title: "Need help?",
          body: "Use the in-product Beta feedback button for product issues. Use the published support contact for account, privacy, or security questions. Do not send client SOW text or credentials in a support ticket.",
        },
      },
    ],
  },
  {
    slug: "faq",
    category: "Start here",
    title: "Frequently asked questions",
    summary: "Clear answers about verification, client decisions, scope, security, records, and invoicing.",
    audience: "Agencies and client stakeholders",
    readTime: "10 min",
    sections: [
      {
        title: "Product and workflow",
        steps: [
          { title: "What is Greenlit?", detail: "Greenlit turns agreed SOW language into agency-confirmed acceptance criteria, runs supported checks against an authorized staging build, presents the evidence to one named reviewer, and records the client's decision." },
          { title: "Does Greenlit replace project management software?", detail: "No. It focuses on the last mile between agreed scope, proof, approval, and invoice readiness. The agency can continue managing tasks in its existing system." },
          { title: "Does AI decide whether the work is complete?", detail: "No. AI may draft criteria from exact source language. The agency confirms the criteria and mappings, supported checks observe the build, and the named client reviewer makes the business decision." },
          { title: "Can every requirement be automated?", detail: "No. Subjective, external, unsafe, or unsupported claims should remain client-reviewed or be verified in the appropriate external system." },
        ],
      },
      {
        title: "Client review and scope",
        steps: [
          { title: "Does the client need a Greenlit account?", detail: "The review uses a recipient-bound link and separate access code. The client does not use the agency workspace." },
          { title: "What happens when the client requests changes?", detail: "The request is recorded against the milestone. The agency can determine whether it corrects an agreed criterion, needs clarification, or appears to add new scope." },
          { title: "Can an approval be treated as a contract signature?", detail: "Greenlit records a milestone decision, but it is not positioned as a replacement for a contract, notarization, or formal electronic-signature product where one is required." },
          { title: "Can a review be forwarded?", detail: "It should not be. The agency should revoke the existing invitation and create the correct recipient-bound review." },
        ],
      },
      {
        title: "Verification and evidence",
        steps: [
          { title: "What does a passing check prove?", detail: "It shows that a supported observation matched the frozen expected result for the identified build, time, environment, and check. It does not prove facts outside that scope." },
          { title: "What if the page looks successful but the API fails?", detail: "Greenlit can preserve the difference between the visible state and the observed request result when that typed check is supported, preventing a cosmetic success message from hiding a failed operation." },
          { title: "Can the agency edit criteria after a run?", detail: "Changes should create a new confirmed revision. The frozen revision and prior evidence remain part of the record rather than being silently rewritten." },
          { title: "Is Greenlit an accessibility certification?", detail: "No. It may support specific accessibility-related observations, but it does not certify conformance." },
        ],
      },
      {
        title: "Invoicing and records",
        steps: [
          { title: "Does approval charge the client?", detail: "No. Approval never directly charges a payment method. Depending on prior agency configuration, it can make a milestone invoice-ready or start a disclosed Stripe invoice workflow." },
          { title: "Is Greenlit the accounting system of record?", detail: "No. The agency remains responsible for invoice accuracy, taxes, delivery, payment collection, refunds, disputes, and accounting." },
          { title: "How long is evidence retained?", detail: "The current beta notice describes 90 days for screenshot evidence and four years by default for approval and audit records, subject to configuration and legal holds." },
          { title: "Can a record be exported?", detail: "The client receipt can be printed or saved as PDF, and retained agency records remain available through the authorized dashboard subject to the product's retention rules." },
        ],
      },
      {
        title: "Data and access",
        steps: [
          { title: "What SOW information should I submit?", detail: "Use only the section needed for the milestone. Follow the analysis-screen notice about whether the deployment accepts authorized business content or only synthetic and expressly non-confidential material." },
          { title: "Can Greenlit test any URL?", detail: "No. Custom verification is restricted to public HTTPS staging origins controlled by the signed-in agency and proven through the ownership flow." },
          { title: "Where do I report a problem?", detail: "Use the in-product Beta feedback button for bugs, confusion, and product ideas. Use the published support contact for privacy, access, or security concerns." },
        ],
      },
    ],
  },
  {
    slug: "integrations",
    category: "Run a milestone",
    title: "Integration playbook",
    summary: "Fit Greenlit into the agency tools already used for delivery, communication, design, and billing.",
    audience: "Agency operations and technical leads",
    readTime: "8 min",
    sections: [
      {
        title: "Current integration principle",
        paragraphs: [
          "Greenlit should remain the source of the frozen milestone proof and client decision. Task management, design production, communication, file storage, and accounting can remain in the systems the agency already uses.",
          "Only Stripe has a product-level invoicing handoff in the current beta. The other workflows below are safe operating patterns and roadmap targets, not claims of native integrations.",
        ],
      },
      {
        title: "Recommended workflow by tool",
        table: {
          columns: ["Tool", "Use it for", "Greenlit handoff"],
          rows: [
            ["Asana / ClickUp / Jira / Linear", "Tasks, owners, defects, engineering status", "Link the Greenlit milestone or record from the delivery task; do not duplicate the approval history as editable task text."],
            ["Slack / Teams", "Internal alerts and coordination", "Share record identifiers and safe links only. Keep SOW text, access codes, and sensitive evidence out of broad channels."],
            ["Figma", "Design source and comments", "Use the approved design revision as the milestone reference, then capture the client's final milestone decision in Greenlit."],
            ["Google Drive / Dropbox", "Project files and handoff documents", "Store exported receipts with the agency's project record using a stable naming convention."],
            ["Stripe", "Invoice creation, delivery, hosted payment, status", "Configure the invoice plan before client review. Greenlit can create the disclosed invoice after approval when enabled."],
            ["QuickBooks / Xero", "Accounting ledger, taxes, reconciliation", "Record or sync the final invoice through the agency's existing accounting process. Greenlit is not the ledger."],
            ["Zapier / Make", "Future cross-tool automation", "Good roadmap path for status alerts and record links, but avoid automating approval decisions or broad evidence disclosure."],
          ],
        },
      },
      {
        title: "A safe manual handoff",
        steps: [
          { title: "Delivery task", detail: "Create one task for the milestone review with the owner, client decision-maker, deadline, and Greenlit record identifier." },
          { title: "Client communication", detail: "Send the recipient-bound review link directly. Send the access code through a separate agreed channel." },
          { title: "Decision update", detail: "After the client decides, update the project-management task with the decision, date, and a safe link to the retained record." },
          { title: "Billing", detail: "Confirm the invoice result in Stripe or the agency's accounting system and reconcile it using the Greenlit record identifier." },
          { title: "Archive", detail: "Store the exported approval receipt alongside the relevant SOW, amendment, and invoice record." },
        ],
      },
      {
        callout: {
          title: "Roadmap rule",
          body: "The first integrations should move identifiers, status, and safe links. They should not copy private evidence, reviewer access codes, or full SOW text into broad third-party channels.",
          tone: "warning",
        },
        title: "What Greenlit should integrate next",
        bullets: [
          "One project-management integration selected from beta usage, not assumption.",
          "Slack or Teams decision notifications with minimal metadata.",
          "Google Drive export for completed approval receipts.",
          "Zapier or Make triggers for milestone status and invoice readiness.",
          "Accounting handoff after the Stripe workflow is stable.",
        ],
      },
    ],
  },
  {
    slug: "troubleshooting",
    category: "Run a milestone",
    title: "Troubleshooting guide",
    summary: "Resolve the most likely onboarding, staging, verification, review, and invoice problems.",
    audience: "Agency operators",
    readTime: "10 min",
    sections: [
      {
        title: "Sign-in or invitation problem",
        steps: [
          { title: "Confirm the exact email", detail: "Use the same business email that received the closed-beta invitation. Aliases and alternate domains may not be allowed." },
          { title: "Use the newest magic link", detail: "Open the most recent sign-in email in the same browser where possible. Older links may have expired or been superseded." },
          { title: "Check the deployment URL", detail: "Make sure the link returns to the official Greenlit production domain rather than an old preview or local address." },
          { title: "Escalate safely", detail: "Send the business email and error text to support. Do not forward authentication links." },
        ],
      },
      {
        title: "SOW analysis problem",
        bullets: [
          "Use a supported PDF, TXT, or Markdown file, or paste the relevant text.",
          "For a scanned PDF, extract the text separately and verify it before submission.",
          "Reduce the input to the milestone section rather than uploading an entire contract.",
          "If AI is unavailable, use the local source-grounded draft and review every quote carefully.",
          "Never weaken a criterion merely because it is difficult to verify.",
        ],
      },
      {
        title: "Staging ownership will not verify",
        steps: [
          { title: "Confirm HTTPS", detail: "The staging origin must be a public HTTPS address." },
          { title: "Use the exact origin", detail: "Protocol, hostname, and port must match the staging URL entered in Greenlit." },
          { title: "Check the ownership file", detail: "Serve the provided token at the exact .well-known path without HTML wrappers, redirects to another origin, or authentication." },
          { title: "Check protection rules", detail: "Password-protected previews and platform deployment protection may block verification. Use a supported public staging route or follow the provider-specific prerequisite." },
          { title: "Retry after deployment", detail: "CDN propagation and cached 404 responses can delay a newly added file." },
        ],
      },
      {
        title: "A verification run fails",
        table: {
          columns: ["Symptom", "Likely cause", "Next action"],
          rows: [
            ["Page did not load", "Protection, DNS, TLS, redirect, or unsupported origin", "Open the exact URL in a private browser and confirm it is publicly reachable."],
            ["Assets or interactions are missing", "A required cross-origin asset or script was blocked", "Document the external origin and use a supported build configuration. Do not broaden access silently."],
            ["Visible success but check failed", "The underlying request or expected state did not succeed", "Inspect the observed result and fix the application rather than the Greenlit criterion."],
            ["Check cannot be mapped", "The promise is subjective, external, unsafe, or unsupported", "Leave it for explicit client review or verify it in the appropriate system."],
            ["Capacity message", "Closed-beta browser limit reached", "Use the guided sample or retry during the next capacity window. Do not repeatedly submit."],
          ],
        },
      },
      {
        title: "Client cannot open the review",
        bullets: [
          "Confirm the review has not expired, been revoked, or already received a final decision.",
          "Confirm the client is using the intended business email and the newest invitation.",
          "Send the private link and access code through separate channels.",
          "Do not forward another reviewer's invitation. Revoke it and create the correct review.",
          "If a corporate link scanner consumed the link, contact support with the record identifier and recipient domain.",
        ],
      },
      {
        title: "Invoice was not created",
        steps: [
          { title: "Check the review disclosure", detail: "Confirm that an invoice plan was configured before the client review and that the reviewer saw the correct billing disclosure." },
          { title: "Check Stripe connection", detail: "Confirm the agency's intended Stripe account is connected and authorized." },
          { title: "Check mode", detail: "A test-mode invoice will not email or charge the client. Live behavior requires the separately enabled live deployment." },
          { title: "Check the dashboard", detail: "Use the retained invoice status and operator notifications before attempting a manual duplicate." },
          { title: "Reconcile in Stripe", detail: "Stripe remains the invoice and payment source of truth. Never create a second invoice until the first attempt is resolved." },
        ],
      },
    ],
  },
  {
    slug: "agency-playbook",
    category: "Grow the beta",
    title: "Agency sales and client-introduction playbook",
    summary: "Position Greenlit around faster decisions, clearer scope, and a more professional handoff.",
    audience: "Agency owners, sales, and account leads",
    readTime: "9 min",
    sections: [
      {
        title: "One-sentence positioning",
        templates: [{
          label: "Positioning statement",
          content: "Greenlit turns the acceptance criteria already in your SOW into a client-ready proof page, records the approval decision, and gives the agency a clear handoff into invoicing.",
        }],
      },
      {
        title: "Thirty-second explanation",
        templates: [{
          label: "Agency introduction",
          content: `The last stage of a web milestone is usually scattered across a staging link, email threads, screenshots, and an invoice conversation. Greenlit keeps the agreed promise, verification evidence, and client decision together. The agency still controls the scope and the client still makes the decision, but both sides can see exactly what is being approved.`,
        }],
      },
      {
        title: "Client call script",
        templates: [{
          label: "Introducing Greenlit on a project call",
          content: `For this milestone, we are going to use Greenlit for the final review. Instead of sending you a staging link and asking whether everything looks good, we will send a focused page showing the criteria we agreed, what we observed on the build, and the relevant evidence.

You will be able to approve the milestone or request changes. If a request adds something outside the frozen criteria, we will flag it for a separate scope conversation instead of mixing it into the existing work.

The review does not charge a payment method. It creates a clear project decision and, depending on the billing setup we show you, may make the milestone ready for invoicing. The review should take about [X] minutes, and I will remain your contact for any questions.`,
        }],
      },
      {
        title: "Discovery questions for an agency",
        bullets: [
          "How do clients currently approve a completed milestone?",
          "How many messages or meetings usually happen between completion and approval?",
          "Who has authority to give the final decision?",
          "What makes clients hesitate or request another review round?",
          "How do you distinguish a bug from new scope?",
          "What has to happen before an invoice can be sent?",
          "How many days usually pass between finishing work and invoicing it?",
        ],
      },
      {
        title: "Common objections",
        table: {
          columns: ["Objection", "Response"],
          rows: [
            ["We already use Asana or ClickUp.", "Keep it. Greenlit focuses on the client decision and proof record at the end of the milestone, not day-to-day task management."],
            ["Our clients will not learn another tool.", "The client receives a focused review rather than an agency workspace. The reviewer guide explains the decision in a few steps."],
            ["A screenshot is enough.", "A screenshot can show appearance, but it does not keep the exact promise, build, observed behavior, reviewer, and decision together."],
            ["We do not want AI changing the scope.", "AI suggestions are drafts tied to exact source quotes. The agency confirms the criteria before any verification or client review."],
            ["Can this replace our contract?", "No. Greenlit complements the contract by recording evidence and a milestone decision. The contract and formal signature process remain separate."],
          ],
        },
      },
      {
        title: "A concise sales one-pager",
        templates: [{
          label: "One-page copy",
          content: `GREENLIT
Turn your SOW into proof.

THE PROBLEM
Finished web work often sits between a staging link, scattered feedback, unclear sign-off, and a delayed invoice.

THE WORKFLOW
1. Freeze the agreed milestone criteria.
2. Verify supported outcomes on the authorized staging build.
3. Give one named client reviewer a focused proof page.
4. Record approval or requested changes.
5. Move the approved milestone into the agency's invoice workflow.

FOR THE AGENCY
Clearer scope, fewer approval chases, evidence attached to the decision, and a cleaner billing handoff.

FOR THE CLIENT
Plain-language expectations, visible evidence, one review deadline, and a decision receipt.

IMPORTANT
Greenlit is not a contract, legal-signature service, accounting ledger, certification, or payment guarantee.

NEXT STEP
Test one real milestone in the closed agency beta.`,
        }],
      },
    ],
  },
  {
    slug: "case-study-kit",
    category: "Grow the beta",
    title: "Case study capture kit",
    summary: "Collect credible customer evidence without inventing outcomes or pressuring beta testers.",
    audience: "Greenlit beta operators",
    readTime: "8 min",
    sections: [
      {
        title: "Capture the baseline before use",
        bullets: [
          "How the agency currently requests milestone approval.",
          "Typical number of review rounds.",
          "Typical days from work completion to client decision.",
          "Typical days from completion to invoice creation.",
          "Time spent preparing proof and chasing the decision.",
          "Most common cause of approval delay or scope disagreement.",
        ],
      },
      {
        title: "Post-use interview",
        steps: [
          { title: "Situation", detail: "What project and milestone did you use, and why was it a useful test?" },
          { title: "Before", detail: "How would you normally have handled this review?" },
          { title: "Adoption", detail: "What was easy or difficult about preparing the milestone and inviting the client?" },
          { title: "Client response", detail: "How did the reviewer react, and where did they hesitate?" },
          { title: "Outcome", detail: "How long did the decision take, how many rounds occurred, and what happened next?" },
          { title: "Value", detail: "What would have to improve for Greenlit to become part of the agency's standard workflow?" },
          { title: "Permission", detail: "Ask separately whether the agency permits private learning, an anonymous quote, a named quote, logo use, or a published story." },
        ],
      },
      {
        title: "Case study outline",
        templates: [{
          label: "Draft structure",
          content: `TITLE
How [Agency] [measurable outcome] on [type of milestone]

PROFILE
Agency size:
Services:
Typical clients:
Existing workflow:

THE BOTTLENECK
[Describe the approval or invoicing delay in the agency's words.]

THE TEST
Project:
Milestone:
Acceptance criteria:
Reviewer:
Why this was a fair test:

THE WORKFLOW
[Describe how the agency prepared proof, invited the client, handled feedback, and completed the handoff.]

THE RESULT
Time to first proof:
Time to client decision:
Review rounds:
Time to invoice:
Qualitative result:

WHAT DID NOT WORK
[Include the important friction and how Greenlit responded.]

QUOTE
“[Approved exact quote]”

PERMISSIONS
Named publication:
Logo:
Quote:
Metrics:
Approval date and approver:`,
        }],
      },
      {
        title: "Publication rules",
        bullets: [
          "Never publish beta participation, a logo, quote, metric, or client name without explicit written permission.",
          "Keep the raw interview separate from the approved public copy.",
          "State the measurement window and baseline for every numeric claim.",
          "Do not imply causation when the result may have other explanations.",
          "Include material friction and limitations rather than presenting a perfect story.",
        ],
      },
    ],
  },
  {
    slug: "demo-video-script",
    category: "Grow the beta",
    title: "Two-minute demo video script",
    summary: "A ready-to-record product story built around one failed build, one fix, and one client decision.",
    audience: "Founder or product narrator",
    readTime: "6 min",
    sections: [
      {
        title: "Recording setup",
        bullets: [
          "Use the synthetic guided demo, not client information.",
          "Record at 1440 × 900 or 1920 × 1080 with browser zoom at 100%.",
          "Turn off notifications, personal bookmarks, password-manager overlays, and unrelated tabs.",
          "Use a clean microphone and captions. Keep the final cut between 90 and 120 seconds.",
        ],
      },
      {
        title: "Shot list and narration",
        table: {
          columns: ["Time", "Screen", "Narration"],
          rows: [
            ["0:00–0:12", "Homepage and proof card", "Finished work should not sit in approval limbo. Greenlit turns the promise in a web agency's SOW into proof a client can review."],
            ["0:12–0:30", "Synthetic SOW import", "Paste the relevant scope. Greenlit drafts measurable criteria with exact source quotes, and the agency confirms every requirement before it becomes part of the review."],
            ["0:30–0:50", "Criteria and typed checks", "Supported outcomes are mapped to safe browser checks. Subjective or unsupported promises stay explicitly client-reviewed."],
            ["0:50–1:10", "Failed launch-rc1 result", "On the first build, the page claims success, but the underlying form request fails. Greenlit preserves the observed failure instead of treating the success message as proof."],
            ["1:10–1:27", "Passing launch-rc2 result", "The agency fixes the build and verifies the same frozen criteria against the corrected release."],
            ["1:27–1:45", "Client review", "One named reviewer sees the promise, result, and evidence together, then approves or requests changes by a clear deadline."],
            ["1:45–2:00", "Receipt and invoice-ready state", "The decision becomes a retained proof record and a clear handoff into invoicing. Greenlit: turn your SOW into proof."],
          ],
        },
      },
      {
        title: "On-screen closing card",
        templates: [{
          label: "Closing card",
          content: `GREENLIT
Turn your SOW into proof.

Closed beta for web agencies
greenlitproof.vercel.app`,
        }],
        callout: {
          title: "Needs a human recording",
          body: "The script and shot list are complete. A final video still needs the founder's voice, approved music choice if any, and a screen recording from the production deployment.",
        },
      },
    ],
  },
];

export const resourceCategories = [
  "Start here",
  "Run a milestone",
  "Work with clients",
  "Grow the beta",
] as const;

export function getResourceGuide(slug: string) {
  return resourceGuides.find((guide) => guide.slug === slug);
}

const internalResourceSlugs = new Set(["agency-playbook", "beta-handbook", "case-study-kit", "demo-video-script"]);

export const publicResourceGuides = resourceGuides.filter((guide) => !internalResourceSlugs.has(guide.slug));

export const publicResourceCategories = [
  "Start here",
  "Run a milestone",
  "Work with clients",
] as const;

export function getPublicResourceGuide(slug: string) {
  return publicResourceGuides.find((guide) => guide.slug === slug);
}
