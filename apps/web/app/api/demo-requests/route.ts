import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { deliverNotification, type NotificationPayload } from "@/lib/notifications";
import { logOperationalEvent, logProductEvent } from "@/lib/operations";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { noStoreJsonHeaders, publicRecordId, requestActorHash } from "@/lib/recordkeeping";
import { readLimitedJsonResult } from "@/lib/request-security";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  agencyName: z.string().trim().min(2).max(160),
  role: z.string().trim().min(2).max(120),
  agencySize: z.enum(["2-10", "11-25", "26-50"]),
  location: z.string().trim().min(2).max(120),
  monthlyMilestoneVolume: z.enum(["1-2", "3-5", "6-10", "11-25", "26+"]),
  approvalDelayDays: z.coerce.number().int().min(0).max(365),
  stagingModel: z.enum(["public-https", "password-protected", "platform-protected", "client-environment", "other"]),
  desiredNextStep: z.enum(["discovery-call", "synthetic-demo", "design-partner"]),
  currentProcess: z.string().trim().min(20).max(2_000),
  consent: z.literal("true"),
  faxNumber: z.string().max(0).optional().default(""),
});

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "demo-request-day", 3, 86_400, null, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const limited = await readLimitedJsonResult(request, 16_384);
  if (!limited.ok) return limited.response;
  try {
    const parsed = requestSchema.safeParse(limited.body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Complete every required field with business information only." },
        { status: 422, headers: noStoreJsonHeaders() },
      );
    }
    const database = requireSupabaseAdmin();
    const requestId = publicRecordId("DR");
    const consentedAt = new Date().toISOString();
    const { data, error } = await database.rpc("create_demo_request_atomic", {
      p_public_id: requestId,
      p_name: parsed.data.name,
      p_email: parsed.data.email.toLowerCase(),
      p_agency_name: parsed.data.agencyName,
      p_role: parsed.data.role,
      p_agency_size: parsed.data.agencySize,
      p_location: parsed.data.location,
      p_monthly_milestone_volume: parsed.data.monthlyMilestoneVolume,
      p_approval_delay_days: parsed.data.approvalDelayDays,
      p_staging_model: parsed.data.stagingModel,
      p_desired_next_step: parsed.data.desiredNextStep,
      p_current_process: parsed.data.currentProcess,
      p_source_path: new URL(request.url).pathname,
      p_actor_hash: requestActorHash(request),
      p_privacy_notice_version: RECORD_NOTICE_VERSION,
      p_contact_consent: true,
      p_adult_business_use_attested: true,
      p_consented_at: consentedAt,
      p_notification_delivery_status: process.env.NOTIFICATION_WEBHOOK_URL ? "PENDING_EMAIL" : "IN_APP",
    });
    if (error || !data) throw new Error(error?.message ?? "Demo request creation returned no result.");
    const created = data as { requestId?: string; notificationId?: string };
    if (created.requestId !== requestId) throw new Error("Demo request creation returned an invalid reference.");

    if (created.notificationId && process.env.NOTIFICATION_WEBHOOK_URL) {
      const notificationId = created.notificationId;
      after(async () => {
        const { data: notification, error: notificationError } = await database.from("operator_notifications")
          .select("id,owner_user_id,record_id,event_type,title,body,payload,created_at")
          .eq("id", notificationId)
          .maybeSingle();
        if (notificationError || !notification) {
          await logOperationalEvent({
            severity: "ERROR",
            service: "demo-intake",
            eventType: "DEMO_REQUEST_NOTIFICATION_LOOKUP_FAILED",
            details: { requestId, notificationId },
          });
          return;
        }
        try {
          await deliverNotification(notification as NotificationPayload);
        } catch (cause) {
          await logOperationalEvent({
            severity: "ERROR",
            service: "demo-intake",
            eventType: "DEMO_REQUEST_NOTIFICATION_DELIVERY_STATE_FAILED",
            details: {
              requestId,
              notificationId,
              error: cause instanceof Error ? cause.message.slice(0, 300) : "unknown",
            },
          });
        }
      });
    }
    await logProductEvent({
      eventType: "DEMO_REQUEST_RECEIVED",
      properties: {
        agencySize: parsed.data.agencySize,
        milestoneVolume: parsed.data.monthlyMilestoneVolume,
        nextStep: parsed.data.desiredNextStep,
        stagingModel: parsed.data.stagingModel,
      },
    });
    return NextResponse.json({ requestId, received: true }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Demo request persistence failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: "Your request could not be recorded right now. No beta access was created; retry shortly." },
      { status: 503, headers: noStoreJsonHeaders() },
    );
  }
}
