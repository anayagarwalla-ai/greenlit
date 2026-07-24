import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const blockedHostnames = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const blockedSuffixes = [".local", ".internal", ".localhost", ".home", ".lan"];

export function isPrivateAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address.trim().replace(/^\[|\]$/g, ""));
    // `unicast` is the only range suitable for a public staging target.
    // This rejects private, loopback, link-local, multicast, unspecified,
    // documentation, benchmark, reserved, IPv4-mapped, 6to4, and Teredo space.
    return parsed.range() !== "unicast";
  } catch { return true; }
}

export function validateStagingUrl(input: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(input); } catch { return { ok: false, reason: "Enter a valid HTTPS URL." }; }
  if (url.protocol !== "https:") return { ok: false, reason: "Only HTTPS staging targets are allowed." };
  if (url.username || url.password) return { ok: false, reason: "URLs containing credentials are not allowed." };
  if (url.port && url.port !== "443") return { ok: false, reason: "Non-standard ports are not allowed." };
  if (url.hash) return { ok: false, reason: "Remove the URL fragment before verification." };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (blockedHostnames.has(hostname) || blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) return { ok: false, reason: "Local and internal targets are not allowed." };
  if (isIP(hostname) !== 0) return { ok: false, reason: "Use a verified hostname rather than a literal IP address." };
  return { ok: true, url };
}

export function assertSafeResolvedAddresses(addresses: string[]): void {
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("Target resolved to a private or reserved address.");
}
