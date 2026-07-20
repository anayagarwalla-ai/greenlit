import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowed } from "@/lib/beta-access";

export async function GET() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to open the agency dashboard." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!betaAccessAllowed(user)) return NextResponse.json({ error: "This email is not on the closed-beta invite list yet." }, { status: 403, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const { data: records, error } = await database.from("transaction_records")
      .select("id, public_id, agency_name, client_name, project_name, milestone_title, amount_minor, currency, target_origin, revision, status, updated_at, created_at")
      .eq("owner_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const ids = (records ?? []).map((record) => record.id);
    const [runResult, reviewResult, notificationResult] = await Promise.all([
      ids.length ? database.from("verification_jobs_v2").select("id, record_id, status, build_label, build_url, last_error, completed_at, created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? database.from("review_packets_v2").select("public_id, record_id, decision, reviewer_name, reviewer_email, decided_at, expires_at, revoked_at, created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      database.from("operator_notifications").select("id, record_id, event_type, title, body, read_at, created_at").eq("owner_user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    const queryError = runResult.error ?? reviewResult.error ?? notificationResult.error;
    if (queryError) throw new Error(queryError.message);
    const runs = runResult.data;
    const reviews = reviewResult.data;
    const notifications = notificationResult.data;
    const latestByRecord = <T extends { record_id: string }>(items: T[] | null) => Object.fromEntries((items ?? []).filter((item, index, all) => all.findIndex((candidate) => candidate.record_id === item.record_id) === index).map((item) => [item.record_id, item]));
    const runMap = latestByRecord(runs as Array<{ record_id: string }> | null);
    const reviewMap = latestByRecord(reviews as Array<{ record_id: string }> | null);
    return NextResponse.json({
      user: { id: user.id, email: user.email },
      records: (records ?? []).map((record) => ({ ...record, latestRun: runMap[record.id] ?? null, latestReview: reviewMap[record.id] ?? null })),
      notifications: notifications ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The agency dashboard is unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

export async function PATCH() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { error } = await database.from("operator_notifications").update({ read_at: new Date().toISOString() }).eq("owner_user_id", user.id).is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
}
