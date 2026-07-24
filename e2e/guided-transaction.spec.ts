import { expect, test } from "@playwright/test";

test("guided transaction reaches a client decision and printable receipt", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await page.goto("/workspace");
  await page.getByRole("button", { name: /Launch the reliable guided demo/ }).click();
  await page.getByRole("button", { name: /verify sample/i }).click();
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
  await page.getByLabel("Reviewer email").fill("reviewer@example.test");
  await page.getByLabel(/I intend to approve/).check();
  await page.getByLabel(/I accept the Terms/).check();
  await page.getByLabel(/I understand this is a synthetic walkthrough/).check();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("heading", { name: "Milestone approved." })).toBeVisible();
  await page.getByRole("link", { name: /View sample record/ }).click();
  await expect(page.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  await expect(page.getByText("Sample Reviewer").first()).toBeVisible();
  expect(runtimeErrors.filter((message) => /hydration|Minified React error #418/i.test(message))).toEqual([]);
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

test("a client labels new scope separately from a correction to the frozen milestone", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Request changes" });
  await expect(dialog.getByText("Correction to agreed scope")).toBeVisible();
  await expect(dialog.getByText("New request outside this milestone")).toBeVisible();
  await dialog.getByLabel(/New request outside this milestone/).check();
  await expect(dialog.getByLabel("Acceptance criterion needing correction")).toHaveCount(0);
  await expect(dialog.getByLabel("Note")).toHaveAttribute("placeholder", /additional work/i);
  await dialog.getByLabel("Your full name").fill("Sample Reviewer");
  await dialog.getByLabel("Reviewer email").fill("reviewer@example.test");
  await dialog.getByLabel("Note").fill("Please add a customer portal to this launch.");
  await dialog.getByLabel(/I intend to request these changes/).check();
  await dialog.getByLabel(/I accept the Terms/).check();
  await dialog.getByLabel(/I understand this is a synthetic walkthrough/).check();
  await dialog.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("heading", { name: "Changes requested." })).toBeVisible();
});
