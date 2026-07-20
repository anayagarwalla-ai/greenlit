import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { adminAccessAllowed } from "@/lib/beta-access";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

async function authorize() {
  const user = await getOptionalUser();
  return user && adminAccessAllowed(user) ? user : null;
}

export async function GET() {
  const user = await authorize();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [feedback, events, jobs, privacy, notifications, recentRuns] = await Promise.all([
      database.from("beta_feedback").select("id, public_id, email, category, message, page_path, status, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("operational_events").select("id, severity, service, event_type, record_id, details, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, record_id, status, build_label, target_origin, last_error, created_at, completed_at").in("status", ["QUEUED", "RUNNING", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, created_at").neq("status", "COMPLETED").order("created_at", { ascending: false }).limit(100),
      database.from("operator_notifications").select("id, event_type, title, delivery_status, created_at").in("delivery_status", ["PENDING_EMAIL", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, status, created_at").gte("created_at", since),
    ]);
    const firstError = [feedback, events, jobs, privacy, notifications, recentRuns].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    const staleBefore = Date.now() - 10 * 60_000;
    const jobIssues = (jobs.data ?? []).filter((job) => job.status === "FAILED" || new Date(job.created_at).getTime() < staleBefore);
    return NextResponse.json({
      operator: user.email,
      summary: {
        newFeedback: (feedback.data ?? []).filter((item) => item.status === "NEW").length,
        activeJobIssues: jobIssues.length,
        openPrivacyRequests: (privacy.data ?? []).length,
        runsLast24Hours: (recentRuns.data ?? []).length,
      },
      feedback: feedback.data ?? [], events: events.data ?? [], jobs: jobIssues, privacy: privacy.data ?? [], notifications: notifications.data ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operator overview unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

const patchSchema = z.object({ feedbackId: z.string().uuid(), status: z.enum(["NEW", "REVIEWING", "RESOLVED", "CLOSED"]) });

export async function PATCH(request: Request) {
  if (!await authorize()) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback update." }, { status: 422, headers: noStoreJsonHeaders() });
  const { error } = await requireSupabaseAdmin().from("beta_feedback").update({ status: parsed.data.status }).eq("id", parsed.data.feedbackId);
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
}
