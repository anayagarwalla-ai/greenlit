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

const PRODUCT_PROPERTY_ALLOWLIST = new Set([
  "mode",
  "reason",
  "checkCount",
  "criteriaCount",
  "status",
  "durationBucket",
  "sourceMode",
  "agencySize",
  "milestoneVolume",
  "nextStep",
  "stagingModel",
]);

export async function logProductEvent(input: {
  eventType: string;
  ownerUserId?: string | null;
  recordId?: string | null;
  properties?: Record<string, unknown>;
}) {
  const database = getSupabaseAdmin();
  if (!database) return;
  const properties = Object.fromEntries(Object.entries(input.properties ?? {}).filter(([key, value]) => PRODUCT_PROPERTY_ALLOWLIST.has(key) && ["string", "number", "boolean"].includes(typeof value)));
  const { error } = await database.from("product_events").insert({ event_type: input.eventType, owner_user_id: input.ownerUserId ?? null, record_id: input.recordId ?? null, properties });
  if (error) console.error("Product event could not be recorded", input.eventType, error.message);
}
