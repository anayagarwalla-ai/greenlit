import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { noStoreJsonHeaders, publicRecordId, requestActorHash } from "@/lib/recordkeeping";
import { readLimitedJsonResult } from "@/lib/request-security";

const schema = z.object({
  category: z.enum(["BUG", "CONFUSING", "IDEA", "OTHER"]),
  message: z.string().trim().min(10).max(2_000),
  pagePath: z.string().startsWith("/").max(500),
  email: z.string().email().max(320).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const user = await getOptionalUser();
  const quota = await consumeRateLimit(request, "beta-feedback-day", 10, 86_400, user?.id);
  if (!quota.allowed) return rateLimitedResponse(quota);
  const limited = await readLimitedJsonResult(request, 16_384);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a category and include at least 10 characters." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const feedbackId = publicRecordId("FB");
    const { error } = await database.from("beta_feedback").insert({
      public_id: feedbackId,
      owner_user_id: user?.id ?? null,
      email: (user?.email ?? parsed.data.email)?.trim().toLowerCase() || null,
      category: parsed.data.category,
      message: parsed.data.message,
      page_path: parsed.data.pagePath,
      actor_hash: requestActorHash(request),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ feedbackId, received: true }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Feedback persistence failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Feedback could not be recorded right now." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
