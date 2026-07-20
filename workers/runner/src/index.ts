import { launch, type BrowserWorker } from "@cloudflare/playwright";
import axe from "axe-core";
import { checkSpecSchema, type CheckSpec, type CriterionResult } from "@milestoneproof/contracts";
import { z } from "zod";

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

async function executeCheck(page: import("@cloudflare/playwright").Page, origin: string, check: CheckSpec): Promise<CriterionResult> {
  const started = Date.now();
  const result = (status: CriterionResult["status"], expected: string, observed: string): CriterionResult => ({ criterionId: check.criterionId, status, expected, observed, durationMs: Date.now() - started, timestamp: new Date().toISOString() });
  try {
    await page.goto(new URL(check.path, origin).toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
    if (check.type === "element_state") {
      const locator = await resolveLocator(page, check.elementRef);
      if (check.assertion === "count") {
        const count = await locator.count();
        return result(count === check.expectedCount ? "PASS" : "FAIL", `${check.expectedCount} matching elements`, `${count} matching elements`);
      }
      const actual = check.assertion === "visible" ? await locator.first().isVisible() : await locator.first().isEnabled();
      return result(actual ? "PASS" : "FAIL", `${check.assertion}: true`, `${check.assertion}: ${actual}`);
    }
    if (check.type === "link_destination") {
      const locator = await resolveLocator(page, check.elementRef);
      const href = await locator.first().getAttribute("href");
      const observed = href ? new URL(href, origin) : null;
      const passed = observed?.origin === origin && observed.pathname === check.expectedPath;
      return result(passed ? "PASS" : "FAIL", `Same-origin ${check.expectedPath}`, observed?.pathname ?? "No destination");
    }
    if (check.type === "form_submission") {
      let observedStatus: number | undefined;
      for (const field of check.fields) await page.getByLabel(field.label, { exact: true }).fill(field.value);
      const responsePromise = check.expectedPostPath ? page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).origin === origin && new URL(response.url()).pathname === check.expectedPostPath, { timeout: 8_000 }) : null;
      await (await resolveLocator(page, check.submitRef)).click();
      if (responsePromise) observedStatus = (await responsePromise).status();
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
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async ({ tags, impacts }) => {
      const axeApi = (globalThis as typeof globalThis & { axe: typeof axe }).axe;
      const report = await axeApi.run(document, { runOnly: { type: "tag", values: tags } });
      return report.violations.filter((violation) => violation.impact && impacts.some((impact) => impact === violation.impact));
    }, { tags: check.tags, impacts: check.failImpacts });
    return result(violations.length === 0 ? "PASS" : "FAIL", "0 critical or serious violations", `${violations.length} critical or serious violations`);
  } catch (error) {
    return result("ERROR", "Check completed", error instanceof Error ? error.message.slice(0, 300) : "Unknown runner error");
  }
}

async function runJob(env: Env, message: JobMessage): Promise<void> {
  const leaseResponse = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/lease`, { attempt: message.attempt });
  if (!leaseResponse.ok) throw new Error(`Lease failed with ${leaseResponse.status}`);
  const lease = leaseSchema.parse(await leaseResponse.json());
  const browser = await launch(env.BROWSER);
  const context = await browser.newContext({ serviceWorkers: "block", permissions: [], viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const results: CriterionResult[] = [];
  const artifacts: EvidenceArtifact[] = [];
  const startedAt = new Date().toISOString();
  const browserVersion = browser.version();
  try {
    page.on("popup", (popup) => void popup.close());
    for (const check of lease.checks) {
      results.push(await executeCheck(page, lease.targetOrigin, check));
      const screenshot = new Uint8Array(await page.screenshot({ type: "png" }));
      artifacts.push({ criterionId: check.criterionId, kind: "SCREENSHOT", mimeType: "image/png", base64: base64(screenshot), sha256: await sha256Bytes(screenshot) });
    }
  } finally {
    await context.close();
    await browser.close();
  }
  const completion = await authenticatedFetch(env, `/api/internal/jobs/${encodeURIComponent(message.jobId)}/complete`, {
    attempt: message.attempt,
    buildLabel: lease.buildLabel,
    browserVersion,
    runnerVersion: "0.2.0",
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
