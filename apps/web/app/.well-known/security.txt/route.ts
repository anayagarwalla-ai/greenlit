export const dynamic = "force-dynamic";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function GET(request: Request) {
  const securityEmail = process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim()
    || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
    || "";
  if (!validEmail(securityEmail)) {
    return new Response("Security contact is not configured.\n", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
      },
    });
  }
  let origin = new URL(request.url).origin;
  try {
    origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
  } catch {
    // Use the request origin when a deployment URL has not been configured yet.
  }
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const body = [
    `Contact: mailto:${securityEmail}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/privacy`,
    `Expires: ${expires}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
