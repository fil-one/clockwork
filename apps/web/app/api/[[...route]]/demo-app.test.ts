import { describe, expect, it } from "vitest";

import { handle } from "./demo-app";

const csrfToken = "12345678901234567890123456789012";

function commandRequest(headers: Record<string, string>): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/quotes",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        id: "88888888-8888-4888-8888-888888888888",
        accountId: "11111111-1111-4111-8111-111111111111",
        action: "create",
        payload: { route: "direct" },
      }),
    },
  );
}

describe("demo commerce api", () => {
  it("answers a mutation that carries replay and CSRF evidence", async () => {
    const response = await handle(
      commandRequest({
        "idempotency-key": "demo-quote-command-1",
        "x-csrf-token": csrfToken,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { resource: "quotes", rowVersion: 1, data: { route: "direct" } },
    });
  });

  it("refuses a mutation with no idempotency key", async () => {
    const response = await handle(
      commandRequest({ "x-csrf-token": csrfToken }),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a mutation with no CSRF token", async () => {
    const response = await handle(
      commandRequest({ "idempotency-key": "demo-quote-command-2" }),
    );

    expect(response.status).toBe(403);
  });

  it("serves the active agreement template the click-through surface verifies", async () => {
    const response = await handle(
      new Request(
        "https://demo.clockwork.test/api/v1/lifecycle/agreement-templates/active?type=csa&jurisdiction=US",
      ),
    );
    const template = (await response.json()) as {
      exactText: string;
      exactTextHash: string;
      executionMode: string;
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(template.exactText),
    );

    expect(response.status).toBe(200);
    expect(template.executionMode).toBe("click_through");
    expect(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(template.exactTextHash);
  });

  it("declines checkout instead of simulating a payment provider", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/payment-sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-payment-session-1",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          accountId: "11111111-1111-4111-8111-111111111111",
          invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_PAYMENT_UNAVAILABLE",
    });
  });

  /**
   * The order lane is run, not simulated, so it is the one command the echo
   * handler must not answer. Reaching an authentication failure rather than a
   * `{record: {data: <the payload>}}` echo is the evidence that the request was
   * routed to the lane -- the lane reads a session, and this request carries
   * none.
   */
  it("routes an order command to the lane rather than echoing it", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-1",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "accept",
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("refuses an order command with no replay evidence", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("reports an operation the demo does not simulate as problem details", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/system/nothing-here"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_OPERATION_UNAVAILABLE",
      retryable: false,
    });
  });
});
