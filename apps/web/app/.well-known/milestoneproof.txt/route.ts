export function GET() {
  const token = process.env.MILESTONEPROOF_ORIGIN_TOKEN;
  if (!token) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(token, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
