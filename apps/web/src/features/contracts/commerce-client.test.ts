import { describe, expect, it, vi } from "vitest";

import type { CommerceApiError } from "./commerce-client";
import { sendCoreCommand } from "./commerce-client";

describe("commerce command error mapping", () => {
  it("shows the server's safe domain rejection instead of a generic form error", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            type: "https://clockwork.test/problems/invalid-state",
            title: "Core-finance operation rejected",
            status: 422,
            detail: "Credit exceeds the remaining invoice amount",
            code: "INVALID_STATE",
            requestId: "request-collections-test",
            retryable: false,
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      sendCoreCommand(
        {
          resource: "credit_notes",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "issue",
          payload: {},
        },
        {
          baseUrl: "https://clockwork.test/api",
          csrfToken: "c".repeat(32),
          idempotencyKey: "collections-error-mapping",
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "validation",
      message: "Credit exceeds the remaining invoice amount",
    } satisfies Partial<CommerceApiError>);
  });

  /**
   * A 503 that explains itself is a refusal, not an outage.
   *
   * The demo declines checkout on purpose and says why. That sentence was being
   * discarded and replaced with "The commerce service is unavailable.", so the
   * one place the demo is most deliberately honest read to a prospect as the
   * product falling over.
   */
  it("keeps a deliberate 503's own words and its problem code", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            type: "https://clockwork.test/problems/demo-payment-unavailable",
            title: "Payment checkout is not available in the demo",
            status: 503,
            detail:
              "The demo never contacts a payment provider, so no checkout session exists.",
            code: "DEMO_PAYMENT_UNAVAILABLE",
            requestId: "request-demo-payment",
            retryable: false,
          },
          { status: 503 },
        ),
      ),
    );

    await expect(
      sendCoreCommand(
        {
          resource: "invoices",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "issue",
          payload: {},
        },
        {
          baseUrl: "https://clockwork.test/api",
          csrfToken: "c".repeat(32),
          idempotencyKey: "demo-payment-boundary",
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: "unavailable",
      problemCode: "DEMO_PAYMENT_UNAVAILABLE",
      message:
        "The demo never contacts a payment provider, so no checkout session exists.",
    } satisfies Partial<CommerceApiError>);
  });

  /** A 503 that says nothing still gets the generic sentence. */
  it("falls back to the generic sentence when a 503 explains nothing", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );

    await expect(
      sendCoreCommand(
        {
          resource: "invoices",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "issue",
          payload: {},
        },
        {
          baseUrl: "https://clockwork.test/api",
          csrfToken: "c".repeat(32),
          idempotencyKey: "demo-payment-generic",
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: "The commerce service is unavailable.",
    } satisfies Partial<CommerceApiError>);
  });
});
