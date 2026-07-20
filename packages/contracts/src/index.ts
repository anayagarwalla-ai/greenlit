import { z } from "zod";

export const viewportSchema = z.object({
  width: z.number().int().min(320).max(2560),
  height: z.number().int().min(480).max(1800),
  label: z.string().min(1).max(32),
});

const baseCheck = z.object({
  id: z.string().min(1),
  criterionId: z.string().min(1),
  path: z.string().startsWith("/").max(500),
  sourceQuote: z.string().min(3).max(1000),
  confirmedByHuman: z.literal(true),
});

export const elementStateCheckSchema = baseCheck.extend({
  type: z.literal("element_state"),
  elementRef: z.string().min(1).max(160),
  assertion: z.enum(["visible", "enabled", "count"]),
  expectedCount: z.number().int().min(0).max(100).optional(),
  viewport: viewportSchema.optional(),
});

export const linkDestinationCheckSchema = baseCheck.extend({
  type: z.literal("link_destination"),
  elementRef: z.string().min(1).max(160),
  expectedPath: z.string().startsWith("/").max(500),
});

export const formSubmissionCheckSchema = baseCheck.extend({
  type: z.literal("form_submission"),
  fields: z.array(z.object({ label: z.string().min(1), value: z.string().max(500) })).min(1).max(20),
  submitRef: z.string().min(1).max(160),
  successText: z.string().min(1).max(200).optional(),
  successPath: z.string().startsWith("/").max(500).optional(),
  expectedPostPath: z.string().startsWith("/").max(500).optional(),
  expectedStatus: z.number().int().min(200).max(399).optional(),
  ownerAcknowledgedMutation: z.literal(true),
});

export const viewportLayoutCheckSchema = baseCheck.extend({
  type: z.literal("viewport_layout"),
  viewports: z.array(viewportSchema).min(1).max(4),
  maxHorizontalOverflowPx: z.number().min(0).max(20).default(1),
});

export const axeScanCheckSchema = baseCheck.extend({
  type: z.literal("axe_scan"),
  tags: z.array(z.string()).default(["wcag2a", "wcag2aa", "wcag22aa"]),
  failImpacts: z.array(z.enum(["critical", "serious"])).default(["critical", "serious"]),
});

export const checkSpecSchema = z.discriminatedUnion("type", [
  elementStateCheckSchema,
  linkDestinationCheckSchema,
  formSubmissionCheckSchema,
  viewportLayoutCheckSchema,
  axeScanCheckSchema,
]);

export type CheckSpec = z.infer<typeof checkSpecSchema>;
export type CheckType = CheckSpec["type"];

export const resultStatusSchema = z.enum(["PASS", "FAIL", "ERROR", "SKIPPED"]);
export type ResultStatus = z.infer<typeof resultStatusSchema>;

export const criterionResultSchema = z.object({
  criterionId: z.string(),
  status: resultStatusSchema,
  expected: z.string(),
  observed: z.string(),
  durationMs: z.number().nonnegative(),
  timestamp: z.string().datetime(),
  evidenceId: z.string().optional(),
  evidenceHash: z.string().optional(),
});
export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const milestoneStatusSchema = z.enum([
  "DRAFT",
  "ANALYZING",
  "NEEDS_CONFIRMATION",
  "READY",
  "VERIFYING",
  "NEEDS_WORK",
  "READY_FOR_REVIEW",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "RECEIPT_READY",
]);
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

export function isSafeRelativePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const parsed = new URL(value, "https://milestoneproof.invalid");
    return parsed.origin === "https://milestoneproof.invalid" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

