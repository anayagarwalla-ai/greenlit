import { NextResponse } from "next/server";
import { z } from "zod";
import { betaEmailAllowed } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { requireSupabaseAdmin } from "@/lib/database";

const schema = z.object({ email: z.string().trim().email().max(320) });

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "invite-check-hour", 30, 3_600);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email." }, { status: 422, headers: noStoreJsonHeaders() });
  if (!betaEmailAllowed(parsed.data.email)) {
    return NextResponse.json({ error: "This email is not on the closed-beta invite list. Ask the MilestoneProof operator for an invitation before signing in." }, { status: 403, headers: noStoreJsonHeaders() });
  }
  try {
    // The browser is never allowed to create users. Only this server-side,
    // allowlist-gated step can provision the invited identity.
    const { error } = await requireSupabaseAdmin().auth.admin.createUser({ email: parsed.data.email, email_confirm: true });
    if (error && !/already (been )?registered|already exists|email_exists|user_already_exists/i.test(`${error.code ?? ""} ${error.message}`)) throw error;
    return NextResponse.json({ invited: true }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "Agency sign-in is temporarily unavailable. The invitation was not used and no account was created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
