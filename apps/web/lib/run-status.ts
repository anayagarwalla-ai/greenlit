const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "LEASED", "RUNNING"]);
const TERMINAL_FAILURE_STATUSES = new Set(["FAILED", "EXPIRED"]);

export function isActiveRunStatus(status: string | null | undefined) {
  return Boolean(status && ACTIVE_RUN_STATUSES.has(status));
}

export function isTerminalRunFailure(status: string | null | undefined) {
  return Boolean(status && TERMINAL_FAILURE_STATUSES.has(status));
}

export function terminalRunMessage(status: string, serverMessage?: string | null) {
  if (serverMessage?.trim()) return serverMessage.trim();
  return status === "EXPIRED"
    ? "This verification run expired safely before it completed. Review the setup and start a new run."
    : "The retained verification job failed. Review the setup and try again.";
}
