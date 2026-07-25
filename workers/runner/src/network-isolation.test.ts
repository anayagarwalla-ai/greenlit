import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Route, WebSocketRoute } from "@cloudflare/playwright";
import { installNetworkIsolation, requestUrlAllowed } from "./network-isolation";

describe("requestUrlAllowed", () => {
  const origin = "https://staging.example.com";

  it("allows only exact-origin HTTP requests plus non-network data and blob URLs", () => {
    expect(requestUrlAllowed("https://staging.example.com/", origin)).toBe(true);
    expect(requestUrlAllowed("https://staging.example.com/assets/app.js?v=3", origin)).toBe(true);
    expect(requestUrlAllowed("data:image/svg+xml;base64,PHN2Zy8+", origin)).toBe(true);
    expect(requestUrlAllowed("blob:https://staging.example.com/9a55", origin)).toBe(true);
  });

  it("blocks off-origin, protocol, subdomain, port, credential, and malformed URL tricks", () => {
    for (const url of [
      "http://staging.example.com/",
      "https://evil.example/",
      "https://api.staging.example.com/",
      "https://staging.example.com:444/",
      "https://staging.example.com@evil.example/",
      "javascript:fetch('https://evil.example')",
      "not a url",
    ]) {
      expect(requestUrlAllowed(url, origin), url).toBe(false);
    }
  });
});

describe("installNetworkIsolation", () => {
  it("installs browser-context HTTP and WebSocket routes before pages are created", async () => {
    let httpHandler: ((route: Route) => Promise<void>) | undefined;
    let socketHandler: ((webSocket: WebSocketRoute) => Promise<void>) | undefined;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => { httpHandler = handler; }),
      routeWebSocket: vi.fn(async (_pattern: string, handler: (webSocket: WebSocketRoute) => Promise<void>) => { socketHandler = handler; }),
    } as unknown as BrowserContext;

    await installNetworkIsolation(context, "https://staging.example.com");

    expect(context.addInitScript).toHaveBeenCalledOnce();
    expect(context.route).toHaveBeenCalledOnce();
    expect(context.routeWebSocket).toHaveBeenCalledOnce();
    expect(httpHandler).toBeTypeOf("function");
    expect(socketHandler).toBeTypeOf("function");

    const sameOrigin = {
      request: () => ({ url: () => "https://staging.example.com/redirect-destination", resourceType: () => "document" }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;
    await httpHandler!(sameOrigin);
    expect(sameOrigin.continue).toHaveBeenCalledOnce();
    expect(sameOrigin.abort).not.toHaveBeenCalled();

    const popupOrRedirect = {
      request: () => ({ url: () => "https://attacker.example/private-probe", resourceType: () => "document" }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;
    await httpHandler!(popupOrRedirect);
    expect(popupOrRedirect.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(popupOrRedirect.continue).not.toHaveBeenCalled();

    const socket = {
      close: vi.fn(async () => undefined),
      connectToServer: vi.fn(),
    } as unknown as WebSocketRoute;
    await socketHandler!(socket);
    expect(socket.close).toHaveBeenCalledWith({
      code: 1008,
      reason: "WebSockets are disabled during Greenlit verification.",
    });
    expect(socket.connectToServer).not.toHaveBeenCalled();
  });

  it("fails closed when a same-origin navigation no longer passes DNS validation", async () => {
    let httpHandler: ((route: Route) => Promise<void>) | undefined;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => { httpHandler = handler; }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const validate = vi.fn(async () => false);
    await installNetworkIsolation(context, "https://staging.example.com", validate);
    const navigation = {
      request: () => ({ url: () => "https://staging.example.com/account", resourceType: () => "document" }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;
    await httpHandler!(navigation);
    expect(validate).toHaveBeenCalledOnce();
    expect(navigation.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(navigation.continue).not.toHaveBeenCalled();
  });

  it("does not amplify DNS validation for same-origin fetch bursts", async () => {
    let httpHandler: ((route: Route) => Promise<void>) | undefined;
    const context = {
      addInitScript: vi.fn(async () => undefined),
      route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => { httpHandler = handler; }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const validate = vi.fn(async () => true);
    await installNetworkIsolation(context, "https://staging.example.com", validate);
    const fetchRoute = {
      request: () => ({ url: () => "https://staging.example.com/api/data", resourceType: () => "fetch" }),
      continue: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    } as unknown as Route;
    await httpHandler!(fetchRoute);
    expect(validate).not.toHaveBeenCalled();
    expect(fetchRoute.continue).toHaveBeenCalledOnce();
  });
});
