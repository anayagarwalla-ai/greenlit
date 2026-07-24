export const dynamic = "force-static";

export function GET() {
  const body = [
    "Contact: mailto:anay.agarwalla@gmail.com",
    "Preferred-Languages: en",
    "Canonical: https://greenlitproof.vercel.app/.well-known/security.txt",
    "Policy: https://greenlitproof.vercel.app/privacy",
    "Expires: 2027-07-24T00:00:00.000Z",
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
