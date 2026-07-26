import { expect, test } from "@playwright/test";

const productionSmoke = process.env.PRODUCTION_SMOKE === "1";
const sha256Pattern = /^[a-f0-9]{64}$/i;

type RetainedRun = {
  id: string;
  status: string;
  checks: Array<{ id?: string; criterionId?: string }>;
  results: Array<{
    criterionId: string;
    status: string;
    expected: string;
    observed: string;
    timestamp: string;
    evidenceHash?: string;
  }>;
  artifacts: Array<{
    criterionId?: string;
    storagePath?: string;
    sha256?: string;
    url?: string | null;
  }>;
  browser_version?: string | null;
  runner_version?: string | null;
  manifest_sha256?: string | null;
  completed_at?: string | null;
};

type RetainedRecordPayload = {
  record: {
    id: string;
    public_id: string;
    owner_user_id: string;
    status: string;
    source_sha256?: string | null;
    confirmed_criteria?: unknown[];
  };
  runs: RetainedRun[];
  reviews: Array<{
    public_id: string;
    decision?: string | null;
    reviewer_name?: string | null;
    reviewer_email?: string | null;
    decided_at?: string | null;
  }>;
};

test("retained production transaction smoke gate", async ({ page, request }) => {
  test.skip(!productionSmoke, "Production retained smoke is opt-in; local test defaults remain synthetic.");

  const expectedEmail = process.env.PRODUCTION_SMOKE_EMAIL!.trim().toLowerCase();
  const sessionResponse = await request.get("/api/account/session");
  expect(sessionResponse, "The saved production session must reach the account-session endpoint.").toBeOK();
  const session = await sessionResponse.json() as {
    user?: { id?: string; email?: string; betaAllowed?: boolean } | null;
  };
  expect(session.user?.email?.toLowerCase(), "The saved session must belong to PRODUCTION_SMOKE_EMAIL.").toBe(expectedEmail);
  expect(session.user?.betaAllowed, "The production smoke account must still be on the beta allowlist.").toBe(true);

  const recordId = process.env.PRODUCTION_SMOKE_RECORD_ID!;
  const retainedResponse = await request.get(`/api/account/records/${encodeURIComponent(recordId)}`);
  expect(retainedResponse, "The supplied record must exist in the saved account.").toBeOK();
  const retained = await retainedResponse.json() as RetainedRecordPayload;
  expect(retained.record.id, "The owner endpoint must return the exact requested record.").toBe(recordId);
  expect(retained.record.owner_user_id, "The retained record must belong to the authenticated smoke account.").toBe(session.user?.id);
  expect(retained.record.public_id, "The retained record needs a stable public identifier.").toBeTruthy();
  expect(["APPROVED", "RECEIPT_READY"], "The retained record must have a final approved state.").toContain(retained.record.status);
  expect(retained.record.source_sha256, "The retained record must bind its canonical source hash.").toMatch(sha256Pattern);
  expect(retained.record.confirmed_criteria?.length, "The retained record must contain confirmed acceptance criteria.").toBeGreaterThan(0);

  const finalReview = retained.reviews[0];
  expect(finalReview, "The retained record must have a final review packet.").toBeTruthy();
  expect(finalReview.decision, "The newest review packet must be approved.").toBe("APPROVED");
  expect(finalReview.reviewer_name, "The final approval must name its reviewer.").toBeTruthy();
  expect(finalReview.reviewer_email, "The final approval must identify its business reviewer.").toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  expect(finalReview.decided_at, "The final approval must have a decision timestamp.").toBeTruthy();

  const receiptResponse = await request.get(`/api/reviews/${encodeURIComponent(finalReview.public_id)}`);
  expect(receiptResponse, "The owner must be able to read the final receipt packet.").toBeOK();
  const receipt = await receiptResponse.json() as {
    packetId: string;
    viewerRole: string;
    snapshot: {
      recordPublicId: string;
      sourceSha256?: string;
      run: {
        runId: string;
        manifestSha256: string;
        results: unknown[];
        artifacts?: unknown[];
      };
    };
    snapshotSha256: string;
    decision: string;
    receiptSha256: string;
    auditHead?: { sequence?: number; eventHash?: string } | null;
  };
  expect(receipt.packetId).toBe(finalReview.public_id);
  expect(receipt.viewerRole, "The saved session must open the receipt as the owner.").toBe("OWNER");
  expect(receipt.decision).toBe("APPROVED");
  expect(receipt.snapshot.recordPublicId).toBe(retained.record.public_id);
  expect(receipt.snapshot.sourceSha256).toBe(retained.record.source_sha256);
  expect(receipt.snapshotSha256).toMatch(sha256Pattern);
  expect(receipt.receiptSha256).toMatch(sha256Pattern);
  expect(receipt.auditHead?.eventHash).toMatch(sha256Pattern);
  expect(receipt.auditHead?.sequence).toBeGreaterThan(0);

  const completedRun = retained.runs.find((run) => run.id === receipt.snapshot.run.runId);
  expect(completedRun, "The approved snapshot must reference a retained run owned by this record.").toBeTruthy();
  expect(completedRun!.status).toBe("COMPLETED");
  expect(completedRun!.checks.length, "The retained run must include the frozen typed checks.").toBeGreaterThan(0);
  expect(completedRun!.results.length, "Every frozen check must have a result.").toBe(completedRun!.checks.length);
  expect(completedRun!.artifacts.length, "Every frozen check must have a retained evidence artifact.").toBe(completedRun!.checks.length);
  expect(completedRun!.results.every((result) => result.status === "PASS"), "Every result in the approved run must pass.").toBe(true);
  expect(completedRun!.results.every((result) => result.criterionId && result.expected && result.observed && result.timestamp), "Every result must retain its criterion, expectation, observation, and timestamp.").toBe(true);
  const evidenceHashes = new Set(completedRun!.results.map((result) => result.evidenceHash));
  const artifactHashes = new Set(completedRun!.artifacts.map((artifact) => artifact.sha256));
  expect([...evidenceHashes].every((hash) => typeof hash === "string" && sha256Pattern.test(hash)), "Every result must bind a SHA-256 evidence hash.").toBe(true);
  expect(artifactHashes, "The result and artifact hash sets must match exactly.").toEqual(evidenceHashes);
  expect(completedRun!.artifacts.every((artifact) => artifact.storagePath && artifact.url?.startsWith("https://")), "Every artifact must still exist in private storage and have a fresh signed URL.").toBe(true);
  expect(completedRun!.browser_version).toBeTruthy();
  expect(completedRun!.runner_version).toBe("0.9.0");
  expect(completedRun!.manifest_sha256).toMatch(sha256Pattern);
  expect(completedRun!.manifest_sha256).toBe(receipt.snapshot.run.manifestSha256);
  expect(completedRun!.completed_at).toBeTruthy();
  expect(receipt.snapshot.run.results.length).toBe(completedRun!.results.length);

  const exportResponse = await request.get(`/api/reviews/${encodeURIComponent(finalReview.public_id)}/export`);
  expect(exportResponse, "The owner must be able to export the final transaction JSON.").toBeOK();
  expect(exportResponse.headers()["content-disposition"]).toContain(`greenlit-${finalReview.public_id}.json`);
  const exported = await exportResponse.json() as {
    format: string;
    packetId: string;
    snapshot: { recordPublicId: string; sourceSha256?: string; run: { runId: string; manifestSha256: string } };
    snapshotSha256: string;
    decision: { value: string; receiptSha256: string };
    auditChain: Array<{ sequence: number; previousHash?: string | null; eventHash: string }>;
  };
  expect(exported.format).toBe("Greenlit transaction export v1");
  expect(exported.packetId).toBe(finalReview.public_id);
  expect(exported.snapshot.recordPublicId).toBe(retained.record.public_id);
  expect(exported.snapshot.sourceSha256).toBe(retained.record.source_sha256);
  expect(exported.snapshot.run.runId).toBe(completedRun!.id);
  expect(exported.snapshot.run.manifestSha256).toBe(completedRun!.manifest_sha256);
  expect(exported.snapshotSha256).toBe(receipt.snapshotSha256);
  expect(exported.decision.value).toBe("APPROVED");
  expect(exported.decision.receiptSha256).toBe(receipt.receiptSha256);
  expect(exported.auditChain.length, "The export must contain the retained audit chain.").toBeGreaterThan(0);
  expect(exported.auditChain.every((event, index) => event.sequence === index + 1 && sha256Pattern.test(event.eventHash)), "The audit chain must be ordered and every event must have a SHA-256 hash.").toBe(true);
  expect(
    exported.auditChain.every((event, index, chain) => event.previousHash === (index === 0 ? "0".repeat(64) : chain[index - 1]?.eventHash)),
    "Every audit event must link to the preceding event hash.",
  ).toBe(true);
  expect(exported.auditChain.some((event) => event.eventHash === receipt.receiptSha256), "The audit chain must contain the approval receipt event.").toBe(true);

  await page.goto(`/workspace?record=${encodeURIComponent(recordId)}`);
  expect(new URL(page.url()).origin).toBe(new URL(process.env.PRODUCTION_SMOKE_BASE_URL!).origin);
  await expect(page.getByText("Retained project restored")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dashboard/ })).toBeVisible();

  await page.goto("/dashboard");
  const recordCard = page.locator(".record-card").filter({ hasText: retained.record.public_id });
  await expect(recordCard, "The retained record must be visible on the owner dashboard.").toBeVisible();
  await expect(recordCard.getByText("Client approved")).toBeVisible();
  await recordCard.getByRole("link", { name: "Open record" }).click();
  await expect(page).toHaveURL(new RegExp(`/receipt/${finalReview.public_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { name: "Milestone approval record" })).toBeVisible();
  await expect(page.getByText(retained.record.public_id, { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export JSON" })).toHaveAttribute("href", `/api/reviews/${finalReview.public_id}/export`);
  await expect(page.getByText(receipt.receiptSha256, { exact: false })).toBeVisible();
});
