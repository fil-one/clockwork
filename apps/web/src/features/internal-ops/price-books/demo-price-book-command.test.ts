import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportPriceBookExchange } from "@clockwork/domain/core";
import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoPersonas } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import { handleDemoPriceBookCommand } from "./demo-price-book-command";
import { currentDemoPriceBooks, storeDemoPriceBooks } from "./demo-price-books";

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

  it.each([
    ["2026-07-30", 422, "draft"],
    ["2026-07-31", 200, "active"],
  ] as const)(
    "honors the inclusive demo end date %s",
    async (effectiveTo, status, expectedStatus) => {
      const id = "66000000-0000-4000-8000-000000000003";
      await store.update((state) =>
        storeDemoPriceBooks(
          state,
          currentDemoPriceBooks(state).map((book) =>
            book.id === id ? { ...book, effectiveTo } : book,
          ),
          "2026-07-31T12:00:00Z",
        ),
      );
      const response = await handleDemoPriceBookCommand(
        request(`price-book-window-${effectiveTo}`, {
          id,
          action: "activate",
          expectedVersion: 2,
          payload: {
            reason: "Second finance review of the bounded effective window",
          },
        }),
        finance,
        { store, now: "2026-07-31T23:59:59Z" },
      );
      expect(response.status).toBe(status);
      expect(
        currentDemoPriceBooks(await store.read()).find(
          (book) => book.id === id,
        ),
      ).toMatchObject({ status: expectedStatus, effectiveTo });
      if (status === 422)
        expect(
          currentDemoPriceBooks(await store.read()).find((book) =>
            book.id.endsWith("0001"),
          ),
        ).toMatchObject({ status: "active" });
    },
  );

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

it("clones the exact source into an independent draft with new rate IDs and reset approval", async () => {
  const source = currentDemoPriceBooks(await store.read()).find(
    (book) => book.activationRequestedBy,
  );
  if (!source) throw new Error("Missing proposed source");
  const original = structuredClone(source);
  const id = "66000000-0000-4000-8000-000000000098";
  const command = {
    id,
    action: "clone",
    payload: {
      sourceId: source.id,
      sourceRowVersion: source.rowVersion,
      name: "Copied economics",
      version: 90,
      effectiveFrom: "2026-09-06",
      reason: "Prepare a separately approved regional refresh",
    },
  };
  const response = await handleDemoPriceBookCommand(
    request("clone-independent-draft-0001", command),
    finance,
    { store },
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    record: { data: { cloneProvenance: unknown } };
  };
  const books = currentDemoPriceBooks(await store.read());
  const cloned = books.find((book) => book.id === id);
  expect(books.find((book) => book.id === source.id)).toEqual(original);
  expect(cloned).toMatchObject({
    rowVersion: 1,
    status: "draft",
    version: 90,
    effectiveTo: null,
    activationRequestedBy: null,
    activationRequestedAt: null,
    lastDecisionAt: null,
    lastDecisionReason: null,
  });
  expect(
    cloned?.rateCards.map(({ id: _id, ...economics }) => economics),
  ).toEqual(source.rateCards.map(({ id: _id, ...economics }) => economics));
  expect(cloned?.rateCards[0]?.id).not.toBe(source.rateCards[0]?.id);
  expect(result.record.data.cloneProvenance).toMatchObject({
    sourceId: source.id,
    sourceRowVersion: source.rowVersion,
    providerMappings: "not_copied_requires_review",
  });
  expect(
    (
      await handleDemoPriceBookCommand(
        request("clone-independent-draft-0001", command),
        finance,
        { store },
      )
    ).headers.get("idempotency-replayed"),
  ).toBe("true");
  const stale = await handleDemoPriceBookCommand(
    request("clone-independent-stale-0001", {
      ...command,
      id: "66000000-0000-4000-8000-000000000097",
      payload: {
        ...command.payload,
        version: 91,
        sourceRowVersion: source.rowVersion + 1,
      },
    }),
    finance,
    { store },
  );
  expect(stale.status).toBe(409);
  expect(currentDemoPriceBooks(await store.read())).toHaveLength(books.length);
  const activate = await handleDemoPriceBookCommand(
    request("clone-without-approval-0001", {
      id,
      action: "activate",
      expectedVersion: 1,
      payload: { reason: "Attempt an inherited approval" },
    }),
    finance,
    { store },
  );
  expect(activate.status).toBe(422);
  expect(await activate.json()).toMatchObject({
    code: "TWO_AUTHORITY_REQUIRED",
  });
});

it("imports validated economics into an independent draft and rejects injected authority atomically", async () => {
  const before = currentDemoPriceBooks(await store.read());
  const source = before[0];
  if (!source) throw new Error("Missing fixture");
  const document = exportPriceBookExchange(source, "2026-09-06T12:00:00.000Z");
  const id = "66000000-0000-4000-8000-000000000096";
  const body = {
    id,
    action: "import",
    payload: {
      name: "Imported USD",
      version: 89,
      effectiveFrom: "2026-09-06",
      reason: "Review imported regional economics",
      document,
    },
  };
  const invalid = await handleDemoPriceBookCommand(
    request("import-invalid-authority-0001", {
      ...body,
      payload: {
        ...body.payload,
        document: { ...document, approvals: [{ approved: true }] },
      },
    }),
    finance,
    { store },
  );
  expect(invalid.status).toBe(422);
  expect(currentDemoPriceBooks(await store.read())).toEqual(before);
  const imported = await handleDemoPriceBookCommand(
    request("import-economics-0001", body),
    finance,
    { store },
  );
  expect(imported.status).toBe(200);
  const after = currentDemoPriceBooks(await store.read());
  expect(after.find((book) => book.id === source.id)).toEqual(source);
  const target = after.find((book) => book.id === id);
  expect(target).toMatchObject({
    status: "draft",
    rowVersion: 1,
    version: 89,
    effectiveTo: null,
    activationRequestedBy: null,
    importProvenance: {
      sourceAuthority: "unverified_uploaded_economics",
      approvalHistory: "not_imported",
    },
  });
  expect(target?.rateCards[0]?.unitPrice).toEqual(
    source.rateCards[0]?.unitPrice,
  );
  expect(target?.rateCards[0]?.id).not.toBe(source.rateCards[0]?.id);
  const replay = await handleDemoPriceBookCommand(
    request("import-economics-0001", body),
    finance,
    { store },
  );
  expect(replay.headers.get("idempotency-replayed")).toBe("true");
  expect(currentDemoPriceBooks(await store.read())).toHaveLength(
    before.length + 1,
  );
  const activate = await handleDemoPriceBookCommand(
    request("import-activate-0001", {
      id,
      action: "activate",
      expectedVersion: 1,
      payload: { reason: "Try uploaded approval bypass" },
    }),
    finance,
    { store },
  );
  expect(activate.status).toBe(422);
});
