import ipaddr from "ipaddr.js";

export function isUnsafeAddress(address: string): boolean {
  try { return ipaddr.parse(normalizeAddress(address)).range() !== "unicast"; }
  catch { return true; }
}

export function pathWithQueryAndHash(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function addressMatchesFrozenSet(address: string, frozenAddresses: string[]): boolean {
  const normalized = normalizeAddress(address);
  return !isUnsafeAddress(normalized) && frozenAddresses.map(normalizeAddress).includes(normalized);
}

export function perCheckBudgetMs(deadlineMs: number, nowMs: number, checksRemaining: number): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs) || checksRemaining < 1) return 0;
  const remaining = Math.max(0, deadlineMs - nowMs);
  return Math.min(18_000, Math.floor(remaining / checksRemaining));
}
