export const dynamic = "force-dynamic";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function GET(request: Request) {
  let origin = new URL(request.url).origin;
  try {
    origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
  } catch {
    // Use the request origin when a deployment URL has not been configured yet.
  }
  const configuredEmail = process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim()
    || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
    || "";
  const securityEmail = validEmail(configuredEmail) ? configuredEmail : null;
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const body = [
    `Contact: ${securityEmail ? `mailto:${securityEmail}` : `${origin}/privacy-request?type=security`}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/privacy`,
    `Expires: ${expires}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": securityEmail
        ? "public, max-age=3600, s-maxage=86400"
        : "public, max-age=300, s-maxage=300",
    },
  });
}
