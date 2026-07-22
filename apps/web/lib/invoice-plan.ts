import { z } from "zod";
import { canonicalJson, sha256 } from "./recordkeeping";

export const invoicePlanInputSchema = z.object({
  billingName: z.string().trim().min(2).max(160),
  billingEmail: z.string().trim().email().max(320),
  daysUntilDue: z.coerce.number().int().min(1).max(365).default(14),
  memo: z.string().trim().max(500).default(""),
  autoSend: z.boolean().default(false),
  stripeCustomerId: z.string().regex(/^cus_[A-Za-z0-9]+$/).nullable().optional(),
});

export const frozenInvoicePlanSchema = invoicePlanInputSchema.extend({
  enabled: z.literal(true),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  criteriaRevision: z.number().int().positive(),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type InvoicePlanInput = z.infer<typeof invoicePlanInputSchema>;
export type FrozenInvoicePlan = z.infer<typeof frozenInvoicePlanSchema>;

export function freezeInvoicePlan(input: InvoicePlanInput, record: { amount_minor: number; currency: string; criteria_revision: number }): FrozenInvoicePlan {
  const planWithoutHash = {
    enabled: true as const,
    ...input,
    billingEmail: input.billingEmail.toLowerCase(),
    stripeCustomerId: input.stripeCustomerId ?? null,
    amountMinor: record.amount_minor,
    currency: record.currency.toUpperCase(),
    criteriaRevision: record.criteria_revision,
  };
  return { ...planWithoutHash, planSha256: sha256(canonicalJson(planWithoutHash)) };
}

export function assertFrozenInvoicePlan(plan: unknown): FrozenInvoicePlan {
  const parsed = frozenInvoicePlanSchema.parse(plan);
  const { planSha256, ...withoutHash } = parsed;
  if (sha256(canonicalJson(withoutHash)) !== planSha256) throw new Error("The saved invoice plan failed its integrity check.");
  return parsed;
}
