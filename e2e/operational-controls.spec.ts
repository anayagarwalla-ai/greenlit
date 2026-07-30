import { expect, test } from "@playwright/test";

test("the public login route cannot expose account controls while beta sign-in is disabled", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/workspace(?:\?demo=guided)?$/);
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  await expect(page.getByLabel("Business email")).toHaveCount(0);
});

test("an expired Stripe OAuth session cannot reopen hidden public sign-in", async ({ page }) => {
  await page.goto("/dashboard?stripe=session-expired");
  await expect(page).toHaveURL(/\/workspace(?:\?demo=guided)?$/);
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  await expect(page.locator("#agency-email-error")).toHaveCount(0);
});

test("privacy request controls preserve input on failure and reset after success", async ({ page }) => {
  await page.route("**/api/privacy-requests", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Privacy service is temporarily unavailable." }),
  }));
  await page.goto("/privacy-request");
  await page.getByLabel("Request type").selectOption("EXPORT");
  await page.getByLabel("Business email").fill("requester@example.test");
  await page.getByLabel("Details").fill("Export the records associated with my account.");
  await page.getByRole("button", { name: "Submit privacy request" }).click();
  await expect(page.locator(".legal-form [role='alert']")).toContainText("temporarily unavailable");
  await expect(page.getByLabel("Business email")).toHaveValue("requester@example.test");

  await page.unroute("**/api/privacy-requests");
  await page.route("**/api/privacy-requests", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ requestId: "PRIV-CONTROL1", identityVerified: false }),
  }));
  await page.getByRole("button", { name: "Submit privacy request" }).click();
  await expect(page.locator(".legal-form [role='status']")).toContainText("PRIV-CONTROL1");
  await expect(page.getByLabel("Business email")).toHaveValue("");
});

test("the public security contact opens an actionable tracked report form", async ({ page }) => {
  let submittedBody: Record<string, unknown> | undefined;
  await page.route("**/api/privacy-requests", async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "PRIV-SECURITY1", identityVerified: false }),
    });
  });

  await page.goto("/contact");
  await page.getByRole("link", { name: "security report form" }).click();
  await expect(page).toHaveURL(/\/privacy-request\?type=security$/);
  await expect(page.getByRole("heading", { name: "Report a security concern" })).toBeVisible();
  await expect(page.getByLabel("Request type")).toHaveValue("OTHER");
  await page.getByLabel("Business email").fill("reporter@example.test");
  await page.getByLabel("Details").fill("The review link can be reused after the session ends.");
  await page.getByRole("button", { name: "Submit security report" }).click();

  await expect(page.locator(".legal-form [role='status']")).toContainText("PRIV-SECURITY1");
  expect(submittedBody).toMatchObject({
    requestType: "OTHER",
    email: "reporter@example.test",
    details: "Security concern:\nThe review link can be reused after the session ends.",
  });
});

test("the fixed staging fixture never claims a failed form submission succeeded", async ({ page }) => {
  await page.goto("/fixture/rc2");
  await page.getByRole("link", { name: "Plan my trip" }).click();
  await expect(page).toHaveURL(/\/fixture\/contact$/);

  await page.goto("/fixture/rc2#contact");
  await page.getByRole("button", { name: "Send my request" }).click();
  await expect(page.locator("#name-error")).toBeVisible();
  await expect(page.locator("#email-error")).toBeVisible();
  await page.getByLabel("Name").fill("Greenlit QA");
  await page.getByRole("button", { name: "Send my request" }).click();
  await expect(page.locator("#name-error")).toHaveCount(0);
  await expect(page.locator("#email-error")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.getByLabel("Email").fill("qa@example.test");
  await page.route("**/api/fixture/leads?version=rc2", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Temporary outage" }),
  }));
  await page.getByRole("button", { name: "Send my request" }).click();
  await expect(page.locator(".fixture-contact [role='alert']")).toContainText("could not send");
  await expect(page.getByText("We have your request.")).toHaveCount(0);

  await page.unroute("**/api/fixture/leads?version=rc2");
  await page.route("**/api/fixture/leads?version=rc2", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ created: true }),
  }));
  await page.getByRole("button", { name: "Send my request" }).click();
  await expect(page.getByRole("status")).toContainText("We have your request.");
});

