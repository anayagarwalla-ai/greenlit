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

export async function readLimitedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!contentLengthWithin(request, maxBytes)) throw new RequestSizeError(maxBytes);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RequestSizeError(maxBytes);
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    reader.releaseLock();
  }
}

export async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readLimitedBytes(request, maxBytes));
}

export async function readLimitedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readLimitedBytes(request, maxBytes);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData();
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const body = await readLimitedBody(request, maxBytes);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function readLimitedJsonResult(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, body: await readLimitedJson(request, maxBytes) };
  } catch (error) {
    if (error instanceof RequestSizeError) {
      return { ok: false, response: requestTooLargeResponse(error.maxBytes) };
    }
    throw error;
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
