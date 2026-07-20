export async function signRunnerRequest(body: string, secret: string, timestamp = Date.now().toString()): Promise<{ timestamp: string; signature: string }> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return { timestamp, signature: Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export async function verifyRunnerRequest(body: string, secret: string, timestamp: string | null, signature: string | null): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300_000) return false;
  const expected = await signRunnerRequest(body, secret, timestamp);
  if (expected.signature.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) difference |= expected.signature.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

