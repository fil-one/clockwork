import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "../../app";
import type {
  NotificationDeliveryService,
  NotificationPreferenceService,
} from "./notifications";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000004";
const CSRF = "notification-preference-csrf-token-0000000001";

const delivery = {
  id: "77777777-7777-4777-8777-777777777701",
  accountId: ACCOUNT_ID,
  channel: "email",
  alertKind: "renewal_notice_window",
  subjectType: "order",
  subjectId: "88888888-8888-4888-8888-888888888801",
  template: "renewals.notice_window.v1",
  recipients: ["renewals@northstar.test"],
  status: "sent",
  providerMessageId: "msg_provider_1",
  failureCode: null,
  requestedAt: "2027-01-01T09:00:00.000Z",
  deliveredAt: "2027-01-01T09:00:01.000Z",
};

function app(deliveries?: NotificationDeliveryService) {
  return createApiApp(
    deliveries ? { lifecycle: { notificationDeliveries: deliveries } } : {},
  );
}

function request(query: string, persona = "owner", account = ACCOUNT_ID) {
  return {
    headers: {
      "x-clockwork-persona": persona,
      "x-clockwork-account": account,
      "x-request-id": "notification-delivery-read-0001",
    },
    query,
  };
}

describe("notification delivery API", () => {
  /**
   * P0-46's surviving sub-claim was about the generated artifact, not the
   * route object: `packages/api/src/generated/openapi.json` carried no
   * notification operation, so §18's `/notifications` catalogue entry was
   * unmet. Asserting against the committed document is what binds the claim.
   */
  it("publishes the operation in the generated contract §18 names", () => {
    const document: unknown = JSON.parse(
      readFileSync(
        new URL("../../generated/openapi.json", import.meta.url),
        "utf8",
      ),
    );
    const paths = (document as { paths: Record<string, unknown> }).paths;
    expect(Object.keys(paths)).toContain("/v1/notifications");
  });

  it("returns the account's delivery evidence with a stable cursor", async () => {
    const list = vi
      .fn<NotificationDeliveryService["list"]>()
      .mockResolvedValue({ items: [delivery], nextCursor: "cursor-2" });
    const call = request(
      `?accountId=${ACCOUNT_ID}&alertKind=renewal_notice_window`,
    );
    const response = await app({ list }).request(
      `/v1/notifications${call.query}`,
      { headers: call.headers },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [delivery],
      nextCursor: "cursor-2",
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        alertKind: "renewal_notice_window",
        limit: 50,
      }),
    );
  });

  it("denies a read scoped to an account the caller does not hold", async () => {
    const list = vi
      .fn<NotificationDeliveryService["list"]>()
      .mockResolvedValue({ items: [], nextCursor: null });
    const call = request(`?accountId=${OTHER_ACCOUNT_ID}`);
    const response = await app({ list }).request(
      `/v1/notifications${call.query}`,
      { headers: call.headers },
    );
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("refuses an unscoped listing rather than widening it", async () => {
    const list = vi
      .fn<NotificationDeliveryService["list"]>()
      .mockResolvedValue({ items: [], nextCursor: null });
    const response = await app({ list }).request("/v1/notifications", {
      headers: request("").headers,
    });
    expect(response.status).toBe(422);
    expect(list).not.toHaveBeenCalled();
  });

  it("reports an unconfigured adapter as retryable rather than empty", async () => {
    const call = request(`?accountId=${ACCOUNT_ID}`);
    const response = await app().request(`/v1/notifications${call.query}`, {
      headers: call.headers,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOTIFICATION_DELIVERY_ADAPTER_UNAVAILABLE",
      retryable: true,
    });
  });
});

describe("notification preference API", () => {
  const stored = {
    accountId: ACCOUNT_ID,
    alertKind: "quote_expiry",
    channel: "email",
    enabled: false,
    rowVersion: 2,
    updatedAt: "2027-01-01T09:00:00.000Z",
  };

  function service(setBehaviour?: NotificationPreferenceService["set"]) {
    const set =
      setBehaviour ??
      vi.fn<NotificationPreferenceService["set"]>().mockResolvedValue(stored);
    const list = vi
      .fn<NotificationPreferenceService["list"]>()
      .mockResolvedValue({ items: [stored] });
    return { set, list, preferences: { list, set } };
  }

  function withPreferences(preferences: NotificationPreferenceService) {
    return createApiApp({
      lifecycle: { notificationPreferences: preferences },
    });
  }

  it("publishes the preference operation in the generated contract", () => {
    const document: unknown = JSON.parse(
      readFileSync(
        new URL("../../generated/openapi.json", import.meta.url),
        "utf8",
      ),
    );
    const paths = (document as { paths: Record<string, unknown> }).paths;
    expect(Object.keys(paths)).toContain("/v1/notifications/preferences");
  });

  it("lists the settings an account holds", async () => {
    const { preferences } = service();
    const response = await withPreferences(preferences).request(
      `/v1/notifications/preferences?accountId=${ACCOUNT_ID}`,
      { headers: request("").headers },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [stored] });
  });

  it("stores a switched-off advisory alert", async () => {
    const { preferences, set } = service();
    const response = await withPreferences(preferences).request(
      "/v1/notifications/preferences",
      {
        method: "PUT",
        headers: {
          ...request("").headers,
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: `clockwork-csrf=${CSRF}`,
          "x-csrf-token": CSRF,
          "idempotency-key": "notification-preference-write-0001",
        },
        body: JSON.stringify({
          accountId: ACCOUNT_ID,
          alertKind: "quote_expiry",
          channel: "email",
          enabled: false,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ alertKind: "quote_expiry", enabled: false }),
    );
  });

  /**
   * The refused set is exactly the notices the platform owes whatever the
   * account prefers. The database constraint is the authority; the route only
   * has to turn its rejection into a usable problem rather than a 500.
   */
  it("reports a notice that cannot be switched off as a rejected request", async () => {
    const { preferences } = service(
      vi
        .fn<NotificationPreferenceService["set"]>()
        .mockRejectedValue(
          Object.assign(
            new Error(
              "renewal_notice_window is not an optional alert and cannot be switched off",
            ),
            { code: "ALERT_KIND_NOT_MANAGEABLE" },
          ),
        ),
    );
    const response = await withPreferences(preferences).request(
      "/v1/notifications/preferences",
      {
        method: "PUT",
        headers: {
          ...request("").headers,
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: `clockwork-csrf=${CSRF}`,
          "x-csrf-token": CSRF,
          "idempotency-key": "notification-preference-write-0002",
        },
        body: JSON.stringify({
          accountId: ACCOUNT_ID,
          alertKind: "renewal_notice_window",
          channel: "email",
          enabled: false,
        }),
      },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOTIFICATION_ALERT_KIND_NOT_MANAGEABLE",
      retryable: false,
    });
  });

  it("denies a write scoped to an account the caller does not hold", async () => {
    const { preferences, set } = service();
    const response = await withPreferences(preferences).request(
      "/v1/notifications/preferences",
      {
        method: "PUT",
        headers: {
          ...request("").headers,
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: `clockwork-csrf=${CSRF}`,
          "x-csrf-token": CSRF,
          "idempotency-key": "notification-preference-write-0003",
        },
        body: JSON.stringify({
          accountId: OTHER_ACCOUNT_ID,
          alertKind: "quote_expiry",
          channel: "email",
          enabled: false,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });
});
