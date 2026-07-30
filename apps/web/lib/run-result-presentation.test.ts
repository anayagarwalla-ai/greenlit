import { describe, expect, it } from "vitest";
import { runResultPresentation, summarizeRunStatuses } from "./run-result-presentation";

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
});
