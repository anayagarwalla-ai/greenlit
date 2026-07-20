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
  let sent = false;
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.NOTIFICATION_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.NOTIFICATION_WEBHOOK_SECRET}` } : {}) },
      body: JSON.stringify({ event: "milestoneproof.client-decision", notification }),
      signal: AbortSignal.timeout(5_000),
    });
    sent = response.ok;
  } catch { /* stored outbox is retried by maintenance */ }
  await requireSupabaseAdmin().from("operator_notifications").update({ delivery_status: sent ? "SENT" : "FAILED" }).eq("id", notification.id);
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
