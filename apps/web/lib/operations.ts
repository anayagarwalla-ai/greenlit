import { getSupabaseAdmin } from "./database";

export async function logOperationalEvent(input: {
  severity: "INFO" | "WARN" | "ERROR";
  service: string;
  eventType: string;
  recordId?: string | null;
  details?: Record<string, unknown>;
}) {
  const database = getSupabaseAdmin();
  if (!database) return;
  const { error } = await database.from("operational_events").insert({
    severity: input.severity,
    service: input.service,
    event_type: input.eventType,
    record_id: input.recordId ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("Operational event could not be recorded", input.eventType, error.message);
}
