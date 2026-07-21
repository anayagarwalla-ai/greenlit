import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";
import { getOptionalUser } from "@/lib/supabase-server";
import { createOriginProof } from "@/lib/origin-proof";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowed } from "@/lib/beta-access";

export const runtime = "nodejs";

const schema = z.object({ target: z.string().max(2000), token: z.string().min(16).max(200) });

async function readSmallProof(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 4_096) throw new Error("Ownership proof is too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > 4_096) { await reader.cancel(); throw new Error("Ownership proof is too large."); }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return `${value}${decoder.decode()}`.trim();
}

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in before connecting a staging origin." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!betaAccessAllowed(user)) return NextResponse.json({ error: "This account is not on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid verification request." }, { status: 422 });
  const validated = validateStagingUrl(body.data.target);
  if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 422 });
  const quota = await consumeRateLimit(request, "origin-verification-hour", 12, 3_600, user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  try {
    const [v4, v6] = await Promise.all([resolve4(validated.url.hostname).catch(() => []), resolve6(validated.url.hostname).catch(() => [])]);
    assertSafeResolvedAddresses([...v4, ...v6]);
    const proofUrl = new URL("/.well-known/milestoneproof.txt", validated.url.origin);
    const response = await fetch(proofUrl, { redirect: "error", signal: AbortSignal.timeout(5_000), headers: { "user-agent": "MilestoneProof-Origin-Verifier/0.1" } });
    const proof = await readSmallProof(response);
    if (!response.ok || proof !== body.data.token) return NextResponse.json({ error: "The ownership token did not match." }, { status: 409 });
    const verifiedAt = new Date().toISOString();
    return NextResponse.json({ verified: true, origin: validated.url.origin, verifiedAt, receipt: createOriginProof(validated.url.origin, user.id) }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "Origin verification failed. Check DNS, TLS, and the token file." }, { status: 422 });
  }
}
