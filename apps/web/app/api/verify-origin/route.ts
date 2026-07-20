import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";

export const runtime = "nodejs";

const schema = z.object({ target: z.string().max(2000), token: z.string().min(16).max(200) });

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid verification request." }, { status: 422 });
  const validated = validateStagingUrl(body.data.target);
  if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 422 });
  try {
    const [v4, v6] = await Promise.all([resolve4(validated.url.hostname).catch(() => []), resolve6(validated.url.hostname).catch(() => [])]);
    assertSafeResolvedAddresses([...v4, ...v6]);
    const proofUrl = new URL("/.well-known/milestoneproof.txt", validated.url.origin);
    const response = await fetch(proofUrl, { redirect: "error", signal: AbortSignal.timeout(5_000), headers: { "user-agent": "MilestoneProof-Origin-Verifier/0.1" } });
    const proof = (await response.text()).trim();
    if (!response.ok || proof !== body.data.token) return NextResponse.json({ error: "The ownership token did not match." }, { status: 409 });
    return NextResponse.json({ verified: true, origin: validated.url.origin, verifiedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Origin verification failed. Check DNS, TLS, and the token file." }, { status: 422 });
  }
}

