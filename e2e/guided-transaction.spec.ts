import { expect, test } from "@playwright/test";

test("guided transaction reaches a client decision and printable receipt", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: /Launch the reliable guided demo/ }).click();
  await page.getByRole("button", { name: /show sample/i }).click();
  await expect(page.getByText(/automated check needs work/i)).toBeVisible();
  await page.getByRole("button", { name: "Verify fixed build" }).click();
  await expect(page.getByText(/every automated check passes/i)).toBeVisible();
  await page.getByRole("button", { name: "Create client review" }).click();
  await expect(page.getByText("This reliable presentation path shows Acme Outdoors’s 6-criterion decision experience without creating or implying a retained transaction.")).toBeVisible();
  await page.getByRole("link", { name: "Open as the client" }).click();
  await expect(page).toHaveURL(/\/review\/demo/);
  await expect(page.getByRole("button", { name: "Beta feedback" })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve milestone" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Your full name").fill("Sample Reviewer");
  await page.getByLabel("Business email").fill("reviewer@example.test");
  await page.getByLabel(/I intend to approve/).check();
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByLabel(/I understand this is a synthetic walkthrough/).check();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("heading", { name: "Milestone approved." })).toBeVisible();
  await page.getByRole("link", { name: /View sample record/ }).click();
  await expect(page.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  await expect(page.getByText("Sample Reviewer").first()).toBeVisible();
});

test("review decision controls remain reachable on a short mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/review/demo");
  await page.getByRole("button", { name: "Approve milestone" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("overflow-y", "auto");
  await dialog.press("Escape");
  await expect(dialog).toBeHidden();
});
