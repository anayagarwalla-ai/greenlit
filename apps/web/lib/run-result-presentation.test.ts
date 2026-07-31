import { describe, expect, it } from "vitest";
import { runResultPresentation, summarizeRunStatuses, verificationScorePercent } from "./run-result-presentation";

describe("run result presentation", () => {
  it("does not describe runner errors or skipped checks as assertion failures", () => {
    expect(runResultPresentation("FAIL").label).toBe("Failed");
    expect(runResultPresentation("ERROR").label).toBe("Runner error");
    expect(runResultPresentation("SKIPPED").label).toBe("Not run");
  });

  it("keeps operational outcomes separate in a run summary", () => {
    expect(summarizeRunStatuses(["PASS", "FAIL", "ERROR", "SKIPPED", "PASS"])).toEqual({
      PASS: 2,
      FAIL: 1,
      ERROR: 1,
      SKIPPED: 1,
    });
  });

  it("keeps the score ring percentage finite and bounded", () => {
    expect(verificationScorePercent(0, 0)).toBe(0);
    expect(verificationScorePercent(5, 6)).toBe(83);
    expect(verificationScorePercent(6, 6)).toBe(100);
    expect(verificationScorePercent(9, 6)).toBe(100);
  });
});
