import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import {
  demoCreatedPartnerQuotes,
  demoPartnerQuoteContext,
  demoPartnerQuoteRecord,
  handleDemoPartnerQuoteCommand,
} from "./demo-partner-quote";

const store = createMemoryDemoStore();
const partner: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000003",
  organizationId: "31000000-0000-4000-8000-000000000003",
  accountIds: [demoAccountIds.reseller],
  roles: ["partner_admin"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const body = {
  id: "78000000-0000-4000-8000-000000000001",
  accountId: demoAccountIds.resaleEndClient,
  action: "create",
  payload: {
    priceBookId: "66000000-0000-4000-8000-000000000002",
    seriesId: "78100000-0000-4000-8000-000000000001",
    route: "resale",
    endClientAccountId: demoAccountIds.resaleEndClient,
    partnerAccountId: demoAccountIds.reseller,
    lines: [
      {
        lineId: "78200000-0000-4000-8000-000000000001",
        sku: "LOCKED-STORAGE-TB",
        region: "uk-south",
        quantity: "20",
        termMonths: 12,
      },
    ],
    partnerResaleTotal: { currency: "GBP", minor: "3000000" },
    expiresAt: "2026-09-18T12:00:00.000Z",
  },
} as const;

function request(
  key: string,
  command: Readonly<Record<string, unknown>> = body,
): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/quotes",
    {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(command),
    },
  );
}

beforeEach(async () => {
  await store.replace(createPristineDemoAdapterState());
});

describe("durable partner quote demo", () => {
  it("derives a quotable context from the active price book", async () => {
    const context = demoPartnerQuoteContext(
      await store.read(),
      demoAccountIds.reseller,
      "Redwood Channel Group",
    );
    expect(context).toMatchObject({
      route: "resale",
      endClients: [
        { id: demoAccountIds.resaleEndClient, quoteCurrency: "GBP" },
      ],
      offers: [
        {
          priceBookId: body.payload.priceBookId,
          sku: "LOCKED-STORAGE-TB",
          region: "uk-south",
          currency: "GBP",
        },
      ],
    });
  });

  it("prices with production rules and persists collection plus detail data", async () => {
    const response = await handleDemoPartnerQuoteCommand(
      request("demo-partner-quote-create-0001"),
      partner,
      { store, now: "2026-08-18T12:00:00.000Z" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: {
        resource: "quotes",
        rowVersion: 1,
        data: {
          status: "draft",
          total: { currency: "GBP", minor: "2640000" },
          partnerResaleTotal: { currency: "GBP", minor: "3000000" },
        },
      },
    });
    const state = await store.read();
    const [created] = demoCreatedPartnerQuotes(state, demoAccountIds.reseller);
    expect(created).toMatchObject({
      status: "draft",
      name: "Aster House Media · LOCKED-STORAGE-TB",
      value: "£26,400.00 transfer / £30,000.00 resale",
    });
    expect(
      demoPartnerQuoteRecord(state, demoAccountIds.reseller, created?.id ?? ""),
    ).toEqual(created);
  });

  it("replays exact bytes and rejects a conflicting reuse", async () => {
    const first = await handleDemoPartnerQuoteCommand(
      request("demo-partner-quote-replay-0001"),
      partner,
      { store },
    );
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const replay = await handleDemoPartnerQuoteCommand(
      request("demo-partner-quote-replay-0001"),
      partner,
      { store },
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const conflict = await handleDemoPartnerQuoteCommand(
      request("demo-partner-quote-replay-0001", {
        ...body,
        payload: {
          ...body.payload,
          partnerResaleTotal: { currency: "GBP", minor: "3100000" },
        },
      }),
      partner,
      { store },
    );
    expect(conflict.status).toBe(409);
    expect(
      demoCreatedPartnerQuotes(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(1);
  });

  it("refuses forged partner, end-client, and route relationships", async () => {
    for (const command of [
      {
        ...body,
        payload: {
          ...body.payload,
          partnerAccountId: demoAccountIds.distributor,
        },
      },
      { ...body, accountId: demoAccountIds.ukEndClient },
      { ...body, payload: { ...body.payload, route: "distributor" } },
    ]) {
      const response = await handleDemoPartnerQuoteCommand(
        request(`demo-partner-quote-denied-${crypto.randomUUID()}`, command),
        partner,
        { store },
      );
      expect(response.status).toBe(403);
    }
    expect(
      demoCreatedPartnerQuotes(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(0);
  });

  it("drops quote and receipt state on reset", async () => {
    await handleDemoPartnerQuoteCommand(
      request("demo-partner-quote-reset-0001"),
      partner,
      { store },
    );
    expect(
      demoCreatedPartnerQuotes(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(1);
    await store.replace(createPristineDemoAdapterState());
    expect(
      demoCreatedPartnerQuotes(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(0);
  });
});

it("keeps quotes with the same UUID timestamp prefix separately addressable", async () => {
  const secondId = "78000000-0000-4000-8000-000000000002";
  for (const [id, key] of [
    [body.id, "quote-collision-first-001"],
    [secondId, "quote-collision-second-002"],
  ] as const) {
    const response = await handleDemoPartnerQuoteCommand(
      request(key, { ...body, id }),
      partner,
      { store, now: "2026-08-18T12:00:00.000Z" },
    );
    expect(response.status).toBe(200);
  }
  const state = await store.read();
  const quotes = demoCreatedPartnerQuotes(state, demoAccountIds.reseller);
  expect(new Set(quotes.map((quote) => quote.recordKey)).size).toBe(2);
  for (const id of [body.id, secondId]) {
    expect(
      demoPartnerQuoteRecord(state, demoAccountIds.reseller, `quote-${id}`)?.id,
    ).toBe(`quote-${id}`);
  }
});
