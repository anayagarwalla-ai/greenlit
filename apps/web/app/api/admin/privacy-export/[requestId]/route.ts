import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { adminAccessAllowed } from "@/lib/beta-access";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const operator = await getOptionalUser();
  if (!operator || !adminAccessAllowed(operator)) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const { requestId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: privacyRequest, error: requestError } = await database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, assigned_to, identity_verified_at, response_summary, response_sent_at, created_at").eq("id", requestId).single();
    if (requestError || !privacyRequest) return NextResponse.json({ error: "Privacy request not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (!privacyRequest.identity_verified_at) return NextResponse.json({ error: "Verify the requester before exporting account data." }, { status: 409, headers: noStoreJsonHeaders() });
    let ownerId = "";
    for (let page = 1; page <= 5 && !ownerId; page += 1) {
      const { data, error } = await database.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      ownerId = data.users.find((account) => account.email?.toLowerCase() === privacyRequest.email.toLowerCase())?.id ?? "";
      if (data.users.length < 200) break;
    }
    const { data: subjectRows, error: subjectError } = await database.rpc("privacy_subject_record_ids", { p_email: privacyRequest.email });
    if (subjectError) throw new Error(subjectError.message);
    const subjectRecordIds = (subjectRows ?? []).map((row: { record_id: string }) => row.record_id);
    const { data: records, error: recordsError } = subjectRecordIds.length ? await database.from("transaction_records").select("id, public_id, owner_user_id, mode, agency_name, client_name, project_name, milestone_title, amount_minor, currency, source_name, source_sha256, confirmed_criteria, target_origin, revision, criteria_revision, status, retention_until, legal_hold, created_at, updated_at, privacy_deletion_requested_at, deletion_status").in("id", subjectRecordIds).order("created_at") : { data: [], error: null };
    if (recordsError) throw new Error(recordsError.message);
    const recordIds = (records ?? []).map((record) => record.id);
    const [runs, reviews, events, amendments, notifications, feedbackByOwner, feedbackByEmail, relatedPrivacyRequests, consentEvents, invite, holds, productEvents, accountDeletions, stripeConnection, stripeConnectionEvents, invoicePlans, invoiceJobs, invoices] = await Promise.all([
      recordIds.length ? database.from("verification_jobs_v2").select("*").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("review_packets_v2").select("id, record_id, run_id, public_id, snapshot, snapshot_sha256, expires_at, decision, reviewer_name, reviewer_email, reviewer_note, intent_confirmed, legal_terms_accepted, electronic_records_consent, notice_version, country_code, decided_at, receipt_sha256, decision_event_hash, revoked_at, created_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("transaction_audit_events").select("record_id, sequence, event_type, actor_type, actor_hash, payload, previous_hash, event_hash, occurred_at").in("record_id", recordIds).order("occurred_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("privacy_record_amendments").select("id, request_id, record_id, field_name, previous_value, corrected_value, reason, created_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      ownerId ? database.from("operator_notifications").select("id, record_id, event_type, title, body, payload, read_at, delivery_status, created_at").eq("owner_user_id", ownerId).order("created_at") : Promise.resolve({ data: [], error: null }),
      ownerId ? database.from("beta_feedback").select("id, public_id, record_id, email, category, message, page_path, status, created_at").eq("owner_user_id", ownerId).order("created_at") : Promise.resolve({ data: [], error: null }),
      database.from("beta_feedback").select("id, public_id, record_id, email, category, message, page_path, status, created_at").ilike("email", privacyRequest.email).order("created_at"),
      database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, assigned_to, identity_verified_at, response_summary, response_sent_at, created_at, completed_at").ilike("email", privacyRequest.email).order("created_at"),
      ownerId ? database.from("analysis_consent_events").select("id, source_mode, source_byte_size, notice_version, provider_notice_version, accepted_terms, accepted_data_notice, country_code, created_at").eq("owner_user_id", ownerId).order("created_at") : Promise.resolve({ data: [], error: null }),
      database.from("beta_invites").select("id, email, status, adult_sponsor, invited_by, invited_at, last_sign_in_requested_at, removed_at, notes").ilike("email", privacyRequest.email).maybeSingle(),
      recordIds.length ? database.from("legal_holds_v2").select("id, record_id, privacy_request_id, reason, owner_email, review_at, active, created_at, released_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      ownerId ? database.from("product_events").select("id, event_type, record_id, properties, created_at").eq("owner_user_id", ownerId).order("created_at") : Promise.resolve({ data: [], error: null }),
      database.from("privacy_account_deletions").select("id,request_id,email,status,attempts,last_error,requested_at,completed_at").ilike("email", privacyRequest.email).order("requested_at"),
      ownerId ? database.from("stripe_connections").select("stripe_account_id,livemode,status,connected_at,disconnected_at,last_error,updated_at").eq("owner_user_id", ownerId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ownerId ? database.from("stripe_connection_events").select("id,stripe_account_id,event_type,details,occurred_at").eq("owner_user_id", ownerId).order("occurred_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("record_invoice_plans").select("record_id,stripe_customer_id,billing_name,billing_email,days_until_due,memo,auto_send,amount_minor,currency,criteria_revision,plan_sha256,created_at,updated_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("invoice_jobs").select("id,packet_id,record_id,status,attempts,plan,claimed_at,completed_at,last_error,created_at,updated_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
      recordIds.length ? database.from("record_invoices").select("id,packet_id,record_id,stripe_account_id,stripe_customer_id,stripe_invoice_id,invoice_number,status,amount_due_minor,amount_paid_minor,currency,billing_email,due_at,hosted_invoice_url,invoice_pdf_url,sent_at,paid_at,voided_at,last_error,last_stripe_event_id,last_stripe_event_at,created_at,updated_at").in("record_id", recordIds).order("created_at") : Promise.resolve({ data: [], error: null }),
    ]);
    const queryError = runs.error ?? reviews.error ?? events.error ?? amendments.error ?? notifications.error ?? feedbackByOwner.error ?? feedbackByEmail.error ?? relatedPrivacyRequests.error ?? consentEvents.error ?? invite.error ?? holds.error ?? productEvents.error ?? accountDeletions.error ?? stripeConnection.error ?? stripeConnectionEvents.error ?? invoicePlans.error ?? invoiceJobs.error ?? invoices.error;
    if (queryError) throw new Error(queryError.message);
    const exportedAt = new Date().toISOString();
    const feedback = [...(feedbackByOwner.data ?? []), ...(feedbackByEmail.data ?? [])].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
    const payload = { exportVersion: 4, exportedAt, privacyRequest, account: { email: privacyRequest.email, userId: ownerId || null }, invite: invite.data ?? null, accountDeletions: accountDeletions.data ?? [], stripeConnection: stripeConnection.data ?? null, stripeConnectionEvents: stripeConnectionEvents.data ?? [], invoicePlans: invoicePlans.data ?? [], invoiceJobs: invoiceJobs.data ?? [], invoices: invoices.data ?? [], records: records ?? [], verificationJobs: runs.data ?? [], reviewPackets: reviews.data ?? [], auditEvents: events.data ?? [], corrections: amendments.data ?? [], notifications: notifications.data ?? [], feedback, relatedPrivacyRequests: relatedPrivacyRequests.data ?? [], analysisConsents: consentEvents.data ?? [], legalHolds: holds.data ?? [], productEvents: productEvents.data ?? [] };
    const { error: actionError } = await database.rpc("record_operator_action", { p_operator_email: operator.email, p_action_type: "EXPORT_PRIVACY_DATA", p_target_type: "privacy_request", p_target_id: requestId, p_details: { exportedAt, recordCount: recordIds.length } });
    if (actionError) throw new Error(`The export was not released because its operator log failed: ${actionError.message}`);
    return new NextResponse(JSON.stringify(payload, null, 2), { headers: { ...noStoreJsonHeaders(), "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${privacyRequest.public_id}-export.json"` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Privacy export failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
