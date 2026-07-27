import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";
import { getOptionalUser } from "@/lib/supabase-server";
import { createOriginProof } from "@/lib/origin-proof";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { pinnedHttpsGet } from "@/lib/pinned-https";
import { readLimitedJsonResult } from "@/lib/request-security";
import { logProductEvent } from "@/lib/operations";

export const runtime = "nodejs";

const schema = z.object({ target: z.string().max(2000), token: z.string().min(16).max(200) });

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in before connecting a staging origin." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "This account is not on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const body = schema.safeParse(limited.body);
  if (!body.success) return NextResponse.json({ error: "Invalid verification request." }, { status: 422 });
  const validated = validateStagingUrl(body.data.target);
  if (!validated.ok) return NextResponse.json({ error: validated.reason }, { status: 422 });
  const quota = await consumeRateLimit(request, "origin-verification-hour", 12, 3_600, user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  try {
    const [v4, v6] = await Promise.all([resolve4(validated.url.hostname).catch(() => []), resolve6(validated.url.hostname).catch(() => [])]);
    const addresses = [...v4, ...v6].sort();
    assertSafeResolvedAddresses(addresses);
    const proofUrl = new URL("/.well-known/greenlit.txt", validated.url.origin);
    const response = await pinnedHttpsGet(proofUrl, addresses);
    if (response.location || response.status < 200 || response.status >= 300 || response.text !== body.data.token) return NextResponse.json({ error: "The ownership token did not match." }, { status: 409 });
    const verifiedAt = new Date().toISOString();
    await logProductEvent({ eventType: "ORIGIN_VERIFIED", ownerUserId: user.id, properties: { status: "VERIFIED" } });
    return NextResponse.json({ verified: true, origin: validated.url.origin, verifiedAt, receipt: createOriginProof(validated.url.origin, user.id) }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "Origin verification failed. Check DNS, TLS, and the token file." }, { status: 422 });
  }
}
