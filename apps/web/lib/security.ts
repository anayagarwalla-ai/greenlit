import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const blockedSuffixes = [".local", ".internal", ".localhost", ".home", ".lan"];

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function inCidr(ip: string, network: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(network) & mask);
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([network, bits]) => inCidr(address, String(network), Number(bits)));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("2001:db8");
  }
  return true;
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

