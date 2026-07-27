import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("./database", () => ({
  requireSupabaseAdmin: () => ({ rpc: databaseMock.rpc, from: databaseMock.from }),
}));

import { deliverNotification, deliverPendingNotifications, type NotificationPayload } from "./notifications";

const notification: NotificationPayload = {
  id: "ef02f82e-5f80-4a49-b4a0-b768dd8b8864",
  owner_user_id: null,
  record_id: null,
  event_type: "DEMO_REQUEST_RECEIVED",
  title: "Demo request",
  body: "A qualified agency requested a demo.",
  payload: {},
  created_at: "2026-07-26T00:00:00.000Z",
};

describe("notification delivery", () => {
  beforeEach(() => {
    process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/greenlit";
    process.env.NOTIFICATION_WEBHOOK_SECRET = "N8v!k2P#t7Q@w4X$z9M&c6R*e3L_h5Y+";
    databaseMock.rpc.mockReset();
    databaseMock.from.mockReset();
    databaseMock.rpc.mockImplementation((name: string) => {
      if (name === "begin_notification_delivery_atomic") {
        return {
          maybeSingle: async () => ({
            data: { ...notification, delivery_claim_id: "4a8bbf35-a7f5-4802-b257-70b5698c8c83" },
            error: null,
          }),
        };
      }
      return Promise.resolve({ data: true, error: null });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    delete process.env.NOTIFICATION_WEBHOOK_SECRET;
  });

  it("refuses redirects and supplies a stable idempotency identity", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);

    await expect(deliverNotification(notification)).resolves.toBe(true);

    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      authorization: "Bearer N8v!k2P#t7Q@w4X$z9M&c6R*e3L_h5Y+",
      "idempotency-key": `greenlit-notification-${notification.id}`,
      "x-greenlit-notification-id": notification.id,
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      event: "greenlit.demo-request",
      deliveryId: notification.id,
    });
  });

  it("reclaims a stale in-flight delivery after a serverless interruption", async () => {
    const retryLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const staleLimit = vi.fn().mockResolvedValue({ data: [notification], error: null });
    databaseMock.from
      .mockReturnValueOnce({
        select: () => ({
          in: () => ({
            order: () => ({ limit: retryLimit }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            lt: () => ({
              order: () => ({ limit: staleLimit }),
            }),
          }),
        }),
      });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(deliverPendingNotifications(1)).resolves.toEqual({
      delivered: 1,
      attempted: 1,
      configured: true,
    });
    expect(retryLimit).toHaveBeenCalledWith(1);
    expect(staleLimit).toHaveBeenCalledWith(1);
  });
});
