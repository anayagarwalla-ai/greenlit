import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuthorization } from "@/lib/admin-auth";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { readLimitedJsonResult } from "@/lib/request-security";

const schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["NEW", "QUALIFYING", "BOOKED", "CLOSED", "DECLINED"]),
  assignedTo: z.string().trim().max(160),
  internalNotes: z.string().trim().max(4_000),
});

const statusSchema = z.enum(["ALL", "NEW", "QUALIFYING", "BOOKED", "CLOSED", "DECLINED"]);
const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

type DemoRequestRow = {
  id: string;
  created_at: string;
};

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(decoded);
    return parsed.success
      ? { createdAt: new Date(parsed.data.createdAt).toISOString(), id: parsed.data.id }
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(row: DemoRequestRow) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}

async function operator() {
  const auth = await getAdminAuthorization();
  return auth.aal2 ? auth.user : null;
}

export async function GET(request: Request) {
  const user = await operator();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const url = new URL(request.url);
  const parsedStatus = statusSchema.safeParse((url.searchParams.get("status") ?? "ALL").toUpperCase());
  const parsedLimit = z.coerce.number().int().min(1).max(100).safeParse(url.searchParams.get("limit") ?? "50");
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (!parsedStatus.success || !parsedLimit.success || cursor === undefined) {
    return NextResponse.json({ error: "The demo-request page filter is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  }
  const database = requireSupabaseAdmin();
  let query = database.from("demo_requests")
    .select("id,public_id,name,email,agency_name,role,agency_size,location,monthly_milestone_volume,approval_delay_days,staging_model,desired_next_step,current_process,status,assigned_to,internal_notes,privacy_notice_version,contact_consent,adult_business_use_attested,consented_at,retention_until,created_at,updated_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsedLimit.data + 1);
  if (parsedStatus.data !== "ALL") query = query.eq("status", parsedStatus.data);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Demo requests are unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  const rows = (data ?? []) as Array<DemoRequestRow & Record<string, unknown>>;
  const hasMore = rows.length > parsedLimit.data;
  const requests = rows.slice(0, parsedLimit.data);
  const lastRequest = requests.at(-1);
  return NextResponse.json({
    requests,
    nextCursor: hasMore && lastRequest ? encodeCursor(lastRequest) : null,
    status: parsedStatus.data,
  }, { headers: noStoreJsonHeaders() });
}

export async function PATCH(request: Request) {
  const user = await operator();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "The demo-request update is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { data, error } = await database.rpc("update_demo_request_atomic", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_assigned_to: parsed.data.assignedTo,
    p_internal_notes: parsed.data.internalNotes,
    p_operator_email: user.email,
    p_now: new Date().toISOString(),
  });
  if (error || !data) return NextResponse.json({ error: "The demo request could not be updated." }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ request: data, operator: user.email }, { headers: noStoreJsonHeaders() });
}
