export function postResponsePassed(
  expectedPostPath: string | undefined,
  observedStatus: number | undefined,
  expectedStatus: number | undefined,
): boolean {
  if (!expectedPostPath) return true;
  if (observedStatus === undefined) return false;
  return expectedStatus === undefined
    ? observedStatus >= 200 && observedStatus <= 399
    : observedStatus === expectedStatus;
}

export function expectedPostResponseLabel(expectedPostPath: string | undefined, expectedStatus: number | undefined): string {
  if (!expectedPostPath) return "";
  return expectedStatus === undefined ? " + HTTP 2xx–3xx" : ` + HTTP ${expectedStatus}`;
}
