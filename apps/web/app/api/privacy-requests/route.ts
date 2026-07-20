import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, publicRecordId, requestActorHash } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const schema = z.object({
  requestType: z.enum(["ACCESS", "CORRECTION", "DELETION", "EXPORT", "OTHER"]),
  email: z.string().email().max(320),
  details: z.string().max(2_000).optional().default(""),
});

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "privacy-request-day", 5, 86_400);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email and request type." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const requestId = publicRecordId("PRIV");
    const database = requireSupabaseAdmin();
    const { error } = await database.from("privacy_requests_v2").insert({ public_id: requestId, request_type: parsed.data.requestType, email: parsed.data.email, details: parsed.data.details || null, actor_hash: requestActorHash(request) });
    if (error) throw new Error(error.message);
    return NextResponse.json({ requestId, status: "RECEIVED" }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The privacy request could not be recorded." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
