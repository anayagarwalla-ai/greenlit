import { z } from "zod";

export const supportedAccessibleRoles = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
] as const;

export type SupportedAccessibleRole = (typeof supportedAccessibleRoles)[number];
export type AccessibleElementReference = {
  role: SupportedAccessibleRole;
  name: string;
};

const supportedAccessibleRoleSet = new Set<string>(supportedAccessibleRoles);

export function parseAccessibleElementRef(value: string): AccessibleElementReference {
  const normalized = value.trim();
  const separator = normalized.indexOf(":");
  if (separator < 1) throw new Error("Element reference must use role:accessible name.");

  const role = normalized.slice(0, separator);
  if (!supportedAccessibleRoleSet.has(role)) {
    throw new Error(`Unsupported accessible role "${role}".`);
  }

  const name = normalized.slice(separator + 1).trim();
  if (!name) throw new Error("Element reference must include a non-empty accessible name.");

  return { role: role as SupportedAccessibleRole, name };
}

export const accessibleElementRefSchema = z.string().trim().max(160).superRefine((value, context) => {
  try {
    parseAccessibleElementRef(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid accessible element reference.",
    });
  }
});

export const viewportSchema = z.object({
  width: z.number().int().min(320).max(1280),
  height: z.number().int().min(480).max(900),
  label: z.string().min(1).max(32),
});

const safeRelativePathSchema = z.string().trim().max(500).refine(isSafeRelativePath, "Path must remain on the verified origin");

const baseCheck = z.object({
  id: z.string().trim().min(1).max(80),
  criterionId: z.string().trim().min(1).max(80),
  path: safeRelativePathSchema,
  sourceQuote: z.string().trim().min(3).max(1000),
  confirmedByHuman: z.literal(true),
});

export const elementStateCheckSchema = baseCheck.extend({
  type: z.literal("element_state"),
  elementRef: accessibleElementRefSchema,
  assertion: z.enum(["visible", "enabled", "count"]),
  expectedCount: z.number().int().min(0).max(100).optional(),
  viewport: viewportSchema.optional(),
});

export const linkDestinationCheckSchema = baseCheck.extend({
  type: z.literal("link_destination"),
  elementRef: accessibleElementRefSchema,
  expectedPath: safeRelativePathSchema,
});

export const formSubmissionCheckSchema = baseCheck.extend({
  type: z.literal("form_submission"),
  fields: z.array(z.object({ label: z.string().trim().min(1).max(160), value: z.string().max(500) })).min(1).max(20),
  submitRef: accessibleElementRefSchema,
  successText: z.string().trim().min(1).max(200).optional(),
  successPath: safeRelativePathSchema.optional(),
  expectedPostPath: safeRelativePathSchema.optional(),
  expectedStatus: z.number().int().min(200).max(399).optional(),
  ownerAcknowledgedMutation: z.literal(true),
});

export const viewportLayoutCheckSchema = baseCheck.extend({
  type: z.literal("viewport_layout"),
  viewports: z.array(viewportSchema).min(1).max(2),
  maxHorizontalOverflowPx: z.number().min(0).max(20).default(1),
});

export const axeScanCheckSchema = baseCheck.extend({
  type: z.literal("axe_scan"),
  tags: z.array(z.enum(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])).min(1).max(6).default(["wcag2a", "wcag2aa", "wcag22aa"]),
  failImpacts: z.array(z.enum(["critical", "serious"])).default(["critical", "serious"]),
  submitRef: accessibleElementRefSchema.optional(),
  ownerAcknowledgedMutation: z.literal(true).optional(),
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
    const parsed = new URL(value, "https://greenlit.invalid");
    return parsed.origin === "https://greenlit.invalid" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
