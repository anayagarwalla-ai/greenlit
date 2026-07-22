import { describe, expect, it } from "vitest";
import { isActiveRunStatus, isTerminalRunFailure, terminalRunMessage } from "./run-status";

describe("verification run status", () => {
  it("recognizes only pollable statuses as active", () => {
    expect(["QUEUED", "LEASED", "RUNNING"].every(isActiveRunStatus)).toBe(true);
    expect(["COMPLETED", "FAILED", "EXPIRED"].some(isActiveRunStatus)).toBe(false);
  });

  it("treats failed and expired jobs as recoverable terminal failures", () => {
    expect(isTerminalRunFailure("FAILED")).toBe(true);
    expect(isTerminalRunFailure("EXPIRED")).toBe(true);
    expect(isTerminalRunFailure("RUNNING")).toBe(false);
  });

  it("uses the retained server error and otherwise explains expiry", () => {
    expect(terminalRunMessage("EXPIRED", "Cancelled by operator")).toBe("Cancelled by operator");
    expect(terminalRunMessage("EXPIRED")).toContain("expired safely");
  });
});
