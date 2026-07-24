import { expect, test } from "@playwright/test";
import { demoCriteria } from "../apps/web/lib/demo";

const source = "The launch page must display a visible Get started button on the home page. The button must open the /contact page when activated. The page must not create horizontal overflow at 390 pixels wide.";

async function mockSignedIn(page: import("@playwright/test").Page) {
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "test-user", email: "agency@example.test" } }) }));
}

test("real imports start blank and criteria navigation stays locked", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByLabel("Agency or vendor")).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Client", exact: true })).toHaveValue("");
  await expect(page.getByLabel("Project")).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Milestone", exact: true })).toHaveValue("");
  await expect(page.locator(".side-nav button").first()).toBeDisabled();
});

test("unsigned intake survives sign-in navigation and a new import asks before erasing it", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Paste SOW text").fill(source);
  await page.getByLabel("Agency or vendor").fill("Test Agency");
  await page.locator("#client-name").fill("Test Client");
  await page.locator("#project-name").fill("Test Project");
  await page.locator("#milestone-title").fill("Launch");
  await page.locator("#milestone-value").fill("12000.50");
  await page.getByRole("link", { name: "Agency sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste SOW text")).toHaveValue(source);
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "New import" }).click();
  await expect(page.getByLabel("Paste SOW text")).toHaveValue(source);
});

test("Gemini import validates business fields and supports criteria CRUD", async ({ page }) => {
  await mockSignedIn(page);
  await page.route("**/api/analyze", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    sourceName: "Test SOW", sourceText: source, model: "Gemini test double", analysisMode: "gemini", durationMs: 120,
    criteria: [{ title: "Get started is visible", sourceQuote: "The launch page must display a visible Get started button on the home page.", supported: true, checkType: "element_state", rationale: "Observe the control." }],
  }) }));
  await page.goto("/workspace");
  await page.getByLabel("Paste SOW text").fill(source);
  for (const box of await page.locator(".attestation input").all()) await box.check();
  await page.getByRole("button", { name: /Generate acceptance criteria/ }).click();
  await expect(page.locator(".analysis-error")).toContainText(/agency or vendor/i);
  await expect(page.getByLabel("Agency or vendor")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Agency or vendor").fill("Test Agency");
  await page.locator("#client-name").fill("Test Client");
  await page.locator("#project-name").fill("Test Project");
  await page.locator("#milestone-title").fill("Launch");
  await page.locator("#milestone-value").fill("12000.50");
  await page.getByRole("button", { name: /Generate acceptance criteria/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  await expect(page.getByLabel("AC-01 measurable outcome")).toHaveValue("Get started is visible");
  await page.getByRole("button", { name: "Duplicate AC-01" }).click();
  await expect(page.getByLabel("AC-02 measurable outcome")).toBeVisible();
  await page.getByRole("button", { name: "Move AC-02 up" }).click();
  await page.getByRole("button", { name: "Remove AC-02" }).click();
  await expect(page.getByLabel("AC-02 measurable outcome")).toHaveCount(0);
  await page.getByRole("button", { name: "Add criterion" }).click();
  await expect(page.getByLabel("AC-02 measurable outcome")).toBeVisible();
});

test("magic-link failures are explained on the login page", async ({ page }) => {
  await page.goto("/login?error=expired");
  await expect(page.locator("#agency-email-error")).toContainText("expired, invalid, or has already been used");
  await page.goto("/login?error=configuration");
  await expect(page.locator("#agency-email-error")).toContainText("not configured");
});

test("feedback distinguishes failure and success and allows another report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Beta feedback" }).click();
  await expect(page.getByRole("dialog", { name: /Tell us what got in your way/ })).toBeVisible();
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary feedback outage" }) }));
  await page.getByLabel("What happened?").fill("The expected action did not work.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.locator(".form-message--error")).toContainText("Temporary feedback outage");
  await page.unroute("**/api/feedback");
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ feedbackId: "FB-TEST" }) }));
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("heading", { name: "Feedback received." })).toBeVisible();
  await page.getByRole("button", { name: "Send another" }).click();
  await expect(page.getByLabel("What happened?")).toBeVisible();
});

