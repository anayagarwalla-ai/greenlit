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
  await page.route("**/api/runs", async (route) => {
    submitted = await route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: "new-run", recordId, status: "QUEUED" }) });
  });
  await page.route("**/api/runs/new-run", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runId: "new-run", recordId, status: "COMPLETED", outcome: "READY_FOR_REVIEW", buildUrl: "http://127.0.0.1:3008/fixture/rc2", buildLabel: "launch-rc2", results: criteria.map((criterion) => ({ criterionId: criterion.id, status: "PASS", expected: "Expected", observed: "Observed", durationMs: 10, timestamp: "2026-07-20T20:01:00.000Z" })), artifacts: [], browserVersion: "test", runnerVersion: "test", manifestSha256: "b".repeat(64), completedAt: "2026-07-20T20:01:00.000Z", record: { public_id: "MP-TEST", revision: 1, confirmed_criteria: criteria } }) }));

  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByRole("heading", { name: "One automated check needs work." })).toBeVisible();
  await page.getByRole("button", { name: "Verify fixed build" }).click();
  await expect(page.getByRole("heading", { name: "Every promise has browser evidence." })).toBeVisible();
  expect(submitted).toMatchObject({ recordId, version: "rc2" });
  expect(submitted).not.toHaveProperty("targetUrl");
  expect(submitted).not.toHaveProperty("checks");
  expect(submitted).not.toHaveProperty("originReceipt");
});
