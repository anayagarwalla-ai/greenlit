import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { deliverPendingNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  let maintenanceRunId: number | null = null;
  try {
    const startedAt = new Date().toISOString();
    const { data: maintenanceRun, error: startError } = await database
      .from("maintenance_runs")
      .insert({ task: "notification-delivery", status: "RUNNING", started_at: startedAt })
      .select("id")
      .single();
    if (startError) throw new Error(`Notification heartbeat could not start: ${startError.message}`);
    maintenanceRunId = Number(maintenanceRun.id);
    const delivery = await deliverPendingNotifications(20);
    const summary = { ...delivery, processedAt: startedAt };
    const { error: completeError } = await database
      .from("maintenance_runs")
      .update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), summary })
      .eq("id", maintenanceRunId);
    if (completeError) throw new Error(`Notification heartbeat could not complete: ${completeError.message}`);
    return NextResponse.json(summary, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (maintenanceRunId !== null) {
      await database
        .from("maintenance_runs")
        .update({
          status: "FAILED",
          completed_at: new Date().toISOString(),
          error: error instanceof Error ? error.message.slice(0, 1_000) : "Notification delivery failed",
        })
        .eq("id", maintenanceRunId);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Notification delivery failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
