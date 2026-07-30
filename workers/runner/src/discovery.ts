import type { Locator, Page } from "@cloudflare/playwright";
import { pathWithQueryAndHash } from "./security";

export const DISCOVERY_ROLES = [
  "button",
  "link",
  "heading",
  "region",
  "img",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "spinbutton",
] as const;

export type DiscoveryRole = (typeof DISCOVERY_ROLES)[number];

export type DiscoveredFormField = {
  label: string;
  controlType: "text" | "email" | "tel" | "url" | "search" | "textarea" | "select" | "checkbox" | "radio" | "other";
  required: boolean;
};

export type DiscoveredCandidate = {
  id: string;
  path: string;
  role: DiscoveryRole;
  name: string;
  ref: string;
  visible: true;
  enabled: boolean;
  matchCount: number;
  unique: boolean;
  href?: string;
  form?: {
    action?: string;
    method: "get" | "post";
    fields: DiscoveredFormField[];
  };
};

export type DiscoveryCatalog = {
  pages: string[];
  candidates: DiscoveredCandidate[];
  truncated: boolean;
};

const DEFAULT_MAX_PAGES = 4;
const DEFAULT_MAX_CANDIDATES = 80;
const PER_ROLE_LIMIT = 24;
const MAX_NAME_LENGTH = 145;
const BLOCKED_CRAWL_SEGMENTS = /(?:^|\/)(?:api|admin|logout|log-out|signout|sign-out|delete|remove|unsubscribe)(?:\/|$)/i;
const ASSET_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?)(?:$|\?)/i;

function decodeQuotedName(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

/**
 * Playwright's ariaSnapshot is the browser-computed accessibility tree. We
 * only need the root entry for the locator, for example:
 *   - button "Send request"
 *   - heading "Contact us" [level=2]
 */
export function ariaSnapshotName(snapshot: string, role: DiscoveryRole): string {
  const firstLine = snapshot.split("\n", 1)[0]?.trim() ?? "";
  const quoted = firstLine.match(new RegExp(`^- ${role} "((?:\\\\.|[^"])*)"(?:\\s+\\[|:|$)`));
  const raw = quoted
    ? decodeQuotedName(quoted[1] ?? "")
    : firstLine.match(new RegExp(`^- ${role} ([^\\[:]+?)(?:\\s+\\[|:|$)`))?.[1] ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

export function safeSameOriginPath(rawHref: string | null, baseUrl: string, origin: string): string | undefined {
  if (!rawHref) return undefined;
  try {
    const url = new URL(rawHref, baseUrl);
    if (url.origin !== origin || url.username || url.password) return undefined;
    return pathWithQueryAndHash(url).slice(0, 500);
  } catch {
    return undefined;
  }
}

function crawlPath(href: string): string | undefined {
  try {
    const url = new URL(href, "https://greenlit.invalid");
    if (url.origin !== "https://greenlit.invalid" || url.search || BLOCKED_CRAWL_SEGMENTS.test(url.pathname) || ASSET_EXTENSION.test(url.pathname)) return undefined;
    return url.pathname || "/";
  } catch {
    return undefined;
  }
}

function crawlTokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function relevantCrawlPath(href: string, accessibleName: string, intentTerms: string[]): string | undefined {
  const path = crawlPath(href);
  if (!path || intentTerms.length === 0) return undefined;
  const candidateTerms = new Set(crawlTokens(`${accessibleName} ${path}`));
  return intentTerms.some((term) => candidateTerms.has(term.toLowerCase())) ? path : undefined;
}

async function formMetadata(locator: Locator, origin: string): Promise<DiscoveredCandidate["form"] | undefined> {
  const value = await locator.evaluate((element, expectedOrigin) => {
    const form = element.closest("form");
    if (!(form instanceof HTMLFormElement)) return null;
    const fields = Array.from(form.querySelectorAll("input, textarea, select"))
      .filter((control) => {
        if (control.tagName.toLowerCase() === "input") return !["button", "hidden", "image", "reset", "submit"].includes((control.getAttribute("type") ?? "text").toLowerCase());
        return true;
      })
      .slice(0, 12)
      .map((control) => {
        const labels = (control as unknown as { labels?: Iterable<Element> }).labels;
        const label = Array.from(labels ?? []).map((item) => item.textContent?.trim() ?? "").find(Boolean)
          ?? control.getAttribute("aria-label")?.trim()
          ?? "";
        let controlType: DiscoveredFormField["controlType"] = "other";
        const tagName = control.tagName.toLowerCase();
        const inputType = (control.getAttribute("type") ?? "text").toLowerCase();
        if (tagName === "textarea") controlType = "textarea";
        else if (tagName === "select") controlType = "select";
        else if (inputType === "checkbox") controlType = "checkbox";
        else if (inputType === "radio") controlType = "radio";
        else if (["text", "email", "tel", "url", "search"].includes(inputType)) controlType = inputType as DiscoveredFormField["controlType"];
        return { label, controlType, required: control.hasAttribute("required") };
      })
      .filter((field) => field.label.length > 0);
    let action: string | undefined;
    try {
      const url = new URL(form.action || location.href);
      if (url.origin === expectedOrigin) action = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      action = undefined;
    }
    return { action, method: form.method.toLowerCase() === "post" ? "post" as const : "get" as const, fields };
  }, origin).catch(() => null);
  if (!value || value.fields.length === 0) return undefined;
  return {
    ...(value.action ? { action: value.action.slice(0, 500) } : {}),
    method: value.method,
    fields: value.fields
      .map((field) => ({
        label: field.label.replace(/\s+/g, " ").trim().slice(0, 160),
        controlType: field.controlType,
        required: field.required,
      }))
      .filter((field) => field.label.length > 0),
  };
}

async function collectPageCandidates(page: Page, origin: string, pageNumber: number, remaining: number): Promise<DiscoveredCandidate[]> {
  const path = pathWithQueryAndHash(new URL(page.url()));
  const candidates: DiscoveredCandidate[] = [];

  for (const role of DISCOVERY_ROLES) {
    if (candidates.length >= remaining) break;
    const roleLocator = page.getByRole(role);
    const locatorCount = Math.min(
      PER_ROLE_LIMIT,
      remaining - candidates.length,
      await roleLocator.count().catch(() => 0),
    );
    for (let index = 0; index < locatorCount; index += 1) {
      if (candidates.length >= remaining) break;
      const locator = roleLocator.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const snapshot = await locator.ariaSnapshot({ timeout: 1_000 }).catch(() => "");
      const name = ariaSnapshotName(snapshot, role);
      if (!name) continue;
      const ref = `${role}:${name}`;
      if (ref.length > 160) continue;
      const matchCount = Math.min(100, await page.getByRole(role, { name, exact: true }).count().catch(() => 0));
      const href = role === "link"
        ? safeSameOriginPath(
            await locator.evaluate((element) => element instanceof HTMLAnchorElement ? element.href : null).catch(() => null),
            page.url(),
            origin,
          )
        : undefined;
      const form = role === "button" ? await formMetadata(locator, origin) : undefined;
      candidates.push({
        id: `p${pageNumber}-${role}-${index + 1}`,
        path,
        role,
        name,
        ref,
        visible: true,
        enabled: await locator.isEnabled().catch(() => true),
        matchCount,
        unique: matchCount === 1,
        ...(href ? { href } : {}),
        ...(form ? { form } : {}),
      });
    }
  }
  return candidates;
}

async function settleDiscoveryPage(page: Page, origin: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 6_000 });
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
  const current = new URL(page.url());
  if (current.origin !== origin) throw new Error("Discovery navigation left the verified staging origin.");
}

