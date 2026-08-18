import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("./demo-quote-flow", () => ({
  demoQuoteFlow: () => ({ execute: mocks.execute }),
}));

import { handleDemoQuoteCommand } from "./demo-quote-command";

const accountId = "11000000-0000-4000-8000-000000000001";
const quoteId = "70000000-0000-4000-8000-000000000001";
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function request(body: unknown): Request {
  return new Request("https://demo.test/api/v1/core/commands/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "quote-command-key-0001",
    },
    body: JSON.stringify(body),
  });
}

const createBody = {
  resource: "quotes",
  id: quoteId,
  accountId,
  action: "create",
  payload: {
    priceBookId: "66000000-0000-4000-8000-000000000001",
    seriesId: "71000000-0000-4000-8000-000000000001",
    route: "direct",
    lines: [
      {
        lineId: "72000000-0000-4000-8000-000000000001",
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        quantity: "42",
        termMonths: 12,
      },
    ],
    expiresAt: "2026-09-01T12:00:00.000Z",
  },
};

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({
    replayed: false,
    result: {
      rowVersion: 1,
      data: { status: "draft", totalMinor: "7560000", currency: "USD" },
      auditEventId: "audit-1",
      outboxEventId: "outbox-1",
    },
  });
});

describe("handleDemoQuoteCommand", () => {
  it("passes a validated direct command into the durable flow and returns the production shape", async () => {
    const response = await handleDemoQuoteCommand(request(createBody), session);

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(await response.json()).toMatchObject({
      record: {
        id: quoteId,
        resource: "quotes",
        accountId,
        rowVersion: 1,
        data: { status: "draft", totalMinor: "7560000", currency: "USD" },
      },
      auditEventId: "audit-1",
      outboxEventId: "outbox-1",
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        idempotencyKey: "quote-command-key-0001",
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown,
        command: expect.objectContaining({
          action: "create",
          quoteId,
          accountId,
          route: "direct",
        }) as unknown,
      }),
    );
  });

  it("refuses actors without quote authority before consuming the body", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("body was consumed");
      },
    });
    const response = await handleDemoQuoteCommand(
      new Request("https://demo.test/api/v1/core/commands/quotes", {
        method: "POST",
        headers: { "idempotency-key": "quote-command-key-0002" },
        body,
        duplex: "half",
      } as RequestInit),
      { ...session, roles: ["member"] },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "QUOTE_AUTHORITY_FORBIDDEN",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("refuses cross-account and partner-route commands", async () => {
    const crossAccount = await handleDemoQuoteCommand(
      request({
        ...createBody,
        accountId: "11000000-0000-4000-8000-000000000007",
      }),
      session,
    );
    expect(crossAccount.status).toBe(403);

    const partnerRoute = await handleDemoQuoteCommand(
      request({
        ...createBody,
        payload: { ...createBody.payload, route: "resale" },
      }),
      session,
    );
    expect(partnerRoute.status).toBe(422);
    expect(await partnerRoute.json()).toMatchObject({ code: "INVALID_STATE" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
