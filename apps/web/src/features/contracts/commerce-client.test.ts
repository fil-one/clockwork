import { describe, expect, it, vi } from "vitest";

import type { CommerceApiError } from "./commerce-client";
import { readCoreAccount, sendCoreCommand } from "./commerce-client";

describe("core account version read", () => {
  it("returns the one exactly scoped account aggregate", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          items: [
            {
              id: accountId,
              resource: "accounts",
              accountId,
              rowVersion: 7,
              data: {},
              createdAt: "2026-08-18T12:00:00.000Z",
              updatedAt: "2026-08-18T12:00:00.000Z",
            },
          ],
          nextCursor: null,
        }),
      ),
    );

    await expect(
      readCoreAccount(accountId, {
        baseUrl: "https://clockwork.test/api",
        fetchImplementation,
      }),
    ).resolves.toMatchObject({ id: accountId, rowVersion: 7 });
    const request = fetchImplementation.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("GET");
    expect(request.url).toContain("/v1/core/records/accounts");
    expect(request.url).toContain(`accountId=${accountId}`);
  });

  it("refuses an ambiguous or mismatched account read", async () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    await expect(
      readCoreAccount(accountId, {
        baseUrl: "https://clockwork.test/api",
        fetchImplementation: () =>
          Promise.resolve(Response.json({ items: [], nextCursor: null })),
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});

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

  /**
   * A refusal keeps the server's problem code whatever its class.
   *
   * 409 used to be answered with a fixed sentence and no code, so the price
   * book surfaces' `problemCode === "DUPLICATE"` branches -- "that version
   * already exists" rather than "someone else changed this" -- could never run.
   */
  it.each([
    [409, "conflict", "DUPLICATE"],
    [409, "conflict", "VERSION_CONFLICT"],
    [422, "validation", "INVALID_STATE"],
    [403, "forbidden", "PRICE_BOOK_AUTHORITY_FORBIDDEN"],
  ] as const)(
    "keeps the problem code of a %i refusal",
    async (status, code, problemCode) => {
      const fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              type: "https://clockwork.test/problems/refused",
              title: "Price-book command refused",
              status,
              detail: "A price book with this currency and version exists.",
              code: problemCode,
              requestId: "request-problem-code",
              retryable: false,
            },
            { status },
          ),
        ),
      );

      await expect(
        sendCoreCommand(
          {
            resource: "price_books",
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            action: "import",
            payload: {},
          },
          {
            baseUrl: "https://clockwork.test/api",
            csrfToken: "c".repeat(32),
            idempotencyKey: `problem-code-${status}-${problemCode}`,
            fetchImplementation,
          },
        ),
      ).rejects.toMatchObject({
        status,
        code,
        problemCode,
      } satisfies Partial<CommerceApiError>);
    },
  );

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
