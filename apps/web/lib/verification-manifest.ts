import type { CheckSpec } from "@greenlit/contracts";

type FrozenCriterion = {
  id: string;
  sourceQuote: string;
  supported?: boolean;
  checkType?: "element_state" | "link_destination" | "form_submission" | "viewport_layout" | "axe_scan" | "manual";
};

export type VerificationManifestValidation =
  | { ok: true; automatedCriterionIds: string[] }
  | { ok: false; error: string };

export function validateVerificationManifest(criteria: FrozenCriterion[], checks: CheckSpec[]): VerificationManifestValidation {
  const criterionIds = criteria.map((criterion) => criterion.id);
  if (new Set(criterionIds).size !== criterionIds.length) return { ok: false, error: "Every acceptance criterion must have a unique ID." };

  const inconsistentCriterion = criteria.find((criterion) => criterion.supported === true
    ? !criterion.checkType || criterion.checkType === "manual"
    : criterion.supported === false && criterion.checkType !== "manual");
  if (inconsistentCriterion) return { ok: false, error: `${inconsistentCriterion.id} has an inconsistent automated/manual evidence classification.` };

  const automated = criteria.filter((criterion) => criterion.supported === true && criterion.checkType !== "manual");
  const automatedIds = automated.map((criterion) => criterion.id);
  const checkIds = checks.map((check) => check.id);
  const mappedIds = checks.map((check) => check.criterionId);
  if (new Set(checkIds).size !== checkIds.length || new Set(mappedIds).size !== mappedIds.length) {
    return { ok: false, error: "Every automated check and criterion mapping must be unique." };
  }
  if (checks.length !== automated.length || automatedIds.some((id) => !mappedIds.includes(id))) {
    return { ok: false, error: "Every browser-verifiable criterion must have exactly one frozen automated check." };
  }

  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const invalidCheck = checks.find((check) => {
    const criterion = criteriaById.get(check.criterionId);
    return !criterion
      || criterion.supported !== true
      || criterion.checkType !== check.type
      || criterion.sourceQuote !== check.sourceQuote
      || !check.confirmedByHuman;
  });
  if (invalidCheck) return { ok: false, error: `Check ${invalidCheck.id} is not bound to its confirmed automated source criterion.` };
  return { ok: true, automatedCriterionIds: automatedIds };
}
