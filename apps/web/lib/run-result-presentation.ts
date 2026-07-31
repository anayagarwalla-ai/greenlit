export type RunResultStatus = "PASS" | "FAIL" | "ERROR" | "SKIPPED";

const presentations: Record<RunResultStatus, {
  label: string;
  description: string;
  tone: "pass" | "fail" | "neutral";
}> = {
  PASS: { label: "Passed", description: "The observed result met the frozen check.", tone: "pass" },
  FAIL: { label: "Failed", description: "The check completed and the observed result did not meet the frozen expectation.", tone: "fail" },
  ERROR: { label: "Runner error", description: "The check could not complete, so it did not produce passing evidence.", tone: "fail" },
  SKIPPED: { label: "Not run", description: "The runner skipped this check, so it did not produce passing evidence.", tone: "neutral" },
};

export function runResultPresentation(status: RunResultStatus) {
  return presentations[status];
}

export function summarizeRunStatuses(statuses: RunResultStatus[]) {
  return statuses.reduce((summary, status) => {
    summary[status] += 1;
    return summary;
  }, { PASS: 0, FAIL: 0, ERROR: 0, SKIPPED: 0 } satisfies Record<RunResultStatus, number>);
}

export function verificationScorePercent(passed: number, total: number) {
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((passed / total) * 100)));
}
