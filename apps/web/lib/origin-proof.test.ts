import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOriginProof, verifyOriginProof } from "./origin-proof";

describe("account-bound origin proofs", () => {
  const original = process.env.RECORD_HASH_SECRET;
  beforeEach(() => { process.env.RECORD_HASH_SECRET = "test-origin-proof-secret-with-enough-entropy"; });
  afterEach(() => { process.env.RECORD_HASH_SECRET = original; });

  it("accepts only the verified origin and user", () => {
    const proof = createOriginProof("https://staging.example.com", "user-1");
    expect(verifyOriginProof(proof, "https://staging.example.com", "user-1")?.origin).toBe("https://staging.example.com");
    expect(verifyOriginProof(proof, "https://other.example.com", "user-1")).toBeNull();
    expect(verifyOriginProof(proof, "https://staging.example.com", "user-2")).toBeNull();
  });

  it("rejects tampering and expired proofs", () => {
    const proof = createOriginProof("https://staging.example.com", "user-1");
    expect(verifyOriginProof(`${proof}x`, "https://staging.example.com", "user-1")).toBeNull();
    expect(verifyOriginProof(createOriginProof("https://staging.example.com", "user-1", 0), "https://staging.example.com", "user-1")).toBeNull();
  });
});
