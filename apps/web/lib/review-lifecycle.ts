type ReviewState = { decision?: "APPROVED" | "CHANGES_REQUESTED" | null; expires_at: string; revoked_at?: string | null } | null | undefined;

export function canCreateReviewLink(recordStatus: string, runStatus: string | null | undefined, review: ReviewState, nowMs = Date.now()) {
  if (runStatus !== "COMPLETED" || recordStatus !== "READY_FOR_REVIEW") return false;
  if (!review) return true;
  if (review.decision === "CHANGES_REQUESTED") return true;
  if (review.decision === "APPROVED") return false;
  return Boolean(review.revoked_at) || new Date(review.expires_at).getTime() <= nowMs;
}
