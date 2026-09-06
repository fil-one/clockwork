import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoPersonas } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import { handleDemoPriceBookCommand } from "./demo-price-book-command";
import { currentDemoPriceBooks } from "./demo-price-books";

const finance: SessionClaims = {
  userId: demoPersonas.financeApprover.userId,
  organizationId: demoPersonas.financeApprover.organizationId,
  accountIds: [],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

const store = createMemoryDemoStore();

function request(
  idempotencyKey: string,
  body: Readonly<Record<string, unknown>>,
): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/price_books",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  );
}

const createBody = {
  id: "66000000-0000-4000-8000-000000000099",
  action: "create",
  payload: {
    name: "Demo authored EUR",
    currency: "EUR",
    effectiveFrom: "2026-07-01",
    version: 9,
  },
} as const;

beforeEach(async () => {
  await store.replace(createPristineDemoAdapterState());
});

describe("durable demo price-book commands", () => {
  it("creates only a draft, then validates and adds its first rate", async () => {
    const created = await handleDemoPriceBookCommand(
      request("price-book-create-0001", createBody),
      finance,
      { store },
    );
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      record: {
        id: createBody.id,
        rowVersion: 1,
        data: { status: "draft", rateCardCount: 0 },
      },
    });

    const added = await handleDemoPriceBookCommand(
      request("price-book-add-rate-0001", {
        id: createBody.id,
        action: "add_rate",
        expectedVersion: 1,
        payload: {
          sku: "LOCKED-STORAGE-TB",
          region: "eu-central-1",
          unit: "TB-month",
          approvedClaim: "Fictional immutable storage capacity",
          unitPrice: { currency: "EUR", minor: "14000" },
          floorPrice: { currency: "EUR", minor: "9500" },
          overageRate: { currency: "EUR", minor: "17000" },
          minimumQuantity: "1",
          egressTreatment: "metered",
          commitType: "term_drawdown",
          stripeTaxCode: "txcd_demo",
          qboIncomeAccount: "4000-Storage",
          partnerTransferPrices: {},
        },
      }),
      finance,
      { store },
    );
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({
      record: { rowVersion: 2, data: { rateCardCount: 1 } },
    });
    expect(
      currentDemoPriceBooks(await store.read()).find(
        (book) => book.id === createBody.id,
      ),
    ).toMatchObject({ rateCardCount: 1, regions: ["eu-central-1"] });
  });

  it("activates a pre-proposed draft with a different finance authority", async () => {
    const response = await handleDemoPriceBookCommand(
      request("price-book-activate-0001", {
        id: "66000000-0000-4000-8000-000000000003",
        action: "activate",
        expectedVersion: 2,
        payload: { reason: "Second finance review confirms the demo rates." },
      }),
      finance,
      { store },
    );
    expect(response.status).toBe(200);
    const books = currentDemoPriceBooks(await store.read());
    expect(books.find((book) => book.id.endsWith("0003"))).toMatchObject({
      status: "active",
      rowVersion: 3,
    });
    expect(books.find((book) => book.id.endsWith("0001"))).toMatchObject({
      status: "retired",
      effectiveTo: "2026-07-31",
    });
  });

  it("binds replay to the exact command bytes", async () => {
    const first = await handleDemoPriceBookCommand(
      request("price-book-create-replay", createBody),
      finance,
      { store },
    );
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const replay = await handleDemoPriceBookCommand(
      request("price-book-create-replay", createBody),
      finance,
      { store },
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");

    const conflict = await handleDemoPriceBookCommand(
      request("price-book-create-replay", {
        ...createBody,
        payload: { ...createBody.payload, name: "Different bytes" },
      }),
      finance,
      { store },
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("requires finance authority, MFA, and recent authentication", async () => {
    for (const denied of [
      { ...finance, roles: ["internal_operator"] as const },
      { ...finance, mfaVerified: false },
      { ...finance, recentAuthenticationVerified: false },
    ]) {
      const response = await handleDemoPriceBookCommand(
        request(`price-book-denied-${crypto.randomUUID()}`, createBody),
        denied,
        { store },
      );
      expect(response.status).toBe(403);
    }
    expect(currentDemoPriceBooks(await store.read())).toHaveLength(3);
  });

  it("returns to deterministic seeds when the demo is reset", async () => {
    await handleDemoPriceBookCommand(
      request("price-book-create-reset", createBody),
      finance,
      { store },
    );
    expect(currentDemoPriceBooks(await store.read())).toHaveLength(4);

    await store.replace(createPristineDemoAdapterState());
    const resetBooks = currentDemoPriceBooks(await store.read());
    expect(resetBooks).toHaveLength(3);
    expect(resetBooks.some((book) => book.id === createBody.id)).toBe(false);
  });

  it("reports malformed JSON as a client error without mutating state", async () => {
    const response = await handleDemoPriceBookCommand(
      new Request(
        "https://demo.clockwork.test/api/v1/core/commands/price_books",
        {
          method: "POST",
          headers: { "idempotency-key": "price-book-malformed-json" },
          body: "{",
        },
      ),
      finance,
      { store },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
    expect(currentDemoPriceBooks(await store.read())).toHaveLength(3);
  });
});

describe("draft editing preserves approval evidence", () => {
  it("freezes proposals, rejects by a distinct authority, edits multiple rates and invalidates stale writes", async () => {
    const id = "66000000-0000-4000-8000-000000000003";
    const original = currentDemoPriceBooks(await store.read()).find(
      (book) => book.id === id,
    )?.rateCards[0];
    if (!original) throw new Error("Missing fixture rate");
    let sequence = 0;
    const send = (
      action: string,
      expectedVersion: number,
      payload: Record<string, unknown>,
    ) =>
      handleDemoPriceBookCommand(
        request(`price-edit-${++sequence}-idempotency`, {
          id,
          action,
          expectedVersion,
          payload,
        }),
        finance,
        { store },
      );
    expect(
      (
        await send("update_rate", 2, {
          ...original,
          unitPrice: { currency: "USD", minor: "14900" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send("reject_activation", 2, {
          reason: "Return for corrected regional prices.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("update_rate", 3, {
          ...original,
          unitPrice: { currency: "USD", minor: "14900" },
        })
      ).status,
    ).toBe(200);
    expect((await send("update_rate", 3, { ...original })).status).toBe(409);
    expect(
      (
        await send("add_rate", 4, {
          ...original,
          id: "66100000-0000-4000-8000-000000000099",
          region: "us-west-2",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("update_discount_matrix", 5, {
          id: "policy-test",
          version: 1,
          defaultMaxDiscountBps: 0,
          rules: [{ id: "volume", minQuantity: "100", maxDiscountBps: 300 }],
        })
      ).status,
    ).toBe(200);
    expect((await send("remove_rate", 6, { id: original.id })).status).toBe(
      200,
    );
    const edited = currentDemoPriceBooks(await store.read()).find(
      (book) => book.id === id,
    );
    expect(edited).toMatchObject({
      rowVersion: 7,
      rateCardCount: 1,
      regions: ["us-west-2"],
      activationRequestedBy: null,
      discountMatrix: { version: 1 },
    });
    expect(
      (
        await send("request_activation", 7, {
          reason: "Revalidated corrected regional economics.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("remove_rate", 8, {
          id: "66100000-0000-4000-8000-000000000099",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send("activate", 8, {
          reason: "Attempting self approval of changed prices.",
        })
      ).status,
    ).toBe(422);
  });
});
