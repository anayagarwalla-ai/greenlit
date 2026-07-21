import { launch, type BrowserWorker } from "@cloudflare/playwright";
import { checkSpecSchema, type CheckSpec, type CriterionResult } from "@milestoneproof/contracts";
import { z } from "zod";
import axe from "axe-core";

type Env = {
  BROWSER: BrowserWorker;
  JOB_QUEUE: Queue<JobMessage>;
  WEB_APP_URL: string;
  RUNNER_HMAC_SECRET: string;
};

type JobMessage = { jobId: string; attempt: number };

type EvidenceArtifact = {
  criterionId: string;
  kind: "SCREENSHOT";
  mimeType: "image/png";
  base64: string;
  sha256: string;
};

type StoredEvidenceArtifact = Omit<EvidenceArtifact, "base64"> & { byteSize: number; storagePath: string; expiresAt: string };

const jobSchema = z.object({ jobId: z.string().min(4).max(200) });
const leaseSchema = z.object({
  jobId: z.string(),
  targetOrigin: z.string().url(),
  checks: z.array(checkSpecSchema).min(1).max(40),
  buildLabel: z.string(),
});

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return hex(await crypto.subtle.digest("SHA-256", copy.buffer));
}

async function signature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

async function launchWithBackoff(binding: BrowserWorker) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await launch(binding);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/429|rate limit/i.test(message) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (2 ** attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Browser capacity is unavailable.");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function authenticatedFetch(env: Env, path: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  return fetch(`${env.WEB_APP_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-mp-timestamp": timestamp, "x-mp-signature": await signature(env.RUNNER_HMAC_SECRET, timestamp, body) }, body });
}

async function resolveLocator(page: import("@cloudflare/playwright").Page, elementRef: string) {
  const separator = elementRef.indexOf(":");
  if (separator < 1) throw new Error("Element reference must be role:accessible name.");
  const role = elementRef.slice(0, separator) as Parameters<typeof page.getByRole>[0];
  const name = elementRef.slice(separator + 1);
  return page.getByRole(role, { name, exact: true });
}

function assertVerifiedPage(page: import("@cloudflare/playwright").Page, origin: string) {
  const current = new URL(page.url());
  if (current.origin !== origin) throw new Error(`Navigation left the verified origin (${current.origin}).`);
}

async function settlePage(page: import("@cloudflare/playwright").Page, origin: string) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8_000 });
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForFunction(() => document.readyState === "complete" && Boolean(document.body), undefined, { timeout: 5_000 }).catch(() => undefined);
  assertVerifiedPage(page, origin);
}

async function executeCheck(page: import("@cloudflare/playwright").Page, origin: string, check: CheckSpec): Promise<CriterionResult> {
  const started = Date.now();
  const result = (status: CriterionResult["status"], expected: string, observed: string): CriterionResult => ({ criterionId: check.criterionId, status, expected, observed, durationMs: Date.now() - started, timestamp: new Date().toISOString() });
  try {
    // Install Axe before navigation so Chromium evaluates it in the page's main
    // world without depending on the target site's CSP or a late script tag.
    if (check.type === "axe_scan") await page.addInitScript({ content: axe.source });
    const target = new URL(check.path, origin);
    target.searchParams.set("__mp_check", check.id);
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
    await settlePage(page, origin);
    if (check.type === "element_state") {
      const locator = await resolveLocator(page, check.elementRef);
      await locator.first().waitFor({ state: "attached", timeout: 6_000 });
      if (check.assertion === "count") {
        const count = await locator.count();
        return result(count === check.expectedCount ? "PASS" : "FAIL", `${check.expectedCount} matching elements`, `${count} matching elements`);
      }
      const actual = check.assertion === "visible" ? await locator.first().isVisible() : await locator.first().isEnabled();
      return result(actual ? "PASS" : "FAIL", `${check.assertion}: true`, `${check.assertion}: ${actual}`);
    }
    if (check.type === "link_destination") {
      const locator = await resolveLocator(page, check.elementRef);
      await locator.first().waitFor({ state: "visible", timeout: 6_000 });
      await locator.first().click();
      await settlePage(page, origin);
      const observed = new URL(page.url());
      const passed = observed.origin === origin && observed.pathname === check.expectedPath;
      return result(passed ? "PASS" : "FAIL", `Activating the link opens same-origin ${check.expectedPath}`, `${observed.pathname}${observed.hash}`);
    }
    if (check.type === "form_submission") {
      let observedStatus: number | undefined;
      for (const field of check.fields) await page.getByLabel(field.label, { exact: true }).fill(field.value);
      const responsePromise = check.expectedPostPath ? page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).origin === origin && new URL(response.url()).pathname === check.expectedPostPath, { timeout: 8_000 }) : null;
      await (await resolveLocator(page, check.submitRef)).click();
      if (responsePromise) observedStatus = (await responsePromise).status();
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      assertVerifiedPage(page, origin);
      const textPassed = check.successText ? await page.getByText(check.successText, { exact: false }).isVisible() : true;
      const pathPassed = check.successPath ? new URL(page.url()).pathname === check.successPath : true;
      const statusPassed = check.expectedStatus ? observedStatus === check.expectedStatus : true;
      return result(textPassed && pathPassed && statusPassed ? "PASS" : "FAIL", `Success UI${check.expectedStatus ? ` + HTTP ${check.expectedStatus}` : ""}`, `UI: ${textPassed ? "shown" : "missing"}${observedStatus ? `; HTTP ${observedStatus}` : ""}`);
    }
    if (check.type === "viewport_layout") {
      let worstOverflow = 0;
      for (const viewport of check.viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        worstOverflow = Math.max(worstOverflow, overflow);
      }
      return result(worstOverflow <= check.maxHorizontalOverflowPx ? "PASS" : "FAIL", `≤ ${check.maxHorizontalOverflowPx}px horizontal overflow`, `${worstOverflow}px horizontal overflow`);
    }
    if (check.submitRef) {
      if (!check.ownerAcknowledgedMutation) return result("ERROR", "Owner-authorized accessibility precondition", "Mutation acknowledgement missing");
      await (await resolveLocator(page, check.submitRef)).click();
      await page.waitForFunction(() => document.querySelectorAll("input[aria-describedby]").length > 0, undefined, { timeout: 3_000 });
    }
    const axeReady = await page.evaluate(() => typeof (window as typeof window & { axe?: { run?: unknown } }).axe?.run === "function");
    if (!axeReady) throw new Error("Axe could not be initialized in the verified page.");
    const accessibility = await page.evaluate(async ({ tags, impacts }) => {
      const axeApi = (window as typeof window & { axe: { run: (context: Document, options: unknown) => Promise<{ violations: Array<{ impact: string | null; id: string; nodes: unknown[] }> }> } }).axe;
      const scan = await axeApi.run(document, { runOnly: { type: "tag", values: tags } });
      const blocking = scan.violations.filter((violation) => violation.impact && impacts.some((impact) => impact === violation.impact));
      return { violationCount: scan.violations.length, blockingCount: blocking.length, rules: blocking.map((violation) => `${violation.id} (${violation.nodes.length})`).slice(0, 12) };
    }, { tags: check.tags, impacts: check.failImpacts });
    return result(accessibility.blockingCount === 0 ? "PASS" : "FAIL", `No ${check.failImpacts.join(" or ")} Axe violations`, accessibility.blockingCount === 0 ? `Axe completed: ${accessibility.violationCount} non-blocking violations` : `${accessibility.blockingCount} blocking violations: ${accessibility.rules.join(", ")}`);
  } catch (error) {
    return result("ERROR", "Check completed", error instanceof Error ? error.message.slice(0, 300) : "Unknown runner error");
  }
}

