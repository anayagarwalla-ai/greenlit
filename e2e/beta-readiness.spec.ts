import { expect, test, type Page } from "@playwright/test";

const iso = "2026-07-20T20:00:00.000Z";
const futureIso = new Date(Date.now() + 48 * 3_600_000).toISOString();

function reviewSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    packetPublicId: "REVIEW-BETA1",
    recordPublicId: "MP-BETA",
    agencyName: "Northstar Studio",
    clientName: "Acme Outdoors",
    projectName: "Spring launch",
    milestoneTitle: "Spring launch",
    amountMinor: 1200050,
    currency: "USD",
    sourceName: "Acme × Northstar — SOW.pdf",
    sourceSha256: "a".repeat(64),
    revision: 1,
    criteria: [{ id: "AC-01", title: "Hero visible", sourceQuote: "The hero must be visible." }],
    run: { runId: "run-1", buildLabel: "launch-rc2", buildUrl: "https://staging.acme.test", results: [{ criterionId: "AC-01", status: "PASS", expected: "Visible", observed: "Visible", durationMs: 12, timestamp: iso }], artifacts: [], manifestSha256: "b".repeat(64), completedAt: iso, browserVersion: "test", runnerVersion: "test" },
    invoicePlan: { enabled: true, billingName: "Acme Outdoors LLC", billingEmail: "billing@acme.test", daysUntilDue: 14, memo: "", autoSend: true, amountMinor: 1200050, currency: "USD", planSha256: "c".repeat(64) },
    expiresAt: futureIso,
    ...overrides,
  };
}

function receiptPacket(overrides: Record<string, unknown> = {}) {
  return {
    packetId: "REVIEW-BETA1",
    snapshot: {
      recordPublicId: "MP-BETA", agencyName: "Northstar Studio", clientName: "Acme Outdoors", projectName: "Spring launch", milestoneTitle: "Spring launch", amountMinor: 1200050, currency: "USD", sourceName: "Acme × Northstar — SOW.pdf", sourceSha256: "a".repeat(64), revision: 1,
      criteria: [{ id: "AC-01", title: "Hero visible" }],
      run: { runId: "run-1", buildLabel: "launch-rc2", buildUrl: "https://staging.acme.test", results: [{ criterionId: "AC-01", status: "PASS", expected: "Visible", observed: "Visible" }], manifestSha256: "b".repeat(64), browserVersion: "test", runnerVersion: "test", completedAt: iso },
    },
    snapshotSha256: "d".repeat(64),
    decision: "APPROVED",
    reviewerName: "Casey Reviewer",
    reviewerEmail: "reviewer@example.test",
    decidedAt: iso,
    receiptSha256: "e".repeat(64),
    auditHead: null,
    ...overrides,
  };
}

test("the landing-page CTA starts the guided demo directly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Try the guided demo/ }).click();
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  await expect(page.locator(".demo-badge")).toHaveText(/Guided demo/i);
});

test("a blocked local store shows an honest save-failed state with a working retry", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { __blockSaves?: boolean }).__blockSaves = true;
    Storage.prototype.setItem = function (key: string, value: string) {
      if ((window as unknown as { __blockSaves?: boolean }).__blockSaves && String(key).startsWith("greenlit-")) throw new DOMException("Blocked", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/workspace");
  await expect(page.getByText("This browser is not saving drafts.")).toBeVisible();
  await page.getByLabel("Paste SOW text").fill("The launch page must display a visible Get started button on the home page for every visitor session.");
  await expect(page.getByText("Save failed")).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __blockSaves?: boolean }).__blockSaves = false; });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("This browser is not saving drafts.")).toBeHidden();
});

test("an anonymous draft older than 24 hours is purged on the next visit", async ({ page }) => {
  await page.goto("/workspace");
  const draftKeys = () => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("greenlit-draft-v4:anon:")));
  await page.getByLabel("Paste SOW text").fill("The launch page must display a visible Get started button on the home page for every visitor session.");
  await expect.poll(draftKeys).toHaveLength(1);
  // Backdate the saved-at stamp beyond the 24-hour retention window.
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("greenlit-draft-saved-v4:anon:")) window.localStorage.setItem(key, String(Date.now() - 25 * 60 * 60_000));
    }
  });
  await page.goto("/workspace");
  await expect(page.getByLabel("Paste SOW text")).toHaveValue("");
  expect(await draftKeys()).toHaveLength(0);
});

test("reviewers never see the owner workspace link on a receipt, owners do", async ({ page }) => {
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(receiptPacket({ viewerRole: "REVIEWER" })) }));
  await page.goto("/receipt/REVIEW-BETA1");
  await expect(page.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Workspace" })).toHaveCount(0);

  await page.unroute("**/api/reviews/REVIEW-BETA1");
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(receiptPacket({ viewerRole: "OWNER" })) }));
  await page.goto("/receipt/REVIEW-BETA1");
  await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();
});

