import { describe, expect, it } from "vitest";
import {
  readLimitedBody,
  readLimitedFormData,
  readLimitedJsonResult,
  RequestSizeError,
} from "./request-security";

function streamedRequest(chunks: string[], headers?: HeadersInit) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Request("https://greenlit.test/api/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded request bodies", () => {
  it("rejects an oversized declared content length before reading", async () => {
    const request = streamedRequest(["{}"], { "content-length": "33" });
    await expect(readLimitedBody(request, 32)).rejects.toEqual(expect.objectContaining<Partial<RequestSizeError>>({ maxBytes: 32 }));
  });

  it("rejects chunked bodies that grow past the limit without a content-length header", async () => {
    const request = streamedRequest(["1234", "5678", "9"]);
    await expect(readLimitedBody(request, 8)).rejects.toEqual(expect.objectContaining<Partial<RequestSizeError>>({ maxBytes: 8 }));
  });

  it("returns a stable 413 JSON response for oversized JSON", async () => {
    const result = await readLimitedJsonResult(streamedRequest(['{"message":"', "too long", '"}']), 16);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toMatchObject({ code: "REQUEST_TOO_LARGE" });
  });

  it("parses multipart fields only after the complete request stays within the limit", async () => {
    const form = new FormData();
    form.set("sourceDataAttested", "true");
    form.set("file", new File(["scope"], "scope.txt", { type: "text/plain" }));
    const request = new Request("https://greenlit.test/api/test", { method: "POST", body: form });
    const parsed = await readLimitedFormData(request, 4_096);
    expect(parsed.get("sourceDataAttested")).toBe("true");
    expect(parsed.get("file")).toBeInstanceOf(File);
  });
});
