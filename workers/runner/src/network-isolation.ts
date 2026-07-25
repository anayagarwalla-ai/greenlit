import type { BrowserContext, Route, WebSocketRoute } from "@cloudflare/playwright";

type ValidateTarget = () => Promise<boolean>;

export function requestUrlAllowed(rawUrl: string, targetOrigin: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "data:" || url.protocol === "blob:") return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin === new URL(targetOrigin).origin;
  } catch {
    return false;
  }
}

async function handleHttpRoute(route: Route, targetOrigin: string, validateTarget?: ValidateTarget): Promise<void> {
  if (!requestUrlAllowed(route.request().url(), targetOrigin)) {
    await route.abort("blockedbyclient");
    return;
  }
  const resourceType = route.request().resourceType();
  // Validate immediately before every navigation. All other network traffic
  // is still restricted to this exact origin, while the runner independently
  // checks every connected response address. Avoiding one DNS RPC per
  // fetch/XHR prevents a hostile page from amplifying validation traffic.
  if (validateTarget && resourceType === "document" && !await validateTarget()) {
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
}

async function handleWebSocketRoute(webSocket: WebSocketRoute): Promise<void> {
  // The Browser Rendering API does not expose the connected socket's remote
  // address. Without that address Greenlit cannot prove the socket still uses
  // the job's frozen public DNS set, so verification jobs fail closed and do
  // not open WebSockets at all.
  await webSocket.close({ code: 1008, reason: "WebSockets are disabled during Greenlit verification." });
}

export async function installNetworkIsolation(context: BrowserContext, targetOrigin: string, validateTarget?: ValidateTarget): Promise<void> {
  // Context routes must be installed before the first page exists. Unlike a
  // page route, this covers a popup's initial navigation as well as redirects,
  // frames, fetch/XHR, scripts, styles, images, and dedicated workers.
  await context.addInitScript(() => {
    const blocked = () => { throw new DOMException("WebRTC is disabled during verification.", "SecurityError"); };
    Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: false, writable: false, value: undefined });
    Object.defineProperty(globalThis, "webkitRTCPeerConnection", { configurable: false, writable: false, value: undefined });
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: false, writable: false, value: blocked });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { configurable: false, writable: false, value: blocked });
    }
  });
  await context.route("**/*", (route) => handleHttpRoute(route, targetOrigin, validateTarget));
  await context.routeWebSocket("**/*", handleWebSocketRoute);
}
