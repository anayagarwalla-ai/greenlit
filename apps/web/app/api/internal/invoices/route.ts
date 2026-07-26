import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { processInvoiceJob } from "@/lib/stripe-invoicing";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Invoice recovery is not configured." }, { status: 503, headers: noStoreJsonHeaders() });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });

  const database = requireSupabaseAdmin();
  let maintenanceRunId: number | null = null;
  try {
    const now = new Date().toISOString();
    const { data: maintenanceRun, error: startError } = await database
      .from("maintenance_runs")
      .insert({ task: "invoice-recovery", status: "RUNNING", started_at: now })
      .select("id")
      .single();
    if (startError) throw new Error(`Invoice-recovery heartbeat could not start: ${startError.message}`);
    maintenanceRunId = Number(maintenanceRun.id);

    const staleBefore = new Date(Date.now() - 12 * 60_000).toISOString();
    const { data: strandedJobs, error: strandedError } = await database
      .from("invoice_jobs")
      .select("id")
      .eq("status", "PROCESSING")
      .lt("claimed_at", staleBefore)
      .limit(10);
    if (strandedError) throw new Error(strandedError.message);
    for (const job of strandedJobs ?? []) {
      const { error } = await database.rpc("fail_invoice_job_atomic", {
        p_job_id: job.id,
        p_error: "Invoice processing exceeded the recovery window.",
        p_failed_at: now,
      });
      if (error) throw new Error(error.message);
    }

    const { data: pendingJob, error: pendingError } = await database
      .from("invoice_jobs")
      .select("id,owner_user_id")
      .eq("status", "PENDING")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (pendingError) throw new Error(pendingError.message);

    let recoveredInvoices = 0;
    if (pendingJob) {
      try {
        const result = await processInvoiceJob(pendingJob.id, pendingJob.owner_user_id);
        if (result.status === "COMPLETED") recoveredInvoices = 1;
      } catch {
        // processInvoiceJob records the durable failure and audit event.
      }
    }

    const summary = {
      strandedInvoiceJobs: strandedJobs?.length ?? 0,
      recoveredInvoices,
      processedAt: now,
    };
    const { error: completeError } = await database
      .from("maintenance_runs")
      .update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), summary })
      .eq("id", maintenanceRunId);
    if (completeError) throw new Error(`Invoice-recovery heartbeat could not complete: ${completeError.message}`);
    return NextResponse.json({ ok: true, ...summary }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (maintenanceRunId !== null) {
      await database
        .from("maintenance_runs")
        .update({
          status: "FAILED",
          completed_at: new Date().toISOString(),
          error: error instanceof Error ? error.message.slice(0, 1_000) : "Invoice recovery failed",
        })
        .eq("id", maintenanceRunId);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invoice recovery failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
