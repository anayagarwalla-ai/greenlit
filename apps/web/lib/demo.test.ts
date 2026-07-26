import { describe, expect, it } from "vitest";
import { demoCriteria, seededDemoArtifacts, seededDemoResults } from "./demo";

describe("synthetic walkthrough results", () => {
  it("shows the intentional rc1 false-success failure", () => {
    const results = seededDemoResults("rc1", "2026-07-20T12:00:00.000Z");
    expect(results).toHaveLength(demoCriteria.length);
    expect(results.find((result) => result.criterionId === "AC-04")).toMatchObject({
      status: "FAIL",
      observed: "Success text shown, but POST returned 500",
    });
  });

  it("shows a passing rc2 while retaining the synthetic timestamp", () => {
    const timestamp = "2026-07-20T12:00:00.000Z";
    const results = seededDemoResults("rc2", timestamp);
    expect(results.every((result) => result.status === "PASS")).toBe(true);
    expect(results.every((result) => result.timestamp === timestamp)).toBe(true);
  });

  it("attaches clearly synthetic fixture frames without inventing evidence hashes", () => {
    const rc1 = seededDemoArtifacts("rc1");
    const rc2 = seededDemoArtifacts("rc2");
    expect(rc1).toHaveLength(demoCriteria.length);
    expect(rc1.find((item) => item.criterionId === "AC-04")?.url).toContain("false-success");
    expect(rc2.every((item) => item.url === "/demo-evidence/fixture-rc2.png")).toBe(true);
    expect(rc2.every((item) => item.sha256 === "synthetic-walkthrough-no-hash")).toBe(true);
  });

  it("describes the narrow acceptance-criteria relationship audit honestly", () => {
    const accessibility = demoCriteria.find((criterion) => criterion.id === "AC-05");
    expect(accessibility?.check).toContain("aria-describedby");
    expect(accessibility?.result.expected).toBe("All invalid fields are programmatically described");
  });
});
