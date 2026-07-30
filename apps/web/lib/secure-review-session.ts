import { clientRequestMessage, fetchWithTimeout } from "./client-request";

export const SECURE_SESSION_END_FAILURE =
  "The secure session could not be ended. You are still signed in.";

export async function endSecureReviewSession(packetId: string): Promise<void> {
  const response = await fetchWithTimeout(
    `/api/reviews/${encodeURIComponent(packetId)}/session`,
    { method: "DELETE" },
    10_000,
  );
  if (response.ok) return;

  const payload = await response.json().catch(() => ({})) as { error?: string };
  const detail = payload.error?.trim();
  throw new Error(detail ? `${SECURE_SESSION_END_FAILURE} ${detail}` : SECURE_SESSION_END_FAILURE);
}

export function secureSessionEndMessage(cause: unknown): string {
  return clientRequestMessage(cause, SECURE_SESSION_END_FAILURE);
}
