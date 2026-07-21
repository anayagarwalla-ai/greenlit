const PRIVATE_WORKSPACE_KEYS = new Set([
  "sourceText",
  "selectedFile",
  "selectedFileMeta",
  "reviewUrl",
  "originReceipt",
  "bearerToken",
  "ownerToken",
  "sessionToken",
]);

/**
 * Keep cross-device workflow state without persisting the source document or
 * short-lived credentials. Exact criterion quotations remain in `criteria`
 * because they are part of the frozen business record.
 */
export function sanitizeWorkspaceState(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value, (key, nestedValue) => PRIVATE_WORKSPACE_KEYS.has(key) ? undefined : nestedValue);
  const sanitized = JSON.parse(serialized) as Record<string, unknown>;
  return { ...sanitized, sourcePersisted: false };
}
