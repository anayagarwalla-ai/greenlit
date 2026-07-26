import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuthorization } from "@/lib/admin-auth";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { getOperationalControl, type OperationalFeature } from "@/lib/operational-controls";
import { readLimitedJsonResult } from "@/lib/request-security";

const schema = z.object({
  feature: z.enum(["RUNS", "REVIEWS", "INVOICES"]),
  paused: z.boolean(),
  reason: z.string().trim().max(500),
}).superRefine((value, context) => {
  if (value.paused && value.reason.length < 10) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Record a clear pause reason." });
  }
});

async function operator() {
  const auth = await getAdminAuthorization();
  return auth.aal2 ? auth.user : null;
}

export async function GET() {
  const user = await operator();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const features: OperationalFeature[] = ["RUNS", "REVIEWS", "INVOICES"];
  const effective = await Promise.all(features.map((feature) => getOperationalControl(feature)));
  return NextResponse.json({
    controls: effective.map((control) => ({
      feature: control.feature,
      paused: control.paused,
      reason: control.reason,
      updated_by: control.updatedBy ?? null,
      updated_at: control.updatedAt ?? null,
      source: control.source,
      mutable: control.source !== "environment" && control.source !== "unavailable",
    })),
  }, { headers: noStoreJsonHeaders() });
}

export async function PATCH(request: Request) {
  const user = await operator();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a capability and record a clear reason before pausing it." }, { status: 422, headers: noStoreJsonHeaders() });
  const current = await getOperationalControl(parsed.data.feature);
  if (current.source === "environment") {
    return NextResponse.json(
      { error: `This capability is paused by ${current.feature === "RUNS" ? "BETA_PAUSE_RUNS" : current.feature === "REVIEWS" ? "BETA_PAUSE_REVIEWS" : "BETA_PAUSE_INVOICES"}. Change the deployment environment to resume it.` },
      { status: 409, headers: noStoreJsonHeaders() },
    );
  }
  if (current.source === "unavailable") {
    return NextResponse.json({ error: "The effective safety control is unavailable and remains fail-closed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
  const database = requireSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await database.rpc("set_operational_control_atomic", {
    p_feature: parsed.data.feature,
    p_paused: parsed.data.paused,
    p_reason: parsed.data.reason,
    p_operator_email: user.email,
    p_now: now,
  });
  if (error || !data) return NextResponse.json({ error: "The safety control could not be updated." }, { status: 503, headers: noStoreJsonHeaders() });
  const effective = await getOperationalControl(parsed.data.feature);
  return NextResponse.json({
    control: {
      ...(data as Record<string, unknown>),
      paused: effective.paused,
      reason: effective.reason,
      source: effective.source,
      mutable: effective.source !== "environment" && effective.source !== "unavailable",
    },
  }, { headers: noStoreJsonHeaders() });
}
