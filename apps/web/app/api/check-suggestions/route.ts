import { NextResponse } from "next/server";
import { z } from "zod";
import { isSafeRelativePath } from "@greenlit/contracts";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { discoverRunnerBuild } from "@/lib/runner-discovery";
import { getOperationalControl, operationalPauseResponse } from "@/lib/operational-controls";
import { verifyOriginProof } from "@/lib/origin-proof";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { readLimitedJsonResult } from "@/lib/request-security";
import { validateStagingUrl } from "@/lib/security";
import { getOptionalUser } from "@/lib/supabase-server";
import { mappingIntentTerms, suggestMappings } from "@/lib/mapping-suggestions";

export const runtime = "nodejs";
export const maxDuration = 30;

const criterionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(3).max(160),
  sourceQuote: z.string().min(3).max(1_000),
  supported: z.boolean(),
  checkType: z.enum(["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"]),
  rationale: z.string().min(3).max(500),
  grounded: z.boolean(),
});

const requestSchema = z.object({
  target: z.string().min(1).max(2_000),
  startPath: z.string().max(500).refine(isSafeRelativePath, "Invalid starting path"),
  originReceipt: z.string().min(20).max(4_000),
  criteria: z.array(criterionSchema).min(1).max(8),
});

export async function POST(request: Request) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in before scanning a staging build." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "This account is not on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });

  const limited = await readLimitedJsonResult(request, 48_000);
  if (!limited.ok) return limited.response;
  const parsed = requestSchema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid staging-scan request." }, { status: 422, headers: noStoreJsonHeaders() });

  const target = validateStagingUrl(parsed.data.target);
  if (!target.ok) return NextResponse.json({ error: target.reason }, { status: 422, headers: noStoreJsonHeaders() });
  if (!verifyOriginProof(parsed.data.originReceipt, target.url.origin, user.id)) {
    return NextResponse.json({ error: "The staging-origin verification expired. Verify it again before scanning." }, { status: 409, headers: noStoreJsonHeaders() });
  }

  const quota = await consumeRateLimit(request, "staging-discovery-hour", 12, 3_600, user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const control = await getOperationalControl("RUNS");
  if (control.paused) return operationalPauseResponse(control);

  const runnerUrl = process.env.RUNNER_URL;
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!runnerUrl || !secret) {
    return NextResponse.json({
      error: "Automatic staging discovery is not configured. You can still use the advanced mapping fields.",
      code: "DISCOVERY_NOT_CONFIGURED",
    }, { status: 503, headers: noStoreJsonHeaders() });
  }

  try {
    const catalog = await discoverRunnerBuild(runnerUrl, secret, {
      origin: target.url.origin,
      startPath: parsed.data.startPath,
      intentTerms: mappingIntentTerms(parsed.data.criteria),
      originReceipt: parsed.data.originReceipt,
      userId: user.id,
    });
    const suggestions = suggestMappings(parsed.data.criteria, catalog.candidates, catalog.pages);
    return NextResponse.json({
      suggestions,
      pagesScanned: catalog.pages,
      truncated: catalog.truncated,
      source: "observed-staging-accessibility-tree",
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Staging discovery failed", error instanceof Error ? error.message.slice(0, 240) : "unknown");
    return NextResponse.json({
      error: "Greenlit could not scan this staging build safely. Retry, or open the advanced mapping fields.",
      code: "DISCOVERY_FAILED",
    }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