test("receipt shows the correction history and truthful draft-invoice wording", async ({ page }) => {
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(receiptPacket({
    viewerRole: "OWNER",
    corrections: [{ field_name: "client_name", corrected_value: "Acme Outdoors, Inc.", reason: "Legal name correction", created_at: iso }],
    invoice: { status: "draft", invoice_number: "INV-0001", amount_due_minor: 1200050, amount_paid_minor: 0, currency: "USD", billing_email: "billing@acme.test", hosted_invoice_url: "https://invoice.stripe.test/i/test", due_at: futureIso },
  })) }));
  await page.goto("/receipt/REVIEW-BETA1");
  await expect(page.getByText("Amendment & correction history")).toBeVisible();
  await expect(page.getByText(/corrected to “Acme Outdoors, Inc\.” — Legal name correction/)).toBeVisible();
  await expect(page.getByText(/draft created for billing@acme\.test — not emailed/)).toBeVisible();
  await expect(page.getByText(/sent to billing@acme\.test/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open hosted invoice/ })).toBeVisible();
});

test("client review explains a test-draft invoice truthfully", async ({ page }) => {
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packetId: "REVIEW-BETA1", snapshot: reviewSnapshot({ invoiceDeliveryMode: "TEST_DRAFT" }), snapshotSha256: "d".repeat(64), expiresAt: futureIso, decision: null }) }));
  await page.goto("/review/REVIEW-BETA1");
  await expect(page.getByText("Approval creates a test draft invoice — no email")).toBeVisible();
  await expect(page.getByText(/test mode: approving creates a \$12,000\.50 draft invoice/)).toBeVisible();
  await page.getByRole("button", { name: "Approve milestone" }).click();
  await expect(page.getByRole("dialog")).toContainText("as a Stripe test draft — no email is sent");
});

test("client review explains live-email and manual invoicing truthfully", async ({ page }) => {
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packetId: "REVIEW-BETA1", snapshot: reviewSnapshot({ invoiceDeliveryMode: "LIVE_EMAIL" }), snapshotSha256: "d".repeat(64), expiresAt: futureIso, decision: null }) }));
  await page.goto("/review/REVIEW-BETA1");
  await expect(page.getByText("Approval sends the invoice", { exact: true })).toBeVisible();
  await expect(page.getByText(/email a \$12,000\.50 Stripe invoice to billing@acme\.test/)).toBeVisible();

  await page.unroute("**/api/reviews/REVIEW-BETA1");
  await page.route("**/api/reviews/REVIEW-BETA1", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packetId: "REVIEW-BETA1", snapshot: reviewSnapshot({ invoiceDeliveryMode: "MANUAL_AFTER_APPROVAL", invoicePlan: { enabled: true, billingName: "Acme Outdoors LLC", billingEmail: "billing@acme.test", daysUntilDue: 14, memo: "", autoSend: false, amountMinor: 1200050, currency: "USD", planSha256: "c".repeat(64) } }), snapshotSha256: "d".repeat(64), expiresAt: futureIso, decision: null }) }));
  await page.goto("/review/REVIEW-BETA1");
  await expect(page.getByText("The agency may invoice after approval")).toBeVisible();
  await expect(page.getByText(/nothing is sent automatically/)).toBeVisible();
});

function readyRecordPayload(recordId: string, amountMinor: number) {
  const criteria = [{ id: "AC-01", title: "Hero visible", sourceQuote: "The hero must be visible.", checkType: "element_state" }];
  const results = [{ criterionId: "AC-01", status: "PASS", expected: "Visible", observed: "Visible", durationMs: 10, timestamp: iso }];
  return {
    record: { id: recordId, public_id: "MP-READY", mode: "IMPORTED_FIXTURE", status: "READY_FOR_REVIEW", agency_name: "Northstar Studio", client_name: "Acme Outdoors", project_name: "Spring launch", milestone_title: "Spring launch", amount_minor: amountMinor, currency: "USD", source_name: "Pasted SOW", confirmed_criteria: criteria, criteria_revision: 1 },
    runs: [{ id: "run-done", status: "COMPLETED", target_origin: "https://staging.acme.test", build_url: "https://staging.acme.test", build_label: "launch-rc2", checks: [], results, artifacts: [], browser_version: "test", runner_version: "test", manifest_sha256: "a".repeat(64), completed_at: iso, created_at: iso }],
    reviews: [],
  };
}

