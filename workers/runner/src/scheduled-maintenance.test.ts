import { describe, expect, it } from "vitest";
import { maintenanceRouteForCron } from "./scheduled-maintenance";

describe("scheduled maintenance routing", () => {
  it.each([
    ["17 4 * * *", "/api/internal/retention"],
    ["7 * * * *", "/api/internal/invoices"],
    ["37 * * * *", "/api/internal/notifications"],
  ])("maps %s to %s", (cron, route) => {
    expect(maintenanceRouteForCron(cron)).toBe(route);
  });

  it("fails closed for an unknown trigger", () => {
    expect(maintenanceRouteForCron("* * * * *")).toBeNull();
  });
});
