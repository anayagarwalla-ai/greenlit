import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

export async function GET() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to open the agency dashboard." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "This email is not on the closed-beta invite list yet." }, { status: 403, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const { data: records, error } = await database.from("transaction_records")
      .select("id, public_id, agency_name, client_name, project_name, milestone_title, amount_minor, currency, target_origin, revision, criteria_revision, status, updated_at, created_at")
      .eq("owner_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const ids = (records ?? []).map((record) => record.id);
    const [runResult, reviewResult, notificationResult, invoiceResult, invoiceJobResult, invoicePlanResult, correctionResult, stripeResult] = await Promise.all([
      ids.length ? database.from("verification_jobs_v2").select("id, record_id, status, build_label, build_url, last_error, completed_at, created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? database.from("review_packets_v2").select("public_id, record_id, decision, reviewer_name, reviewer_email, reviewer_note, decided_at, expires_at, revoked_at, created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      database.from("operator_notifications").select("id, record_id, event_type, title, body, read_at, created_at").eq("owner_user_id", user.id).order("created_at", { ascending: false }).limit(50),
      ids.length ? database.from("record_invoices").select("id,record_id,status,invoice_number,amount_due_minor,amount_paid_minor,currency,billing_email,due_at,hosted_invoice_url,invoice_pdf_url,sent_at,paid_at,last_error,created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? database.from("invoice_jobs").select("id,record_id,status,attempts,last_error,created_at,updated_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? database.from("record_invoice_plans").select("record_id,auto_send,billing_email,days_until_due,plan_sha256,updated_at").in("record_id", ids) : Promise.resolve({ data: [], error: null }),
      ids.length ? database.from("privacy_record_amendments").select("record_id,field_name,corrected_value,reason,created_at").in("record_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      database.from("stripe_connections").select("stripe_account_id,livemode,status,connected_at,last_error").eq("owner_user_id", user.id).maybeSingle(),
    ]);
    const queryError = runResult.error ?? reviewResult.error ?? notificationResult.error ?? invoiceResult.error ?? invoiceJobResult.error ?? invoicePlanResult.error ?? correctionResult.error ?? stripeResult.error;
    if (queryError) throw new Error(queryError.message);
    const runs = runResult.data;
    const reviews = reviewResult.data;
    const notifications = notificationResult.data;
    const latestByRecord = <T extends { record_id: string }>(items: T[] | null) => Object.fromEntries((items ?? []).filter((item, index, all) => all.findIndex((candidate) => candidate.record_id === item.record_id) === index).map((item) => [item.record_id, item]));
    const runMap = latestByRecord(runs as Array<{ record_id: string }> | null);
    const reviewMap = latestByRecord(reviews as Array<{ record_id: string }> | null);
    const invoiceMap = latestByRecord(invoiceResult.data as Array<{ record_id: string }> | null);
    const invoiceJobMap = latestByRecord(invoiceJobResult.data as Array<{ record_id: string }> | null);
    const invoicePlanMap = latestByRecord(invoicePlanResult.data as Array<{ record_id: string }> | null);
    return NextResponse.json({
      user: { id: user.id, email: user.email },
      stripe: { configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_APP_CLIENT_ID && process.env.STRIPE_APP_INSTALL_URL && process.env.STRIPE_TOKEN_ENCRYPTION_KEY && process.env.STRIPE_WEBHOOK_SECRET), connection: stripeResult.data ? { accountId: stripeResult.data.stripe_account_id, livemode: stripeResult.data.livemode, status: stripeResult.data.status, connectedAt: stripeResult.data.connected_at, lastError: stripeResult.data.last_error } : null },
      records: (records ?? []).map((record) => ({ ...record, latestRun: runMap[record.id] ?? null, latestReview: reviewMap[record.id] ?? null, latestInvoice: invoiceMap[record.id] ?? null, latestInvoiceJob: invoiceJobMap[record.id] ?? null, invoicePlan: invoicePlanMap[record.id] ?? null, corrections: (correctionResult.data ?? []).filter((correction) => correction.record_id === record.id) })),
      notifications: notifications ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The agency dashboard is unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

export async function PATCH() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "This account is no longer on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { error } = await database.from("operator_notifications").update({ read_at: new Date().toISOString() }).eq("owner_user_id", user.id).is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
}
