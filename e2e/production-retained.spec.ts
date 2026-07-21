import { expect, test } from "@playwright/test";

test("retained production transaction smoke gate", async ({ page }) => {
  test.skip(!process.env.E2E_RETAINED_RECORD_ID, "Set E2E_RETAINED_RECORD_ID only for an operator-authorized retained transaction run.");
  await page.goto(`/workspace?record=${encodeURIComponent(process.env.E2E_RETAINED_RECORD_ID!)}`);
  await expect(page.getByText("Retained project restored")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dashboard/ })).toBeVisible();
});
