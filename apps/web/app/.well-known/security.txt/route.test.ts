import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("security.txt", () => {
  it("publishes only the configured monitored contact and canonical origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SECURITY_EMAIL", "security@example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://proof.example.test");
    const response = GET(new Request("http://localhost:3000/.well-known/security.txt"));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Contact: mailto:security@example.test");
    expect(body).toContain("Canonical: https://proof.example.test/.well-known/security.txt");
    expect(body).not.toContain("anay.agarwalla");
  });

  it("publishes the first-party security report form when no monitored email is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SECURITY_EMAIL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    const response = GET(new Request("https://proof.example.test/.well-known/security.txt"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Contact: https://proof.example.test/privacy-request?type=security");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
  });
});