export async function discoverBuild(page: Page, origin: string, options: {
  deadline?: number;
  startPath?: string;
  intentTerms?: string[];
  maxPages?: number;
  maxCandidates?: number;
} = {}): Promise<DiscoveryCatalog> {
  const deadline = options.deadline ?? Date.now() + 20_000;
  const maxPages = Math.max(1, Math.min(6, options.maxPages ?? DEFAULT_MAX_PAGES));
  const maxCandidates = Math.max(1, Math.min(120, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
  const intentTerms = (options.intentTerms ?? []).map((term) => term.toLowerCase()).slice(0, 24);
  const queue = [options.startPath ?? "/"];
  const queued = new Set(queue);
  const pages: string[] = [];
  const candidates: DiscoveredCandidate[] = [];
  const seenCandidates = new Set<string>();
  let truncated = false;

  while (queue.length > 0 && pages.length < maxPages && candidates.length < maxCandidates) {
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    const nextPath = queue.shift()!;
    await page.goto(new URL(nextPath, origin).toString(), { waitUntil: "domcontentloaded", timeout: Math.min(7_000, Math.max(1_000, deadline - Date.now())) });
    await settleDiscoveryPage(page, origin);
    const currentPath = pathWithQueryAndHash(new URL(page.url()));
    pages.push(currentPath);
    const pageCandidates = await collectPageCandidates(page, origin, pages.length, maxCandidates - candidates.length);
    for (const candidate of pageCandidates) {
      const key = `${candidate.path}\u0000${candidate.ref}`;
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      candidates.push(candidate);
      if (candidate.href && maxPages > 1) {
        const next = relevantCrawlPath(candidate.href, candidate.name, intentTerms);
        if (next && !queued.has(next) && queue.length < 12) {
          queued.add(next);
          queue.push(next);
        }
      }
    }
  }

  if (queue.length > 0 || candidates.length >= maxCandidates) truncated = true;
  return { pages, candidates, truncated };
}
