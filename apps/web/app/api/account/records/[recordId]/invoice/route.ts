import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, requestActorHash } from "@/lib/recordkeeping";
import { processInvoiceJob } from "@/lib/stripe-invoicing";
import { getOptionalUser } from "@/lib/supabase-server";

export async function POST(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with an invited account to continue." }, { status: 401, headers: noStoreJsonHeaders() });
  const { recordId } = await context.params;
  const database = requireSupabaseAdmin();
  const { data: record } = await database.from("transaction_records").select("id,status,owner_user_id").eq("id", recordId).maybeSingle();
  if (!record || record.owner_user_id !== user.id) return NextResponse.json({ error: "Milestone not found." }, { status: 404, headers: noStoreJsonHeaders() });
  if (record.status !== "APPROVED") return NextResponse.json({ error: "The client must approve this milestone before an invoice can be sent." }, { status: 409, headers: noStoreJsonHeaders() });
  const { data: packet } = await database.from("review_packets_v2").select("id").eq("record_id", recordId).eq("decision", "APPROVED").order("decided_at", { ascending: false }).limit(1).maybeSingle();
  if (!packet) return NextResponse.json({ error: "The approved review packet could not be found." }, { status: 409, headers: noStoreJsonHeaders() });
  const { data: job, error } = await database.rpc("queue_approved_invoice_job_atomic", { p_packet_id: packet.id, p_owner_user_id: user.id, p_actor_hash: requestActorHash(request) });
  if (error || !job) return NextResponse.json({ error: "The invoice could not be queued. Confirm this milestone is approved and no invoice is already pending." }, { status: 409, headers: noStoreJsonHeaders() });
  try {
    const result = await processInvoiceJob(job.id, user.id);
    return NextResponse.json(result, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "Stripe could not finish the invoice. The failed job is retained for a safe retry.", jobId: job.id }, { status: 502, headers: noStoreJsonHeaders() });
  }
}