async function mockReadyWorkspace(page: Page, recordId: string, amountMinor: number) {
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-1", email: "agency@example.test" } }) }));
  await page.route(`**/api/account/records/${recordId}`, (route) => route.request().method() === "GET"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(readyRecordPayload(recordId, amountMinor)) })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: true }) }));
  await page.route("**/api/account/stripe", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, connection: { accountId: "acct_test", livemode: false, status: "CONNECTED" } }) }));
  await page.route("**/api/account/stripe/customers**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ customers: [{ id: "cus_test1", name: "Acme Outdoors LLC", email: "billing@acme.test" }] }) }));
  await page.route(`**/api/account/records/${recordId}/invoice-plan`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().method() === "POST" ? { plan: { planSha256: "f".repeat(64) } } : { plan: null }) }));
}

test("a $0 milestone shows a no-charge state and hides invoice actions", async ({ page }) => {
  const recordId = "5d683117-cdeb-402a-b2b1-0d8359b458cc";
  await mockReadyWorkspace(page, recordId, 0);
  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByRole("heading", { name: "Stripe invoice" })).toBeVisible();
  await expect(page.getByText("No charge", { exact: true })).toBeVisible();
  await expect(page.getByText(/there is no invoice to create or send/)).toBeVisible();
  await expect(page.getByRole("button", { name: /invoice/i })).toHaveCount(0);
  await expect(page.getByLabel("Billing email")).toHaveCount(0);
});

test("the final invoice confirmation modal shows the facts, an explicit CTA, and full keyboard support", async ({ page }) => {
  const recordId = "5d683117-cdeb-402a-b2b1-0d8359b458dd";
  await mockReadyWorkspace(page, recordId, 1200050);
  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByRole("heading", { name: "Stripe invoice" })).toBeVisible();
  await page.getByLabel("Billing contact name").fill("Acme Outdoors LLC");
  await page.getByLabel("Billing email").fill("billing@acme.test");
  await page.getByRole("button", { name: "Check for existing Stripe customer" }).click();
  await expect(page.getByText(/Matched Acme Outdoors LLC/)).toBeVisible();
  await page.getByLabel(/Automatically create this invoice/).check();
  await page.getByRole("button", { name: "Review automatic invoicing" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Enable automatic invoicing?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("Automatic · test draft — no email")).toBeVisible();
  await expect(confirmDialog.getByText("acct_test (test mode)")).toBeVisible();
  await expect(confirmDialog.getByText("Acme Outdoors", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByText("Acme Outdoors LLC", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByText("billing@acme.test", { exact: true })).toBeVisible();
  await expect(confirmDialog.getByText("$12,000.50 USD")).toBeVisible();
  await expect(confirmDialog.getByText(/14 days after creation/)).toBeVisible();
  await expect(confirmDialog.getByText("Spring launch — Spring launch")).toBeVisible();
  // No vague "Confirm" button — the final CTA names the exact action and amount.
  await expect(confirmDialog.getByRole("button", { name: "Enable automatic $12,000.50 test invoice" })).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  // Initial focus lands on the dialog heading.
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).toContain("invoice-confirm-title");
  // Tab stays trapped inside the dialog.
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".invoice-confirm-dialog")))).toBe(true);
  }
  // Escape closes the dialog and restores focus to the opener.
  await page.keyboard.press("Escape");
  await expect(confirmDialog).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).toContain("Review automatic invoicing");
});

test("workspace and stepper fit a 390px viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace?demo=guided");
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  for (const label of ["Confirm criteria", "Verify build", "Client review", "Invoice-ready"]) {
    await expect(page.locator(".step", { hasText: label })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("landing and workspace fit a 320px viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto("/workspace?demo=guided");
  await expect(page.getByRole("heading", { name: "Confirm what “done” means" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("a verification polling outage explains the retained job and offers a dashboard return", async ({ page }) => {
  const recordId = "5d683117-cdeb-402a-b2b1-0d8359b458bb";
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "user-1", email: "agency@example.test" } }) }));
  await page.route(`**/api/account/records/${recordId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    record: { id: recordId, public_id: "MP-RUNNING", mode: "IMPORTED_FIXTURE", status: "VERIFYING", agency_name: "Northstar Studio", client_name: "Acme Outdoors", project_name: "Spring launch", milestone_title: "Spring launch", amount_minor: 1200050, currency: "USD", source_name: "Pasted SOW", confirmed_criteria: [{ id: "AC-01", title: "Hero visible", sourceQuote: "The hero must be visible." }], criteria_revision: 1 },
    runs: [{ id: "run-live", status: "RUNNING", target_origin: "https://staging.acme.test", build_url: "https://staging.acme.test", build_label: "launch-rc1", checks: [], results: [], artifacts: [], created_at: iso }],
    reviews: [],
  }) }));
  await page.route("**/api/runs/run-live", (route) => route.abort("failed"));
  await page.goto(`/workspace?record=${recordId}`);
  await expect(page.getByText(/The retained job is still active on the server/)).toBeVisible();
  const returnLink = page.getByRole("link", { name: "Return to dashboard" });
  await expect(returnLink).toBeVisible();
  await expect(returnLink).toHaveAttribute("href", "/dashboard");
});
