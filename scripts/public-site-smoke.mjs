#!/usr/bin/env node

const baseUrl = new URL(
  process.env.SITE_SMOKE_BASE_URL
    || process.argv[2]
    || "http://127.0.0.1:3008",
);

const seeds = [
  "/",
  "/workspace",
  "/request-demo",
  "/resources",
  "/resources/changelog",
  "/resources/roi-calculator",
  "/trust",
  "/privacy",
  "/privacy-request",
  "/terms",
  "/contact",
  "/records",
  "/login",
  "/fixture/rc1",
  "/fixture/rc2",
  "/fixture/contact",
  "/review/demo",
  "/receipt/demo",
];

const protectedPrefixes = [
  "/admin",
  "/api",
  "/auth",
  "/dashboard",
  "/receipt/",
  "/review/",
];

const queue = seeds.map((path) => new URL(path, baseUrl));
const queued = new Set(queue.map((url) => url.href));
const checked = new Map();
const fragmentChecks = [];
const assetUrls = new Set();
const failures = [];

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function attributes(html, element, attribute) {
  const results = [];
  const elementPattern = new RegExp(`<${element}\\b[^>]*>`, "gi");
  const attributePattern = new RegExp(`\\b${attribute}\\s*=\\s*([\"'])(.*?)\\1`, "i");
  for (const match of html.matchAll(elementPattern)) {
    const value = match[0].match(attributePattern)?.[2];
    if (value !== undefined) results.push(decodeHtml(value.trim()));
  }
  return results;
}

function ids(html) {
  return new Set([
    ...attributes(html, "[a-zA-Z][a-zA-Z0-9:-]*", "id"),
    ...attributes(html, "a", "name"),
  ]);
}

function shouldCrawl(url) {
  if (url.origin !== baseUrl.origin) return false;
  if (url.pathname === "/review/demo" || url.pathname === "/receipt/demo") return true;
  return !protectedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix));
}

function queueUrl(url) {
  url.hash = "";
  if (queued.has(url.href) || checked.has(url.href)) return;
  queued.add(url.href);
  queue.push(url);
}

function securityHeaders(response, url) {
  const required = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": null,
    "permissions-policy": null,
    "content-security-policy": null,
    "x-request-id": null,
  };
  for (const [name, expected] of Object.entries(required)) {
    const actual = response.headers.get(name);
    if (!actual || (expected && actual !== expected)) {
      failures.push(`${url.pathname}: missing or incorrect ${name}`);
    }
  }
  const csp = response.headers.get("content-security-policy") || "";
  for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    if (!csp.includes(directive)) failures.push(`${url.pathname}: CSP is missing ${directive}`);
  }
}

