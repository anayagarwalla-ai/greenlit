import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./recordkeeping";

type OriginProof = {
  origin: string;
  userId: string;
  verifiedAt: string;
  expiresAt: string;
};

function secret() {
  const value = process.env.RECORD_HASH_SECRET ?? process.env.RUNNER_HMAC_SECRET;
  if (!value) throw new Error("Origin verification signing is not configured.");
  return value;
}
function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createOriginProof(origin: string, userId: string, ttlMinutes = 30) {
  const verifiedAt = new Date();
  const proof: OriginProof = {
    origin,
    userId,
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: new Date(verifiedAt.getTime() + ttlMinutes * 60_000).toISOString(),
  };
  const payload = Buffer.from(canonicalJson(proof)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyOriginProof(value: string, expectedOrigin: string, userId: string): OriginProof | null {
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const proof = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OriginProof;
    if (proof.origin !== expectedOrigin || proof.userId !== userId || new Date(proof.expiresAt).getTime() <= Date.now()) return null;
    return proof;
  } catch {
    return null;
  }
}
