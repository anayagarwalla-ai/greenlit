import { NextResponse } from "next/server";
import { noStoreJsonHeaders } from "./recordkeeping";

export class RequestSizeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
  }
}

export function contentLengthWithin(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return true;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= maxBytes;
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
  if (!contentLengthWithin(request, maxBytes)) throw new RequestSizeError(maxBytes);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RequestSizeError(maxBytes);
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const body = await readLimitedBody(request, maxBytes);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function requestTooLargeResponse(maxBytes: number) {
  return NextResponse.json(
    { error: `This request is too large. Keep it under ${Math.floor(maxBytes / 1024)} KB.`, code: "REQUEST_TOO_LARGE" },
    { status: 413, headers: noStoreJsonHeaders() },
  );
}

export function safeServerError(error: unknown, fallback: string) {
  console.error(fallback, error instanceof Error ? error.message : "Unknown error");
  return NextResponse.json({ error: fallback }, { status: 503, headers: noStoreJsonHeaders() });
}