while (queue.length > 0 && checked.size < 100) {
  const url = queue.shift();
  queued.delete(url.href);
  let response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    failures.push(`${url.pathname}: network failure (${error instanceof Error ? error.message : "unknown"})`);
    continue;
  }
  const finalUrl = new URL(response.url);
  if (!response.ok) {
    failures.push(`${url.pathname}: HTTP ${response.status}`);
    continue;
  }
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  checked.set(finalUrl.href, { body, contentType });
  if (!contentType.includes("text/html")) continue;

  securityHeaders(response, finalUrl);
  if (/<a\b[^>]*\bhref\s*=\s*([\"'])\s*\1/i.test(body)) {
    failures.push(`${finalUrl.pathname}: contains an empty anchor href`);
  }
  if (/<a\b[^>]*\bhref\s*=\s*([\"'])javascript:/i.test(body)) {
    failures.push(`${finalUrl.pathname}: contains a javascript: anchor`);
  }

  for (const href of attributes(body, "a", "href")) {
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    let target;
    try {
      target = new URL(href, finalUrl);
    } catch {
      failures.push(`${finalUrl.pathname}: malformed link ${href}`);
      continue;
    }
    if (target.origin !== baseUrl.origin) continue;
    if (target.hash) {
      fragmentChecks.push({
        source: finalUrl.pathname,
        target: new URL(`${target.pathname}${target.search}`, baseUrl).href,
        fragment: decodeURIComponent(target.hash.slice(1)),
      });
    }
    if (shouldCrawl(target)) queueUrl(target);
  }

  for (const src of [
    ...attributes(body, "script", "src"),
    ...attributes(body, "img", "src"),
    ...attributes(body, "link", "href"),
  ]) {
    let asset;
    try {
      asset = new URL(src, finalUrl);
    } catch {
      failures.push(`${finalUrl.pathname}: malformed asset URL ${src}`);
      continue;
    }
    if (asset.origin === baseUrl.origin && !asset.hash && !asset.pathname.startsWith("/api/")) {
      assetUrls.add(asset.href);
    }
  }
}

for (const { source, target, fragment } of fragmentChecks) {
  if (!fragment) continue;
  const page = checked.get(target);
  if (!page) {
    failures.push(`${source}: fragment target was not crawled (${target}#${fragment})`);
    continue;
  }
  if (!ids(page.body).has(fragment)) failures.push(`${source}: missing fragment target #${fragment}`);
}

for (const href of [...assetUrls].sort()) {
  const response = await fetch(href, { redirect: "follow" }).catch(() => null);
  if (!response?.ok) failures.push(`${new URL(href).pathname}: asset HTTP ${response?.status ?? "network failure"}`);
}

const boundaryChecks = [
  { path: "/dashboard", statuses: [307, 308], location: "/login" },
  { path: "/admin", statuses: [404] },
  { path: "/api/account/records", statuses: [401] },
  { path: "/api/admin/overview", statuses: [403] },
  { path: "/review/not-a-real-packet", statuses: [200, 404] },
  { path: "/receipt/not-a-real-packet", statuses: [200, 404] },
  { path: "/page-that-does-not-exist", statuses: [404], contains: "This path is not part of the proof." },
];

for (const boundary of boundaryChecks) {
  const response = await fetch(new URL(boundary.path, baseUrl), { redirect: "manual" }).catch(() => null);
  if (!response || !boundary.statuses.includes(response.status)) {
    failures.push(`${boundary.path}: expected ${boundary.statuses.join("/")} but received ${response?.status ?? "network failure"}`);
    continue;
  }
  if (boundary.location) {
    const location = response.headers.get("location");
    const redirectPath = location ? new URL(location, baseUrl).pathname : "";
    if (!redirectPath.startsWith(boundary.location)) {
      failures.push(`${boundary.path}: expected redirect to ${boundary.location}`);
    }
  }
  if (boundary.contains && !await response.text().then((body) => body.includes(boundary.contains))) {
    failures.push(`${boundary.path}: missing expected recovery copy`);
  }
}

const auxiliaryChecks = [
  { path: "/robots.txt", contentType: "text/plain", contains: "Sitemap:" },
  { path: "/sitemap.xml", contentType: "application/xml", contains: "/resources/roi-calculator" },
  { path: "/.well-known/security.txt", contentType: "text/plain", contains: "Contact: mailto:" },
  { path: "/manifest.webmanifest", contentType: "application/manifest+json", contains: "\"name\":\"Greenlit\"" },
  { path: "/icon.png", contentType: "image/png" },
  { path: "/apple-icon.png", contentType: "image/png" },
  { path: "/api/demo", contentType: "application/json", contains: "\"mode\":\"seeded-demo\"" },
  { path: "/api/health", contentType: "application/json", contains: "\"healthType\":\"liveness\"" },
];

for (const auxiliary of auxiliaryChecks) {
  const response = await fetch(new URL(auxiliary.path, baseUrl), { redirect: "follow" }).catch(() => null);
  if (!response?.ok) {
    failures.push(`${auxiliary.path}: expected HTTP 2xx but received ${response?.status ?? "network failure"}`);
    continue;
  }
  const actualType = response.headers.get("content-type") || "";
  if (!actualType.includes(auxiliary.contentType)) {
    failures.push(`${auxiliary.path}: expected ${auxiliary.contentType} but received ${actualType || "no content type"}`);
  }
  if (auxiliary.contains) {
    const body = await response.text();
    if (!body.includes(auxiliary.contains)) failures.push(`${auxiliary.path}: missing expected content ${auxiliary.contains}`);
  }
}

if (failures.length > 0) {
  console.error(`Public-site smoke failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Public-site smoke passed: ${checked.size} pages, ${assetUrls.size} assets, ${fragmentChecks.length} fragment links, ${boundaryChecks.length} access boundaries, ${auxiliaryChecks.length} auxiliary endpoints.`);
}
