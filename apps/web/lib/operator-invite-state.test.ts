import { describe, expect, it } from "vitest";
import { operatorInvitePresentation } from "./operator-invite-state";

describe("operator invite presentation", () => {
  it("renders a reserved INVITED address as pending with an Activate action", () => {
    expect(operatorInvitePresentation("INVITED")).toEqual({
      badgeClass: "status-badge--neutral",
      action: "activate",
      actionLabel: "Activate",
    });
  });

  it("keeps active and removed invite actions distinct", () => {
    expect(operatorInvitePresentation("ACTIVE")).toMatchObject({
      badgeClass: "status-badge--pass",
      action: "remove",
    });
    expect(operatorInvitePresentation("REMOVED")).toMatchObject({
      badgeClass: "status-badge--fail",
      action: "activate",
      actionLabel: "Reactivate",
    });
  });
});
