export type BetaInviteStatus = "INVITED" | "ACTIVE" | "REMOVED";

export function operatorInvitePresentation(status: BetaInviteStatus) {
  if (status === "ACTIVE") {
    return {
      badgeClass: "status-badge--pass",
      action: "remove" as const,
      actionLabel: "Remove and sign out",
    };
  }
  if (status === "INVITED") {
    return {
      badgeClass: "status-badge--neutral",
      action: "activate" as const,
      actionLabel: "Activate",
    };
  }
  return {
    badgeClass: "status-badge--fail",
    action: "activate" as const,
    actionLabel: "Reactivate",
  };
}