async function runJob(env: Env, message: JobMessage): Promise<void> {
  const leaseResponse = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/lease`, { attempt: message.attempt });
  if (!leaseResponse.ok) throw new Error(`Lease failed with ${leaseResponse.status}`);
  const lease = leaseSchema.parse(await leaseResponse.json());
  const browser = await launchWithBackoff(env.BROWSER);
  const results: CriterionResult[] = [];
  const artifacts: StoredEvidenceArtifact[] = [];
  const startedAt = new Date().toISOString();
  const browserVersion = browser.version();
  try {
    for (const check of lease.checks) {
      const safety = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/validate-origin`, {});
      if (!safety.ok) throw new Error(`Origin safety revalidation failed with ${safety.status}`);
      const context = await browser.newContext({ serviceWorkers: "block", permissions: [], viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      try {
        page.on("popup", (popup) => void popup.close());
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (request.isNavigationRequest() && new URL(request.url()).origin !== lease.targetOrigin) await route.abort("blockedbyclient");
          else await route.continue();
        });
        const checkResult = await executeCheck(page, lease.targetOrigin, check);
        const screenshot = new Uint8Array(await page.screenshot({ type: "png" }));
        const evidence: EvidenceArtifact = { criterionId: check.criterionId, kind: "SCREENSHOT", mimeType: "image/png", base64: base64(screenshot), sha256: await sha256Bytes(screenshot) };
        const uploaded = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/artifacts`, evidence);
        if (!uploaded.ok) throw new Error(`Evidence upload failed with ${uploaded.status}`);
        const payload = await uploaded.json() as { artifact: StoredEvidenceArtifact };
        artifacts.push(payload.artifact);
        results.push({ ...checkResult, evidenceId: payload.artifact.storagePath, evidenceHash: payload.artifact.sha256 });
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
  }
  const completion = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/complete`, {
    attempt: message.attempt,
    buildLabel: lease.buildLabel,
    browserVersion,
    runnerVersion: "0.4.0",
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    artifacts,
  });
  if (!completion.ok) throw new Error(`Completion failed with ${completion.status}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, service: "milestoneproof-runner" });
    if (request.method !== "POST" || url.pathname !== "/v1/jobs") return new Response("Not found", { status: 404 });
    const body = await request.text();
    const timestamp = request.headers.get("x-mp-timestamp") ?? "";
    const supplied = request.headers.get("x-mp-signature") ?? "";
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300_000) return Response.json({ error: "Expired request" }, { status: 401 });
    const expected = await signature(env.RUNNER_HMAC_SECRET, timestamp, body);
    if (!constantTimeEqual(expected, supplied)) return Response.json({ error: "Invalid signature" }, { status: 401 });
    const job = jobSchema.safeParse(JSON.parse(body));
    if (!job.success) return Response.json({ error: "Invalid job" }, { status: 422 });
    await env.JOB_QUEUE.send({ jobId: job.data.jobId, attempt: 1 });
    return Response.json({ accepted: true, jobId: job.data.jobId }, { status: 202 });
  },
  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try { await runJob(env, message.body); message.ack(); }
      catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        console.error("Runner job failed", message.body.jobId, reason);
        try { await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.body.jobId)}/fail`, { attempt: message.body.attempt, error: reason.slice(0, 300) }); } catch { /* best effort failure record */ }
        message.ack();
      }
    }
  },
};
