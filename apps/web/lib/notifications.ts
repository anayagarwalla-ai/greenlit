import { requireSupabaseAdmin } from "./database";

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

export async function deliverNotification(notification: NotificationPayload) {
  const target = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!target) return false;
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
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.NOTIFICATION_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.NOTIFICATION_WEBHOOK_SECRET}` } : {}) },
      body: JSON.stringify({ event: "greenlit.client-decision", notification }),
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
  if (!process.env.NOTIFICATION_WEBHOOK_URL) return { delivered: 0, attempted: 0, configured: false };
  const database = requireSupabaseAdmin();
  const { data, error } = await database.from("operator_notifications").select("id, owner_user_id, record_id, event_type, title, body, payload, created_at").in("delivery_status", ["PENDING_EMAIL", "FAILED"]).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  let delivered = 0;
  for (const notification of (data ?? []) as NotificationPayload[]) if (await deliverNotification(notification)) delivered += 1;
  return { delivered, attempted: data?.length ?? 0, configured: true };
}
