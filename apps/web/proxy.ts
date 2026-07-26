import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MACHINE_ENDPOINTS = [
  "/api/internal/",
  "/api/stripe/webhook",
  "/api/health/deep",
];
const MAX_DEFAULT_API_BODY_BYTES = 2_000_000;

function trustedImageOrigin(): string {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    return origin === "null" ? "" : ` ${origin}`;
  } catch {
    return "";
  }
}

function forwardedValue(request: NextRequest, name: string) {
  return request.headers.get(name)?.split(",")[0]?.trim() ?? "";
}

function effectiveRequestOrigin(request: NextRequest) {
  const protocol = forwardedValue(request, "x-forwarded-proto")
    || request.nextUrl.protocol.replace(/:$/, "");
  const host = forwardedValue(request, "x-forwarded-host")
    || request.headers.get("host")?.trim()
    || request.nextUrl.host;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return request.nextUrl.origin;
  }
}

function contentSecurityPolicy(nonce: string, request: NextRequest): string {
  const developmentScripts = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const developmentConnections = process.env.NODE_ENV === "development" ? " ws: wss:" : "";
  const isSecureRequest = effectiveRequestOrigin(request).startsWith("https://");
  const upgradeInsecureRequests = process.env.NODE_ENV === "production" && isSecureRequest
    ? "; upgrade-insecure-requests"
    : "";
  return `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScripts}; style-src 'self' 'unsafe-inline'; connect-src 'self'${developmentConnections}; img-src 'self' data: blob:${trustedImageOrigin()}; font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'${upgradeInsecureRequests}`;
}

function isMachineEndpoint(pathname: string) {
  return MACHINE_ENDPOINTS.some((path) => pathname === path || pathname.startsWith(path));
}

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = contentSecurityPolicy(nonce, request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const proceed = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", policy);
    return response;
  };
  const reject = (body: Record<string, string>, status: number) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Content-Security-Policy", policy);
    return response;
  };

  if (!request.nextUrl.pathname.startsWith("/api/") || !MUTATING_METHODS.has(request.method)) return proceed();

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_DEFAULT_API_BODY_BYTES)) {
    return reject({ error: "Request body is too large.", code: "REQUEST_TOO_LARGE" }, 413);
  }

  if (isMachineEndpoint(request.nextUrl.pathname)) return proceed();

  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return reject({ error: "Cross-site requests are not accepted.", code: "CROSS_SITE_REQUEST" }, 403);
  }
  if (origin) {
    let originValue = "";
    try { originValue = new URL(origin).origin; } catch { /* invalid Origin is rejected below */ }
    if (originValue !== effectiveRequestOrigin(request)) {
      return reject({ error: "Request origin is not accepted.", code: "INVALID_ORIGIN" }, 403);
    }
  }
  return proceed();
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