test("a client cannot dismiss a decision dialog while the decision is recording", async ({ page }) => {
  const now = new Date().toISOString();
  const packet = {
    packetId: "REVIEW-CONTROLS",
    snapshotSha256: "d".repeat(64),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    intendedReviewerEmail: "reviewer@example.test",
    decision: null,
    snapshot: {
      packetPublicId: "REVIEW-CONTROLS",
      recordPublicId: "MP-CONTROLS",
      agencyName: "Northstar Studio",
      clientName: "Acme Outdoors",
      projectName: "Spring launch",
      milestoneTitle: "Homepage launch",
      amountMinor: 1200000,
      currency: "USD",
      sourceName: "SOW",
      sourceSha256: "a".repeat(64),
      revision: 1,
      criteria: [{ id: "AC-01", title: "Hero is visible", sourceQuote: "The hero must be visible." }],
      run: {
        runId: "run-controls",
        buildLabel: "launch-rc2",
        results: [{ criterionId: "AC-01", status: "PASS", expected: "Visible", observed: "Visible", durationMs: 10, timestamp: now }],
        artifacts: [],
        manifestSha256: "b".repeat(64),
        completedAt: now,
        browserVersion: "test",
        runnerVersion: "test",
      },
    },
  };
  await page.route("**/api/reviews/REVIEW-CONTROLS", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(packet),
  }));
  await page.route("**/api/reviews/REVIEW-CONTROLS/decision", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ decision: "APPROVED", decidedAt: now, receiptSha256: "c".repeat(64) }),
    });
  });
  await page.goto("/review/REVIEW-CONTROLS");
  await page.getByRole("button", { name: "Approve milestone" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your full name").fill("Casey Reviewer");
  await dialog.getByLabel(/I intend to approve/).check();
  await dialog.getByLabel(/I accept the Terms/).check();
  await dialog.getByLabel(/I consent to receive and retain/).check();
  await dialog.getByRole("button", { name: "Confirm approval" }).click();
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await dialog.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Milestone approved." })).toBeVisible();
});

test("the approval record print control invokes the browser print action", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => { (window as typeof window & { __printInvoked?: boolean }).__printInvoked = true; };
  });
  await page.goto("/receipt/demo");
  await expect(page).toHaveTitle("Sample milestone approval record · Greenlit");
  await page.getByRole("button", { name: "Print / Save as PDF" }).click();
  await expect(page.getByRole("status")).toContainText("Print dialog opened");
  expect(await page.evaluate(() => Boolean((window as typeof window & { __printInvoked?: boolean }).__printInvoked))).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".skip-link")).toBeHidden();
  await expect(page.locator(".demo-conversion")).toBeHidden();
  await expect(page.locator(".receipt-page")).toBeVisible();
});

test("resource copy, download, navigation, and calculator controls are operational", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { (window as typeof window & { __copiedResource?: string }).__copiedResource = value; } },
    });
  });
  await page.goto("/resources/agency-quickstart");
  const copyButton = page.getByRole("button", { name: /Copy/ });
  await expect(copyButton).toHaveCount(0);
  await page.goto("/resources/approval-email-templates");
  const templateCopy = page.getByRole("button", { name: "Copy Subject: [Milestone] is ready for your review" });
  await templateCopy.click();
  await expect(templateCopy).toContainText("Copied");
  expect(await page.evaluate(() => (window as typeof window & { __copiedResource?: string }).__copiedResource)).toContain("The [milestone name] milestone is ready for review.");

  const downloadLink = page.getByRole("link", { name: "Download a text copy" });
  await expect(downloadLink).toHaveAttribute("download", "");
  const download = await request.get("/resources/downloads/greenlit-approval-email-templates.txt");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("text/plain");
  expect(await download.text()).toContain("# Approval email template pack");

  await page.goto("/resources/roi-calculator");
  await page.getByLabel("Milestones completed per month").fill("10");
  await page.getByLabel("Team hours spent preparing and chasing each approval").fill("4");
  await page.getByLabel("Conservative improvement percentage").fill("50");
  await expect(page.getByText("20.0 hours")).toBeVisible();
  await page.getByRole("button", { name: "Reset assumptions" }).click();
  await expect(page.getByLabel("Milestones completed per month")).toHaveValue("8");
  await expect(page.getByText("7.0 hours")).toBeVisible();

  await page.goto("/trust");
  const reportingLink = page.getByRole("link", { name: "Reporting concerns" });
  await expect(reportingLink).toBeVisible();
  await reportingLink.click();
  await expect(page).toHaveURL(/\/trust#reporting$/);
});