test("a retained imported fixture reruns rc2 directly instead of opening custom-origin setup", async ({ page }) => {
  const recordId = "5d683117-cdeb-402a-b2b1-0d8359b4580e";
  const checkTypes = ["element_state", "link_destination", "element_state", "form_submission", "axe_scan", "viewport_layout"] as const;
  const criteria = demoCriteria.map((criterion, index) => ({
    id: criterion.id,
    title: criterion.title,
    sourceQuote: criterion.source,
    checkType: checkTypes[index],
  }));
  const failedResults = criteria.map((criterion) => ({ criterionId: criterion.id, status: criterion.id === "AC-04" ? "FAIL" : "PASS", expected: "Expected", observed: "Observed", durationMs: 10, timestamp: "2026-07-20T20:00:00.000Z" }));
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "test-user", email: "agency@example.test" } }) }));
  await page.route(`**/api/account/records/${recordId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    record: { id: recordId, public_id: "MP-TEST", mode: "IMPORTED_FIXTURE", status: "NEEDS_WORK", agency_name: "Northstar Studio", client_name: "Acme Outdoors", project_name: "Spring launch", milestone_title: "Spring launch", amount_minor: 1200050, currency: "USD", source_name: "Pasted SOW", confirmed_criteria: criteria, criteria_revision: 1 },
    runs: [{ id: "old-run", status: "COMPLETED", target_origin: "http://127.0.0.1:3008", build_url: "http://127.0.0.1:3008/fixture/rc1", build_label: "launch-rc1", checks: [], results: failedResults, artifacts: [], browser_version: "test", runner_version: "test", manifest_sha256: "a".repeat(64), completed_at: "2026-07-20T20:00:00.000Z" }],
    reviews: [],
  }) }));
  let submitted: Record<string, unknown> | null = null;
  let invoicePlan: Record<string, unknown> | null = null;
  await page.route("**/api/account/stripe", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, connection: { accountId: "acct_test", livemode: false, status: "CONNECTED" } }) }));
  await page.route("**/api/account/stripe/customers**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ customers: [{ id: "cus_test1", name: "Acme Outdoors LLC", email: "billing@acme.test" }] }) }));
  await page.route(`**/api/account/records/${recordId}/invoice-plan`, async (route) => {
    if (route.request().method() === "POST") invoicePlan = await route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().method() === "POST" ? { plan: { planSha256: "f".repeat(64) } } : { plan: null }) });
  });
  await page.route("**/api/runs", async (route) => {
    submitted = await route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: "new-run", recordId, status: "QUEUED" }) });
  });
  await page.route("**/api/runs/new-run", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runId: "new-run", recordId, status: "COMPLETED", outcome: "READY_FOR_REVIEW", buildUrl: "http://127.0.0.1:3008/fixture/rc2", buildLabel: "launch-rc2", results: criteria.map((criterion) => ({ criterionId: criterion.id, status: "PASS", expected: "Expected", observed: "Observed", durationMs: 10, timestamp: "2026-07-20T20:01:00.000Z" })), artifacts: [], browserVersion: "test", runnerVersion: "test", manifestSha256: "b".repeat(64), completedAt: "2026-07-20T20:01:00.000Z", record: { public_id: "MP-TEST", revision: 1, confirmed_criteria: criteria } }) }));

  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByRole("heading", { name: "One automated check needs work." })).toBeVisible();
  await page.getByRole("button", { name: "Verify fixed build" }).click();
  await expect(page.getByRole("heading", { name: "Every promise has browser evidence." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stripe invoice" })).toBeVisible();
  await expect(page.getByText("$12,000.50 for this exact milestone.")).toBeVisible();
  await page.getByLabel("Billing contact name").fill("Acme Outdoors LLC");
  await page.getByLabel("Billing email").fill("billing@acme.test");
  // Automatic invoicing requires a confirmed existing Stripe customer first.
  await expect(page.getByLabel(/Automatically create this invoice/)).toBeDisabled();
  await page.getByRole("button", { name: "Check for existing Stripe customer" }).click();
  await expect(page.getByText(/Matched Acme Outdoors LLC/)).toBeVisible();
  await page.getByLabel(/Automatically create this invoice/).check();
  await page.getByRole("button", { name: "Review automatic invoicing" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Enable automatic invoicing?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("billing@acme.test", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByText("acct_test (test mode)")).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Enable automatic $12,000.50 test invoice" }).click();
  await expect(page.getByText(/Client approval will automatically create a \$12,000\.50 draft invoice in the connected Stripe test account/)).toBeVisible();
  expect(invoicePlan).toMatchObject({ billingName: "Acme Outdoors LLC", billingEmail: "billing@acme.test", daysUntilDue: 14, autoSend: true, stripeCustomerId: "cus_test1" });
  expect(submitted).toMatchObject({ recordId, version: "rc2" });
  expect(submitted).not.toHaveProperty("targetUrl");
  expect(submitted).not.toHaveProperty("checks");
  expect(submitted).not.toHaveProperty("originReceipt");
});

test("an expired retained run returns to a retryable setup instead of an endless spinner", async ({ page }) => {
  const recordId = "7e793117-cdeb-402a-b2b1-0d8359b4581a";
  const criterion = { id: "AC-01", title: "Hero is visible", sourceQuote: "The launch page must display a visible hero.", checkType: "element_state" };
  await mockSignedIn(page);
  await page.route(`**/api/account/records/${recordId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    record: { id: recordId, public_id: "MP-EXPIRED", mode: "IMPORTED_FIXTURE", status: "READY", agency_name: "Test Agency", client_name: "Test Client", project_name: "Launch", milestone_title: "Launch", amount_minor: 250000, currency: "USD", source_name: "Pasted SOW", confirmed_criteria: [criterion], criteria_revision: 1 },
    runs: [{ id: "expired-run", status: "EXPIRED", target_origin: "http://127.0.0.1:3008", build_url: "http://127.0.0.1:3008/fixture/rc1", build_label: "launch-rc1", checks: [], results: [], artifacts: [], last_error: "The retained run expired before a runner completed it.", completed_at: "2026-07-22T20:00:00.000Z" }],
    reviews: [],
  }) }));

  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  await expect(page.locator(".workspace-error")).toContainText("expired before a runner completed it");
  await expect(page.getByText("Verification in progress")).toHaveCount(0);
});

