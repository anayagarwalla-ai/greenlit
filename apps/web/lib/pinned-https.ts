import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type PinnedHttpsResponse = { status: number; text: string; location: string | null };

export async function pinnedHttpsGet(url: URL, addresses: string[], options: { maxBytes?: number; timeoutMs?: number; userAgent?: string } = {}): Promise<PinnedHttpsResponse> {
  if (url.protocol !== "https:" || addresses.length === 0) throw new Error("A pinned HTTPS address is required.");
  const address = addresses[0]!;
  const family = isIP(address);
  if (!family) throw new Error("The pinned address is invalid.");
  const maxBytes = options.maxBytes ?? 4_096;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return new Promise((resolve, reject) => {
    const lookup = ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, address, family)) as LookupFunction;
    const outgoing = request(url, {
      method: "GET",
      lookup,
      servername: url.hostname,
      headers: { "user-agent": options.userAgent ?? "Greenlit-Origin-Verifier/0.2", accept: "text/plain" },
    }, (response) => {
      const declared = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(new Error("Ownership proof is too large.")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) response.destroy(new Error("Ownership proof is too large."));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8").trim(), location: typeof response.headers.location === "string" ? response.headers.location : null }));
      response.on("error", reject);
    });
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new Error("Ownership proof request timed out.")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}
