import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRunnerRequest: vi.fn(),
  requireSupabaseAdmin: vi.fn(),
  jobSingle: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  rpc: vi.fn(),
  sha256: vi.fn(),
}));

vi.mock("@/lib/hmac", () => ({ verifyRunnerRequest: mocks.verifyRunnerRequest }));
vi.mock("@/lib/database", () => ({ requireSupabaseAdmin: mocks.requireSupabaseAdmin }));
vi.mock("@/lib/recordkeeping", () => ({
  EVIDENCE_RETENTION_DAYS: 90,
  noStoreJsonHeaders: () => ({ "Cache-Control": "no-store" }),
  sha256: mocks.sha256,
}));
vi.mock("@/lib/request-security", () => {
  class RequestSizeError extends Error {
    maxBytes = 1_300_000;
  }
  return {
    RequestSizeError,
    readLimitedBody: (request: Request) => request.text(),
    requestTooLargeResponse: () => Response.json({ error: "Request too large" }, { status: 413 }),
  };
});

import { POST } from "./route";

const jobId = "1c42f33d-2b36-47f9-b919-52826f34f3ca";
const recordId = "f5c783be-75b0-45fd-aa7e-c5d11bc08788";
const leaseId = "d69956a0-70b6-4acd-9898-1b398fe38d8d";
const criterionId = "AC-01";
const artifactHash = "a".repeat(64);
const artifactBytes = Buffer.from("immutable evidence");
const canonicalExpiry = "2026-10-24T14:00:00.000Z";

const artifactPayload = {
  leaseId,
  criterionId,
  kind: "SCREENSHOT",
  mimeType: "image/jpeg",
  base64: artifactBytes.toString("base64"),
  sha256: artifactHash,
} as const;

const storagePath = `${recordId}/${jobId}/${criterionId}-${leaseId}-screenshot-${artifactHash}.jpg`;

function request(body: unknown = artifactPayload) {
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://greenlit.example/api/internal/jobs/${jobId}/artifacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: serialized,
  });
}

function jobQuery(result: () => Promise<unknown>) {
  return {
    select: () => ({
      eq: () => ({
        single: result,
      }),
    }),
  };
}

function referencedObjectQuery(result: () => Promise<unknown>) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: result,
        }),
      }),
    }),
  };
}

function duplicateMetadataQuery(result: () => Promise<unknown>) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            single: result,
          }),
        }),
      }),
    }),
  };
}

describe("runner evidence-artifact route", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.verifyRunnerRequest.mockResolvedValue(true);
    mocks.sha256.mockReturnValue(artifactHash);
    mocks.jobSingle.mockResolvedValue({
      data: {
        id: jobId,
        record_id: recordId,
        status: "RUNNING",
        checks: [{ criterionId }],
        lease_id: leaseId,
      },
      error: null,
    });
    mocks.upload.mockResolvedValue({ data: { path: storagePath }, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: "RECORDED", error: null });
    mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "verification_jobs_v2") return jobQuery(mocks.jobSingle);
        throw new Error(`Unexpected table query: ${table}`);
      },
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });
    vi.stubEnv("RUNNER_HMAC_SECRET", "test-runner-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 422 for malformed JSON without touching the database or storage", async () => {
    const response = await POST(request("{"), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(422);
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects empty evidence before it can freeze an unusable artifact slot", async () => {
    const response = await POST(
      request({ ...artifactPayload, base64: "" }),
      { params: Promise.resolve({ jobId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uploads to an immutable content-addressed path with upsert disabled", async () => {
    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledOnce();
    const [path, bytes, options] = mocks.upload.mock.calls[0]!;
    expect(path).toBe(storagePath);
    expect(Buffer.from(bytes).equals(artifactBytes)).toBe(true);
    expect(options).toEqual({
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "0",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_evidence_artifact_atomic",
      expect.objectContaining({
        p_job_id: jobId,
        p_lease_id: leaseId,
        p_criterion_id: criterionId,
        p_storage_path: storagePath,
        p_byte_size: artifactBytes.byteLength,
        p_sha256: artifactHash,
      }),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      duplicate: false,
      artifact: { storagePath, sha256: artifactHash },
    });
  });

  it("returns the canonical stored metadata for an idempotent duplicate without deleting it", async () => {
    mocks.upload.mockResolvedValue({
      data: null,
      error: { statusCode: "409", message: "The resource already exists" },
    });
    mocks.rpc.mockResolvedValue({ data: "DUPLICATE", error: null });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "verification_jobs_v2") return jobQuery(mocks.jobSingle);
        if (table === "evidence_artifacts_v2") {
          return duplicateMetadataQuery(() => Promise.resolve({
            data: { expires_at: canonicalExpiry },
            error: null,
          }));
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      duplicate: true,
      artifact: { storagePath, expiresAt: canonicalExpiry },
    });
  });

  it.each([
    ["COMPLETED", leaseId, "completed"],
    ["RUNNING", "9105192b-4060-4c22-8fec-58a820364e7a", "stale lease"],
  ])("rejects a %s job or %s before uploading", async (status, currentLeaseId) => {
    mocks.jobSingle.mockResolvedValue({
      data: {
        id: jobId,
        record_id: recordId,
        status,
        checks: [{ criterionId }],
        lease_id: currentLeaseId,
      },
      error: null,
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes its unowned new object when completion wins after the upload", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Evidence belongs to an inactive or stale verification lease",
        details: "STALE_EVIDENCE_LEASE",
      },
    });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "verification_jobs_v2") return jobQuery(mocks.jobSingle);
        if (table === "evidence_artifacts_v2") {
          return referencedObjectQuery(() => Promise.resolve({ data: null, error: null }));
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([storagePath]);
    await expect(response.json()).resolves.toMatchObject({ code: "STALE_EVIDENCE_LEASE" });
  });

  it("never deletes a pre-existing duplicate object after stale-lease rejection", async () => {
    mocks.upload.mockResolvedValue({
      data: null,
      error: { statusCode: 409, message: "The resource already exists" },
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Evidence belongs to an inactive or stale verification lease",
        details: "STALE_EVIDENCE_LEASE",
      },
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not delete a new object that another request already adopted", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Evidence belongs to an inactive or stale verification lease",
        details: "STALE_EVIDENCE_LEASE",
      },
    });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "verification_jobs_v2") return jobQuery(mocks.jobSingle);
        if (table === "evidence_artifacts_v2") {
          return referencedObjectQuery(() => Promise.resolve({
            data: { id: "81811ba5-4a1f-4517-a411-84b7a948f368" },
            error: null,
          }));
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
      storage: { from: mocks.storageFrom },
      rpc: mocks.rpc,
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the object on an ambiguous RPC failure because commit status is unknown", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "database transport unavailable", details: null },
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
