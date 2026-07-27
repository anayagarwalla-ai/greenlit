import { requireSupabaseAdmin } from "./database";
import { strongPrivateSecret, validPublicWebhookUrl } from "./launch-readiness";

export type NotificationPayload = {
  id: string;
  owner_user_id: string | null;
  record_id: string | null;
  event_type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function notificationWebhookConfiguration() {
  const target = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
  if (!target) return null;
  if (!validPublicWebhookUrl(target)) throw new Error("Notification delivery URL is invalid.");
  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET?.trim();
  if (!strongPrivateSecret(secret)) throw new Error("Notification delivery authentication is invalid.");
  return { target, secret };
}

export async function deliverNotification(notification: NotificationPayload) {
  const configuration = notificationWebhookConfiguration();
  if (!configuration) return false;
  const database = requireSupabaseAdmin();
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await database.rpc("begin_notification_delivery_atomic", { p_id: notification.id, p_now: startedAt }).maybeSingle();
  if (claimError) throw new Error(`Notification delivery could not be claimed: ${claimError.message}`);
  if (!claimed) return false;
  const claim = claimed as NotificationPayload & { delivery_claim_id: string };
  let sent = false;
  let deliveryError = "";
  let httpStatus: number | null = null;
  try {
    const response = await fetch(configuration.target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `greenlit-notification-${notification.id}`,
        "x-greenlit-notification-id": notification.id,
        authorization: `Bearer ${configuration.secret}`,
      },
      body: JSON.stringify({
        event: notification.event_type === "DEMO_REQUEST_RECEIVED"
          ? "greenlit.demo-request"
          : "greenlit.client-decision",
        deliveryId: notification.id,
        notification,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    httpStatus = response.status;
    sent = response.ok;
    if (!response.ok) deliveryError = `Webhook returned HTTP ${response.status}`;
  } catch (cause) { deliveryError = cause instanceof Error ? cause.message.slice(0, 500) : "Notification delivery failed"; }
  const { data: completed, error: updateError } = await database.rpc("complete_notification_delivery_atomic", { p_id: notification.id, p_claim_id: claim.delivery_claim_id, p_succeeded: sent, p_http_status: httpStatus, p_error: sent ? null : deliveryError || "Webhook delivery failed", p_now: new Date().toISOString() });
  if (updateError || completed !== true) throw new Error(`Notification delivery state could not be recorded: ${updateError?.message ?? "claim no longer active"}`);
  return sent;
}
export async function deliverPendingNotifications(limit = 20) {
  if (!notificationWebhookConfiguration()) return { delivered: 0, attempted: 0, configured: false };
  const database = requireSupabaseAdmin();
  const selection = "id, owner_user_id, record_id, event_type, title, body, payload, created_at";
  const { data: retryable, error } = await database
    .from("operator_notifications")
    .select(selection)
    .in("delivery_status", ["PENDING_EMAIL", "FAILED"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const remaining = Math.max(0, limit - (retryable?.length ?? 0));
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: staleSending, error: staleError } = remaining > 0
    ? await database
      .from("operator_notifications")
      .select(selection)
      .eq("delivery_status", "SENDING")
      .lt("delivery_claimed_at", staleBefore)
      .order("delivery_claimed_at", { ascending: true })
      .limit(remaining)
    : { data: [], error: null };
  if (staleError) throw new Error(staleError.message);
  const data = [...(retryable ?? []), ...(staleSending ?? [])];
  const deliveries = await Promise.all(
    (data as NotificationPayload[]).map((notification) => deliverNotification(notification)),
  );
  return { delivered: deliveries.filter(Boolean).length, attempted: data.length, configured: true };
}
