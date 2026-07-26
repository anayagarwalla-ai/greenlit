import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const productionSmoke = process.env.PRODUCTION_SMOKE === "1";
let baseURL = "http://127.0.0.1:3008";
let storageState: string | undefined;

if (productionSmoke) {
  const required = [
    "PRODUCTION_SMOKE_BASE_URL",
    "PRODUCTION_SMOKE_RECORD_ID",
    "PRODUCTION_SMOKE_EMAIL",
    "PRODUCTION_SMOKE_STORAGE_STATE",
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Production smoke configuration is incomplete: ${missing.join(", ")}`);
  }

  const configuredBaseUrl = new URL(process.env.PRODUCTION_SMOKE_BASE_URL!);
  if (
    configuredBaseUrl.protocol !== "https:"
    || ["localhost", "127.0.0.1", "0.0.0.0"].includes(configuredBaseUrl.hostname)
  ) {
    throw new Error("PRODUCTION_SMOKE_BASE_URL must be a non-local HTTPS origin.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.PRODUCTION_SMOKE_EMAIL!)) {
    throw new Error("PRODUCTION_SMOKE_EMAIL must be the allowlisted business email in the saved session.");
  }

  storageState = path.resolve(process.env.PRODUCTION_SMOKE_STORAGE_STATE!);
  if (!existsSync(storageState)) {
    throw new Error(`PRODUCTION_SMOKE_STORAGE_STATE does not exist: ${storageState}`);
  }
  baseURL = configuredBaseUrl.origin;
}

const crossBrowserProjects = process.env.CROSS_BROWSER === "1"
  ? [
      { name: "firefox", use: { ...devices["Desktop Firefox"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ]
  : [];

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
  use: { baseURL, storageState, trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
    ...crossBrowserProjects,
  ],
  webServer: productionSmoke ? undefined : {
    command: "pnpm --filter @greenlit/web exec next dev --port 3008",
    url: "http://127.0.0.1:3008",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
