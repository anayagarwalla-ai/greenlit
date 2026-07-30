export type CriterionRevisionValue = {
  id: string;
  title: string;
  sourceQuote: string;
  supported?: boolean;
  checkType?: string;
};

/**
 * Mirrors the criterion fields included in the server-side revision hash.
 * Ordering is intentional: reordering the frozen scope is a revision too.
 */
export function sameConfirmedCriteriaRevision(
  draft: CriterionRevisionValue[],
  frozen: CriterionRevisionValue[],
) {
  if (draft.length !== frozen.length) return false;
  return draft.every((criterion, index) => {
    const retained = frozen[index];
    return retained !== undefined
      && criterion.id === retained.id
      && criterion.title === retained.title
      && criterion.sourceQuote === retained.sourceQuote
      && criterion.supported === retained.supported
      && criterion.checkType === retained.checkType;
  });
}
