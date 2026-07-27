import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

function mutatingRequest(url: string, headers: HeadersInit = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("request proxy security", () => {
  it("accepts the externally visible forwarded origin", () => {
    const response = proxy(mutatingRequest("http://localhost:3008/api/fixture/leads", {
      host: "localhost:3008",
      origin: "http://127.0.0.1:3008",
      "x-forwarded-host": "127.0.0.1:3008",
      "x-forwarded-proto": "http",
    }));
    expect(response.status).toBe(200);
  });

  it("rejects a genuinely different browser origin", async () => {
    const response = proxy(mutatingRequest("https://proof.example.test/api/fixture/leads", {
      host: "proof.example.test",
      origin: "https://attacker.example.test",
      "sec-fetch-site": "cross-site",
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CROSS_SITE_REQUEST" });
  });

  it("does not force HTTPS upgrades in a local HTTP production preview", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("http://localhost:3008/"));
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
  });

  it("keeps HTTPS upgrades for a real secure deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("https://proof.example.test/"));
    expect(response.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });

  it("rejects an oversized declared API body before route handling", async () => {
    const response = proxy(mutatingRequest("https://proof.example.test/api/feedback", {
      host: "proof.example.test",
      origin: "https://proof.example.test",
      "content-length": "2000001",
    }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  });

  it("assigns an opaque request id to accepted and rejected requests", () => {
    const accepted = proxy(new NextRequest("https://proof.example.test/"));
    const rejected = proxy(mutatingRequest("https://proof.example.test/api/feedback", {
      host: "proof.example.test",
      origin: "https://attacker.example.test",
      "sec-fetch-site": "cross-site",
    }));
    expect(accepted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.headers.get("x-request-id")).not.toBe(accepted.headers.get("x-request-id"));
  });
});
