import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuthorization } from "@/lib/admin-auth";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { readLimitedJsonResult } from "@/lib/request-security";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().trim().regex(/^\d{6}$/) }),
]);

export async function GET() {
  const auth = await getAdminAuthorization();
  if (!auth.user || !auth.client) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const { data, error } = await auth.client.auth.mfa.listFactors();
  if (error) return NextResponse.json({ error: "Multi-factor status is temporarily unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ aal2: auth.aal2, verifiedFactors: data.totp.map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? "Authenticator app" })) }, { headers: noStoreJsonHeaders() });
}

export async function POST(request: Request) {
  const auth = await getAdminAuthorization();
  if (!auth.user || !auth.client) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const quota = await consumeRateLimit(request, "admin-mfa-15m", 12, 15 * 60, auth.user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid six-digit authenticator code." }, { status: 422, headers: noStoreJsonHeaders() });
  if (parsed.data.action === "enroll") {
    const existing = await auth.client.auth.mfa.listFactors();
    const verified = existing.data?.totp[0];
    if (verified) return NextResponse.json({ factorId: verified.id, alreadyEnrolled: true }, { headers: noStoreJsonHeaders() });
    const { data, error } = await auth.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Greenlit operator" });
    if (error) return NextResponse.json({ error: "Authenticator enrollment could not be started." }, { status: 503, headers: noStoreJsonHeaders() });
    return NextResponse.json({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }, { headers: noStoreJsonHeaders() });
  }
  const { data: challenge, error: challengeError } = await auth.client.auth.mfa.challenge({ factorId: parsed.data.factorId });
  if (challengeError) return NextResponse.json({ error: "A fresh authenticator challenge could not be created." }, { status: 409, headers: noStoreJsonHeaders() });
  const { error: verifyError } = await auth.client.auth.mfa.verify({ factorId: parsed.data.factorId, challengeId: challenge.id, code: parsed.data.code });
  if (verifyError) return NextResponse.json({ error: "That authenticator code was not accepted." }, { status: 401, headers: noStoreJsonHeaders() });
  return NextResponse.json({ verified: true }, { headers: noStoreJsonHeaders() });
}
