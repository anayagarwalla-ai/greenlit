export function GET() {
  return new Response(process.env.MILESTONEPROOF_ORIGIN_TOKEN ?? "milestoneproof-demo-origin-token-2026", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

