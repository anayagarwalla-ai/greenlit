import { expect, test } from "@playwright/test";

test("the public funnel is explicit about audience, synthetic data, and the next step", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/For U\.S\. web agencies · design-partner beta/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Explore the synthetic walkthrough/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Request a conversation/i }).first()).toBeVisible();
  await expect(page.getByText(/one-click/i)).toHaveCount(0);

  await page.goto("/request-demo");
  await expect(page.getByRole("heading", { name: /See whether one milestone/i })).toBeVisible();
  await expect(page.getByText(/No confidential SOW required/i)).toBeVisible();
  await expect(page.getByText(/Do not paste a SOW, credentials, client data, access codes, or regulated information/i)).toBeVisible();
});

test("a qualified agency can submit a demo request and receives a retained reference", async ({ page }) => {
  await page.route("**/api/demo-requests", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body).toMatchObject({
      name: "Alex Morgan",
      email: "alex@northstar.example",
      agencyName: "Northstar Studio",
      role: "Head of Delivery",
      agencySize: "11-25",
      location: "Denver, Colorado, United States",
      monthlyMilestoneVolume: "6-10",
      approvalDelayDays: "8",
      stagingModel: "public-https",
      desiredNextStep: "design-partner",
      consent: "true",
    });
    expect(body.currentProcess.length).toBeGreaterThanOrEqual(20);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ requestId: "DR-DEMOREADY", received: true }),
    });
  });

  await page.goto("/request-demo");
  await page.getByLabel("Your name").fill("Alex Morgan");
  await page.getByLabel("Business email").fill("alex@northstar.example");
  await page.getByLabel("Agency name").fill("Northstar Studio");
  await page.getByLabel("Your role").fill("Head of Delivery");
  await page.getByRole("button", { name: "Continue to workflow fit" }).click();
  await page.getByLabel("Agency size").selectOption("11-25");
  await page.getByLabel("Primary location").fill("Denver, Colorado, United States");
  await page.getByLabel("Client milestones per month").selectOption("6-10");
  await page.getByLabel("Typical approval delay, days").fill("8");
  await page.getByLabel("Staging model").selectOption("public-https");
  await page.getByLabel("Desired next step").selectOption("design-partner");
  await page.getByLabel("How do approvals work today?").fill("The delivery lead prepares screenshots and repeatedly follows up by email before invoicing.");
  await page.getByLabel(/I am 18\+ and acting for a business/).check();
  await page.getByRole("button", { name: "Request a conversation" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText("Request received");
  await expect(status).toContainText("DR-DEMOREADY");
  await expect(status.getByRole("link", { name: /Explore the synthetic walkthrough/i })).toBeVisible();
});

test("request-demo and trust surfaces fit a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/request-demo", "/trust", "/resources"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("robots and sitemap expose public evaluation pages without advertising private workflows", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const robotsBody = await robots.text();
  expect(robotsBody).toContain("Disallow: /admin");
  expect(robotsBody).toContain("Disallow: /dashboard");
  expect(robotsBody).toContain("Disallow: /workspace");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain("/request-demo");
  expect(sitemapBody).toContain("/trust");
  expect(sitemapBody).toContain("/resources/roi-calculator");
  expect(sitemapBody).not.toContain("/resources/case-study-kit");
  expect(sitemapBody).not.toContain("/dashboard");
});
