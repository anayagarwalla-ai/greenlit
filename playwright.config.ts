import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The guided transaction intentionally exercises shared development fixtures.
  // Serial workers keep those browser sessions from competing for dev-server
  // compilation and make the release gate deterministic on small CI runners.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/playwright-report" }]],
  use: { baseURL: "http://127.0.0.1:3008", trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "pnpm --filter @milestoneproof/web exec next dev --port 3008",
    url: "http://127.0.0.1:3008",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
