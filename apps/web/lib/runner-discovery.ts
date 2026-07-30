import { z } from "zod";
import { isSafeRelativePath, parseAccessibleElementRef } from "@greenlit/contracts";
import type { MappingCandidate } from "./mapping-suggestions";
import { signRunnerRequest } from "./hmac";

const safePathSchema = z.string().max(500).refine(isSafeRelativePath, "Discovery paths must stay on the verified origin");

const formFieldSchema = z.object({
  label: z.string().min(1).max(160),
  controlType: z.enum(["text", "email", "tel", "url", "search", "textarea", "select", "checkbox", "radio", "other"]),
  required: z.boolean(),
});

const candidateSchema = z.object({
  id: z.string().min(1).max(80),
  path: safePathSchema,
  role: z.enum(["button", "link", "heading", "region", "img", "textbox", "searchbox", "combobox", "checkbox", "radio", "spinbutton"]),
  name: z.string().min(1).max(145),
  ref: z.string().min(3).max(160).refine((value) => {
    try { parseAccessibleElementRef(value); return true; } catch { return false; }
  }, "Invalid accessible reference"),
  visible: z.literal(true),
  enabled: z.boolean(),
  matchCount: z.number().int().min(0).max(100),
  unique: z.boolean(),
  href: safePathSchema.optional(),
  form: z.object({
    action: safePathSchema.optional(),
    method: z.enum(["get", "post"]),
    fields: z.array(formFieldSchema).max(12),
  }).optional(),
}).superRefine((candidate, context) => {
  let parsedRef: ReturnType<typeof parseAccessibleElementRef> | undefined;
  try { parsedRef = parseAccessibleElementRef(candidate.ref); } catch { /* handled by the field refinement */ }
  if (parsedRef && (parsedRef.role !== candidate.role || parsedRef.name !== candidate.name)) {
    context.addIssue({ code: "custom", path: ["ref"], message: "Accessible reference must match the candidate role and name" });
  }
  if (candidate.unique !== (candidate.matchCount === 1)) {
    context.addIssue({ code: "custom", path: ["unique"], message: "Candidate uniqueness must match its exact match count" });
  }
  if (candidate.href && candidate.role !== "link") {
    context.addIssue({ code: "custom", path: ["href"], message: "Only link candidates may include a destination" });
  }
  if (candidate.form && candidate.role !== "button") {
    context.addIssue({ code: "custom", path: ["form"], message: "Only button candidates may include form metadata" });
  }
});

const catalogSchema = z.object({
  pages: z.array(safePathSchema).min(1).max(6),
  candidates: z.array(candidateSchema).max(120),
  truncated: z.boolean(),
});

export type RunnerDiscoveryCatalog = {
  pages: string[];
  candidates: MappingCandidate[];
  truncated: boolean;
};

export async function discoverRunnerBuild(
  runnerUrl: string,
  secret: string,
  input: { origin: string; startPath: string; intentTerms: string[]; originReceipt: string; userId: string },
): Promise<RunnerDiscoveryCatalog> {
  const body = JSON.stringify(input);
  const signed = await signRunnerRequest(body, secret);
  const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/discover`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mp-timestamp": signed.timestamp,
      "x-mp-signature": signed.signature,
    },
    body,
    signal: AbortSignal.timeout(24_000),
  });
  if (!response.ok) throw new Error(`Discovery returned ${response.status}`);
  return catalogSchema.parse(await response.json()) as RunnerDiscoveryCatalog;
}
