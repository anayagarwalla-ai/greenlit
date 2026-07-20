import { describe, expect, it } from "vitest";
import { formatDuration, formatTimestamp } from "./format";

describe("record formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1250)).toBe("1.3s");
  });

  it("renders a timezone-explicit timestamp without invalid Intl options", () => {
    const rendered = formatTimestamp(new Date("2026-07-20T16:26:41.000Z"));
    expect(rendered).toMatch(/Jul 20, 2026/);
    expect(rendered).toMatch(/(UTC|GMT|PDT|PST|EDT|EST|CDT|CST|MDT|MST)/);
  });

  it("renders deterministic demo timestamps in Pacific time", () => {
    const rendered = formatTimestamp(new Date("2026-07-20T17:00:00.000Z"), "America/Los_Angeles");
    expect(rendered).toBe("Jul 20, 2026, 10:00 AM PDT");
  });
});
