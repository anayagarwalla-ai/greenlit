import { expect, test } from "@playwright/test";

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
