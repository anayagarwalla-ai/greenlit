import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverRunnerBuild } from "./runner-discovery";

describe("discoverRunnerBuild", () => {
  afterEach(() => vi.restoreAllMocks());

  it("signs a bounded discovery request and validates the catalog", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      pages: ["/"],
      candidates: [{
        id: "p1-button-1",
        path: "/",
        role: "button",
        name: "Search",
        ref: "button:Search",
        visible: true,
        enabled: true,
        matchCount: 1,
        unique: true,
      }],
      truncated: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await discoverRunnerBuild("https://runner.example/", "runner-secret", {
      origin: "https://staging.example",
      startPath: "/preview/launch",
      intentTerms: ["search", "contact"],
      originReceipt: "signed-receipt",
      userId: "user-1",
    });

    expect(result.candidates[0]?.ref).toBe("button:Search");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://runner.example/v1/discover");
    expect((init?.headers as Record<string, string>)["x-mp-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(String(init?.body))).toMatchObject({ startPath: "/preview/launch", intentTerms: ["search", "contact"] });
  });

  it("fails closed on malformed catalogs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      pages: ["https://attacker.example"],
      candidates: [],
      truncated: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(discoverRunnerBuild("https://runner.example", "runner-secret", {
      origin: "https://staging.example",
      startPath: "/",
      intentTerms: ["search"],
      originReceipt: "signed-receipt",
      userId: "user-1",
    })).rejects.toThrow();
  });

  it("rejects internally inconsistent runner candidates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      pages: ["/"],
      candidates: [{
        id: "p1-button-1",
        path: "/",
        role: "button",
        name: "Search",
        ref: "button:Different name",
        visible: true,
        enabled: true,
        matchCount: 2,
        unique: true,
      }],
      truncated: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(discoverRunnerBuild("https://runner.example", "runner-secret", {
      origin: "https://staging.example",
      startPath: "/",
      intentTerms: ["search"],
      originReceipt: "signed-receipt",
      userId: "user-1",
    })).rejects.toThrow();
  });
});