test("draft metadata is account-isolated and signed-in SOW text is not durably stored", async ({ page }) => {
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-a", email: "agency-a@example.test" } }) }));
  await page.goto("/workspace");
  await page.getByLabel("Paste SOW text").fill(source);
  await page.getByLabel("Agency or vendor").fill("Agency A Confidential Co");
  await expect(page.getByLabel("Agency or vendor")).toHaveValue("Agency A Confidential Co");

  await page.unroute("**/api/account/session");
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-b", email: "agency-b@example.test" } }) }));
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste SOW text")).toHaveValue("");
  await expect(page.getByLabel("Agency or vendor")).toHaveValue("");

  await page.unroute("**/api/account/session");
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-a", email: "agency-a@example.test" } }) }));
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste SOW text")).toHaveValue("");
  await expect(page.getByLabel("Agency or vendor")).toHaveValue("Agency A Confidential Co");
});

test("resuming an approved record redirects straight to its receipt instead of a needs-work workflow phase", async ({ page }) => {
  const recordId = "6e793117-cdeb-402a-b2b1-0d8359b4580f";
  const packetId = "REVIEW-APPROVED1";
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "test-user", email: "agency@example.test" } }) }));
  await page.route(`**/api/account/records/${recordId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    record: { id: recordId, public_id: "MP-TEST", mode: "IMPORTED_FIXTURE", status: "APPROVED", agency_name: "Northstar Studio", client_name: "Acme Outdoors", project_name: "Spring launch", milestone_title: "Spring launch", amount_minor: 1200050, currency: "USD", source_name: "Pasted SOW", confirmed_criteria: [], criteria_revision: 1 },
    runs: [],
    reviews: [{ public_id: packetId, decision: "APPROVED" }],
  }) }));
  await page.route(`**/api/reviews/${packetId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    packetId, decision: "APPROVED", reviewerName: "Test Reviewer", reviewerEmail: "reviewer@example.test", decidedAt: "2026-07-20T20:00:00.000Z", receiptSha256: "c".repeat(64),
    snapshot: { recordPublicId: "MP-TEST", agencyName: "Northstar Studio", clientName: "Acme Outdoors", projectName: "Spring launch", milestoneTitle: "Spring launch", amountMinor: 1200050, currency: "USD", revision: 1, criteria: [], run: { runId: "run-1", buildLabel: "launch-rc2", buildUrl: "http://127.0.0.1:3008/fixture/rc2", results: [], manifestSha256: "d".repeat(64), browserVersion: "test", runnerVersion: "test", completedAt: "2026-07-20T20:00:00.000Z" } },
    snapshotSha256: "e".repeat(64),
  }) }));

  await page.goto(`/workspace?record=${recordId}`);
  await page.waitForURL(new RegExp(`/receipt/${packetId}`));
  await expect(page.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
});
