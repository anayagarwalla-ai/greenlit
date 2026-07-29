import { expect, test } from "@playwright/test";

test("resource center exposes the public workflow library", async ({ page }) => {
  await page.goto("/resources");

  await expect(page.getByRole("heading", { name: /Get the milestone/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Agency quick-start/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Writing measurable acceptance criteria/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Approval-delay calculator/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Product build log/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Start the walkthrough/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Agency sales and client-introduction playbook/i })).toHaveCount(0);
});

test("quick-start guide and generated download use the same source", async ({ page, request }) => {
  await page.goto("/resources/agency-quickstart");

  await expect(page.getByRole("heading", { name: "Agency quick-start" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore the complete proof flow" })).toBeVisible();
  await expect(page.getByText("Updated July 28, 2026")).toBeVisible();
  await expect(page.getByText(/invited agency email/i)).toHaveCount(0);

  const response = await request.get("/resources/downloads/greenlit-agency-quickstart.md");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(await response.text()).toContain("# Agency quick-start");
});

test("account sign-in troubleshooting stays off the public resource surface", async ({ page }) => {
  await page.goto("/resources/troubleshooting");
  await expect(page.getByRole("heading", { name: "Troubleshooting guide" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-in or invitation problem" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SOW analysis problem" })).toBeVisible();
});

test("approval-delay calculator updates locally", async ({ page }) => {
  await page.goto("/resources/roi-calculator");

  await page.getByLabel("Milestones completed per month").fill("10");
  await page.getByLabel("Team hours spent preparing and chasing each approval").fill("4");
  await page.getByLabel("Conservative improvement percentage").fill("50");

  await expect(page.getByText("20.0 hours")).toBeVisible();
  await expect(page.getByText("$2,500")).toBeVisible();

  await page.getByLabel("Milestones completed per month").fill("-1");
  await expect(page.locator("#roi-input-error")).toContainText("Estimate unavailable");
  await expect(page.getByLabel("Milestones completed per month")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("20.0 hours")).toHaveCount(0);
  await expect(page.locator(".roi-result strong")).toHaveText(["Pending", "Pending", "Pending"]);

  await page.getByLabel("Milestones completed per month").fill("1001");
  await expect(page.locator("#roi-input-error")).toBeVisible();

  await page.getByLabel("Milestones completed per month").fill("10");
  await expect(page.locator("#roi-input-error")).toHaveCount(0);
  await expect(page.getByText("20.0 hours")).toBeVisible();
});

test("founder-only collateral is not published in the public resource library", async ({ page, request }) => {
  for (const slug of ["agency-playbook", "case-study-kit", "demo-video-script"]) {
    const response = await request.get(`/resources/${slug}`);
    expect(response.status(), slug).toBe(404);
  }
  const privateDownload = await request.get("/resources/downloads/greenlit-agency-playbook.md");
  expect(privateDownload.status()).toBe(404);

  await page.goto("/resources");
  await expect(page.getByText("Grow the beta", { exact: true })).toHaveCount(0);
});

test("what-runs-live page names prototype boundaries and stays within mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trust");

  await expect(page.getByRole("heading", { name: /Clear demo/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is real today." })).toBeVisible();
  await expect(page.getByText("Live now", { exact: true })).toBeVisible();
  await expect(page.getByText("Configured path", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned or not promised", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /What you can run now/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What Greenlit does not claim" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("public evaluation pages publish self-canonical metadata and a social image", async ({ page }) => {
  for (const path of [
    "/request-demo",
    "/resources",
    "/resources/agency-quickstart",
    "/resources/roi-calculator",
    "/resources/changelog",
    "/trust",
    "/privacy",
    "/terms",
    "/records",
    "/privacy-request",
    "/contact",
  ]) {
    await page.goto(path);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const openGraphUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
    expect(new URL(canonical!).pathname, `${path} canonical`).toBe(path);
    expect(new URL(openGraphUrl!).pathname, `${path} Open Graph URL`).toBe(path);
    await expect(page.locator('meta[property="og:image"]'), `${path} social image`).toHaveCount(1);
  }
});

test("sample review and receipt publish unique noindex metadata", async ({ page }) => {
  for (const expected of [
    { path: "/review/demo", title: "Sample client milestone review" },
    { path: "/receipt/demo", title: "Sample milestone approval record" },
  ]) {
    await page.goto(expected.path);
    await expect(page).toHaveTitle(new RegExp(expected.title));
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).pathname).toBe(expected.path);
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
    expect(robots).toContain("nofollow");
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  }
});
