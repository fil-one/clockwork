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
});
