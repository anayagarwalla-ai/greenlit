import { expect, test } from "@playwright/test";

test("guided transaction reaches a client decision and printable receipt", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await page.goto("/workspace");
  await page.getByRole("button", { name: /Open the guided demo/ }).click();
  await page.getByRole("button", { name: /verify sample/i }).click();
  await expect(page.getByText(/automated check needs work/i)).toBeVisible();
  await expect(page.getByAltText("Synthetic fixture frame for AC-04")).toBeVisible();
  await page.getByRole("button", { name: "Verify fixed build" }).click();
  await expect(page.getByText(/every automated check passes/i)).toBeVisible();
  await expect(page.getByAltText("Synthetic fixture frame for AC-01")).toBeVisible();
  await page.getByRole("button", { name: "Create client review" }).click();
  await expect(page.getByText("This reliable presentation path shows Acme Outdoors’s 6-criterion decision experience without creating or implying a retained transaction.")).toBeVisible();
  const clientPagePromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open client review in new tab" }).click();
  const clientPage = await clientPagePromise;
  await expect(clientPage).toHaveURL(/\/review\/demo/);
  await expect(clientPage.getByRole("button", { name: "Beta feedback" })).toHaveCount(0);
  await clientPage.getByText(/Inspect evidence for AC-04/).click();
  await expect(clientPage.getByAltText(/Captured evidence for AC-04/)).toBeVisible();
  const evidenceDownload = clientPage.waitForEvent("download");
  await clientPage.getByRole("link", { name: "Download evidence" }).click();
  await expect((await evidenceDownload).suggestedFilename()).toMatch(/^AC-04-evidence/);
  await clientPage.getByRole("button", { name: "Approve milestone" }).click();
  await expect(clientPage.getByRole("dialog")).toBeVisible();
  await clientPage.getByLabel("Your full name").fill("Sample Reviewer");
  await clientPage.getByLabel("Reviewer email").fill("reviewer@example.test");
  await clientPage.getByLabel(/I intend to approve/).check();
  await clientPage.getByLabel(/I accept the Terms/).check();
  await clientPage.getByLabel(/I understand this is a synthetic walkthrough/).check();
  await clientPage.getByRole("button", { name: "Confirm approval" }).click();
  await expect(clientPage.getByRole("heading", { name: "Milestone approved." })).toBeVisible();
  await clientPage.getByRole("link", { name: /View sample record/ }).click();
  await expect(clientPage.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
  await expect(clientPage.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  await expect(clientPage.getByText("Sample Reviewer").first()).toBeVisible();
  expect(runtimeErrors.filter((message) => /hydration|Minified React error #418/i.test(message))).toEqual([]);
});

test("a blocked clipboard exposes the complete review URL for manual copying", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("clipboard blocked"); } },
    });
  });
  await page.goto("/workspace?demo=guided");
  await page.getByRole("button", { name: /verify sample/i }).click();
  await page.getByRole("button", { name: "Verify fixed build" }).click();
  await page.getByRole("button", { name: "Create client review" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByLabel("Review URL")).toHaveValue(/\/review\/demo$/);
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
