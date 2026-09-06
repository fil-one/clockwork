import { providerResourceBindings } from "../../schema/system/providers";
import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { ids } from "@clockwork/contracts";
import { exportPriceBookExchange } from "@clockwork/domain/core";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { approvals, auditEvents, priceBooks, rateCards } from "../../schema";
import { priceBookActivationEvents } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabasePriceBookAdministrationReader } from "./price-book-administration";
import { FixtureTaxPort } from "./tax-fixture";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const proposerId = "20000000-0000-4000-8000-000000000001";
const approverId = "20000000-0000-4000-8000-000000000002";
const occurredAt = "2026-08-01T16:00:00.000Z";
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
// Published version is unique per currency and price books are never deleted,
// so each run claims its own band of Sterling versions.
const versionBase = 1_000 + (Number.parseInt(runId.slice(0, 6), 16) % 900_000);

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});

const finance = (userId: string): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: [],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

const command = (input: {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  userId?: string;
  roles?: AuthorizationContext["roles"];
  expectedVersion?: number;
  key: string;
}) =>
  repository.mutate({
    resource: "price_books",
    id: input.id,
    action: input.action,
    payload: input.payload,
    actor: { kind: "user", id: input.userId ?? proposerId },
    authorization: {
      ...finance(input.userId ?? proposerId),
      ...(input.roles ? { roles: input.roles } : {}),
    },
    requestId: `price-book-${input.key}-${runId}`,
    idempotencyKey: `price-book-${input.key}-${runId}`,
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: input.expectedVersion }),
    occurredAt,
  });

const money = (minor: string) => ({ currency: "GBP", minor });

const rate = (sku: string, overrides: Record<string, unknown> = {}) => ({
  sku,
  region: "uk-south",
  unit: "TB-month",
  approvedClaim: "Fictional immutable storage capacity",
  unitPrice: money("15000"),
  floorPrice: money("10000"),
  overageRate: money("18000"),
  minimumQuantity: "1",
  egressTreatment: "metered",
  commitType: "term_drawdown",
  stripeTaxCode: "txcd_demo",
  qboIncomeAccount: "4000-Storage",
  partnerTransferPrices: {},
  ...overrides,
});

const createDraft = async (offset: number, key: string) => {
  const version = versionBase + offset;
  const id = randomUUID();
  await command({
    id,
    action: "create",
    payload: {
      name: `Sterling rate card ${version}`,
      currency: "GBP",
      effectiveFrom: "2026-01-01",
      version,
    },
    key: `create-${key}`,
  });
  await command({
    id,
    action: "add_rate",
    payload: rate("LOCKED-STORAGE-TB"),
    key: `rate-${key}`,
  });
  return id;
};

it("keeps review counts, version and rate details coherent across a concurrent edit", async () => {
  const bookId = await createDraft(48, "coherent-reader");
  const readerConnection = createRuntimeDatabase({
    url: databaseUrl,
    role: "clockwork_service",
    ssl: false,
  });
  const transaction = readerConnection.db.transaction.bind(readerConnection.db);
  let mutation: ReturnType<typeof command> | undefined;
  const intercept = vi.spyOn(readerConnection.db, "transaction");
  intercept.mockImplementation((operation, options) =>
    transaction(async (tx) => {
      const findMany = tx.query.rateCards.findMany.bind(tx.query.rateCards);
      // Pause actual detail execution after the parent's aggregate SELECT has
      // completed, then commit through another database connection. All reads
      // and writes remain real PostgreSQL queries; only their order is fixed.
      vi.spyOn(tx.query.rateCards, "findMany").mockImplementation((config) => {
        const query = findMany(config);
        const execute = query.execute.bind(query);
        vi.spyOn(query, "execute").mockImplementation(async () => {
          mutation ??= command({
            id: bookId,
            action: "add_rate",
            payload: rate("SECOND-COHERENT-RATE"),
            key: "coherent-concurrent-add",
          });
          await mutation;
          return execute();
        });
        return query;
      });
      return operation(tx);
    }, options),
  );
  try {
    const reader = new DatabasePriceBookAdministrationReader(
      readerConnection.db,
    );
    const during = (await reader.list({ limit: 500 })).find(
      (book) => book.id === bookId,
    );
    expect(mutation).toBeDefined();
    expect(during).toMatchObject({ rowVersion: 2, rateCardCount: 1 });
    expect(during?.rateCards).toHaveLength(1);
    expect(during?.rateCards?.[0]?.sku).toBe("LOCKED-STORAGE-TB");
    intercept.mockRestore();
    const after = (await reader.list({ limit: 500 })).find(
      (book) => book.id === bookId,
    );
    expect(after).toMatchObject({ rowVersion: 3, rateCardCount: 2 });
    expect(after?.rateCards).toHaveLength(2);
  } finally {
    intercept.mockRestore();
    await readerConnection.client.end();
  }
});

const readBook = (id: string, label: string) =>
  withInternalTransaction(db, `price-book-read-${label}-${runId}`, (tx) =>
    tx.query.priceBooks.findFirst({ where: eq(priceBooks.id, id) }),
  );

const readActivationEvents = (id: string, label: string) =>
  withInternalTransaction(db, `price-book-events-${label}-${runId}`, (tx) =>
    tx.query.priceBookActivationEvents.findMany({
      where: eq(priceBookActivationEvents.priceBookId, id),
      orderBy: [asc(priceBookActivationEvents.createdAt)],
    }),
  );

afterAll(async () => client.end());

describe.sequential("finance price-book activation", () => {
  it("carries a draft through two authorities into active price", async () => {
    const first = await createDraft(41, "first");

    const rates = await withInternalTransaction(
      db,
      `price-book-rates-${runId}`,
      (tx) =>
        tx.query.rateCards.findMany({
          where: eq(rateCards.priceBookId, first),
        }),
    );
    expect(rates).toHaveLength(1);

    await command({
      id: first,
      action: "request_activation",
      payload: {
        reason: "Sterling launch approved by commercial policy CP-2.",
      },
      key: "request-first",
    });
    const requested = await withInternalTransaction(
      db,
      `price-book-approval-${runId}`,
      (tx) =>
        tx.query.approvals.findFirst({
          where: eq(approvals.objectId, first),
        }),
    );
    expect(requested).toMatchObject({
      action: "price_book_activation",
      objectType: "price_book",
      status: "pending",
      requestedBy: proposerId,
      approvedBy: null,
    });
    expect(await readBook(first, "still-draft")).toMatchObject({
      status: "draft",
    });

    const activation = await command({
      id: first,
      action: "activate",
      payload: {
        reason: "Second finance authority confirms floors and route.",
      },
      userId: approverId,
      key: "activate-first",
    });
    expect(activation.record.data).toMatchObject({
      status: "active",
      activationRequestedBy: proposerId,
      activationApprovedBy: approverId,
    });
    expect(await readBook(first, "active")).toMatchObject({ status: "active" });
    expect(
      await withInternalTransaction(db, `price-book-decided-${runId}`, (tx) =>
        tx.query.approvals.findFirst({ where: eq(approvals.objectId, first) }),
      ),
    ).toMatchObject({ status: "approved", approvedBy: approverId });

    const events = await readActivationEvents(first, "first");
    expect(events.map((event) => event.action)).toEqual([
      "schedule",
      "activate",
    ]);
    expect(events[1]).toMatchObject({
      previousStatus: "draft",
      resultingStatus: "active",
      actorUserId: approverId,
    });
  });

  it("retires the incumbent of the same currency in one transaction", async () => {
    const second = await createDraft(42, "second");
    await command({
      id: second,
      action: "request_activation",
      payload: { reason: "Sterling refresh for the new commercial term." },
      key: "request-second",
    });
    const activation = await command({
      id: second,
      action: "activate",
      payload: { reason: "Second authority confirms the refreshed floors." },
      userId: approverId,
      key: "activate-second",
    });

    const retired = (
      activation.record.data as { retiredPriceBookIds?: string[] }
    ).retiredPriceBookIds;
    expect(retired).toHaveLength(1);
    const incumbent = retired?.[0];
    if (!incumbent) throw new Error("no retired price book was reported");
    expect(await readBook(incumbent, "retired")).toMatchObject({
      status: "retired",
      effectiveTo: "2026-08-01",
    });
    expect(await readBook(second, "second-active")).toMatchObject({
      status: "active",
    });
    const events = await readActivationEvents(incumbent, "incumbent");
    expect(events.at(-1)).toMatchObject({
      action: "retire",
      previousStatus: "active",
      resultingStatus: "retired",
    });
  });

  it("refuses an approver who is the person that requested activation", async () => {
    const book = await createDraft(43, "self");
    await command({
      id: book,
      action: "request_activation",
      payload: { reason: "Proposed by the same finance approver on purpose." },
      key: "request-self",
    });
    await expect(
      command({
        id: book,
        action: "activate",
        payload: { reason: "Attempting to approve my own activation request." },
        key: "activate-self",
      }),
    ).rejects.toThrow("cannot be the person who requested it");
    expect(await readBook(book, "self-draft")).toMatchObject({
      status: "draft",
    });
  });

  it("refuses activation that no one has requested", async () => {
    const book = await createDraft(44, "unrequested");
    await expect(
      command({
        id: book,
        action: "activate",
        payload: { reason: "Activating without a recorded first authority." },
        userId: approverId,
        key: "activate-unrequested",
      }),
    ).rejects.toThrow("requires a pending request");
  });

  it("revalidates the guardrails before a rate joins a draft", async () => {
    const book = await createDraft(45, "guardrail");
    await expect(
      command({
        id: book,
        action: "add_rate",
        payload: rate("LOCKED-STORAGE-TB"),
        key: "duplicate-rate",
      }),
    ).rejects.toThrow("Duplicate SKU/region rate");
    await expect(
      command({
        id: book,
        action: "add_rate",
        payload: rate("MIXED-CURRENCY", {
          unitPrice: { currency: "USD", minor: "15000" },
        }),
        key: "wrong-currency-rate",
      }),
    ).rejects.toThrow("price book currency");
  });

  it("refuses a stale read and a caller without finance authority", async () => {
    const book = await createDraft(46, "stale");
    await expect(
      command({
        id: book,
        action: "request_activation",
        payload: { reason: "Requesting against a version we did not read." },
        expectedVersion: 999,
        key: "stale-request",
      }),
    ).rejects.toThrow("changed since it was read");
    await expect(
      command({
        id: book,
        action: "request_activation",
        payload: { reason: "Requesting without finance approval authority." },
        roles: ["internal_operator"],
        key: "unauthorized-request",
      }),
    ).rejects.toThrow("Finance approval authority is required");
  });
});

it("edits draft economics and freezes the exact proposed content until rejection", async () => {
  const book = await createDraft(47, "editable");
  const rates = await withInternalTransaction(
    db,
    `editable-rate-${runId}`,
    (tx) =>
      tx.query.rateCards.findMany({ where: eq(rateCards.priceBookId, book) }),
  );
  const first = rates[0];
  if (!first) throw new Error("Missing draft rate");
  await command({
    id: book,
    action: "update_rate",
    payload: rate("LOCKED-STORAGE-TB", {
      id: first.id,
      unitPrice: money("15100"),
    }),
    key: "edit-rate",
  });
  await command({
    id: book,
    action: "add_rate",
    payload: rate("SECOND-SKU"),
    key: "second-rate",
  });
  await command({
    id: book,
    action: "update_discount_matrix",
    payload: {
      id: "test-matrix",
      version: 1,
      defaultMaxDiscountBps: 0,
      rules: [{ id: "volume", minQuantity: "100", maxDiscountBps: 300 }],
    },
    key: "edit-matrix",
  });
  await command({
    id: book,
    action: "request_activation",
    payload: { reason: "First authority attests exact saved economics." },
    key: "freeze-edit",
  });
  await expect(
    command({
      id: book,
      action: "remove_rate",
      payload: { id: first.id },
      key: "frozen-remove",
    }),
  ).rejects.toThrow("frozen");
  await expect(
    command({
      id: book,
      action: "reject_activation",
      payload: { reason: "Attempting rejection by the proposer." },
      key: "self-reject",
    }),
  ).rejects.toThrow("different finance");
  await command({
    id: book,
    action: "reject_activation",
    payload: { reason: "Please correct the regional minimum." },
    userId: approverId,
    key: "reject-edit",
  });
  await command({
    id: book,
    action: "remove_rate",
    payload: { id: first.id },
    key: "reopened-remove",
  });
  expect(
    await withInternalTransaction(db, `edited-read-${runId}`, (tx) =>
      tx.query.rateCards.findMany({ where: eq(rateCards.priceBookId, book) }),
    ),
  ).toHaveLength(1);
});

it("clones a coherent multi-rate source into a fresh draft with retained provenance and independent economics", async () => {
  const sourceId = await createDraft(60, "clone-source");
  const extra = rate("PRECISE-SECOND-RATE", {
    minimumQuantity: "0.123456789123456789",
    trialLimit: "0.000000000000000001",
    partnerTransferPrices: { gold: money("12000") },
  });
  const { floorPrice: removedFloor, ...withoutFloor } = extra;
  expect(removedFloor).toEqual(money("10000"));
  await command({
    id: sourceId,
    action: "add_rate",
    payload: withoutFloor,
    key: "clone-second-rate",
  });
  await command({
    id: sourceId,
    action: "update_discount_matrix",
    payload: {
      id: "source-matrix",
      version: 7,
      defaultMaxDiscountBps: 250,
      rules: [{ id: "gold", partnerTier: "gold", maxDiscountBps: 300 }],
    },
    key: "clone-discounts",
  });
  const snapshot = () =>
    withInternalTransaction(db, randomUUID(), async (tx) => ({
      book: await tx.query.priceBooks.findFirst({
        where: eq(priceBooks.id, sourceId),
      }),
      rates: await tx
        .select()
        .from(rateCards)
        .where(eq(rateCards.priceBookId, sourceId))
        .orderBy(asc(rateCards.sku)),
    }));
  const source = await snapshot();
  if (!source.book || !source.rates[0]) throw new Error("Missing clone source");
  await withInternalTransaction(db, randomUUID(), (tx) =>
    tx.insert(providerResourceBindings).values({
      provider: "fil_one",
      providerResourceType: "sku_region",
      providerResourceId: `clone-source-${runId}`,
      aggregateType: "rate_card",
      aggregateId: source.rates[0]?.id ?? "",
      binding: {
        providerSku: "storage",
        providerRegion: "uk",
        meterId: "storage_bytes",
        sourceEvidence: "https://example.test/source",
      },
    }),
  );
  await command({
    id: sourceId,
    action: "request_activation",
    payload: { reason: "Source proposal must not transfer to clone" },
    key: "clone-source-proposed",
  });
  const proposed = await snapshot();
  if (!proposed.book) throw new Error("Missing proposed source");
  const target = randomUUID();
  const payload = {
    sourceId,
    sourceRowVersion: proposed.book.rowVersion,
    name: "Cloned Sterling economics",
    version: versionBase + 61,
    effectiveFrom: "2026-09-01",
    reason: "Prepare independently reviewed draft",
  };
  const cloned = await command({
    id: target,
    action: "clone",
    payload,
    key: "clone-target",
  });
  expect(cloned.record).toMatchObject({
    id: target,
    rowVersion: 1,
    data: {
      status: "draft",
      currency: "GBP",
      effectiveTo: null,
      rateCardCount: 2,
      discountMatrix: {
        id: `discount-${target}`,
        version: 1,
        defaultMaxDiscountBps: 250,
      },
      cloneProvenance: {
        sourceId,
        sourceRowVersion: proposed.book.rowVersion,
        providerMappings: "not_copied_requires_review",
      },
    },
  });
  expect(await snapshot()).toEqual(proposed);
  const saved = await withInternalTransaction(db, randomUUID(), async (tx) => ({
    rates: await tx
      .select()
      .from(rateCards)
      .where(eq(rateCards.priceBookId, target))
      .orderBy(asc(rateCards.sku)),
    approvals: await tx
      .select()
      .from(approvals)
      .where(eq(approvals.objectId, target)),
    events: await tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.aggregateId, target)),
  }));
  expect(saved.approvals).toHaveLength(0);
  expect(saved.rates).toHaveLength(2);
  const economics = (rows: typeof saved.rates) =>
    rows.map(
      ({
        id: _id,
        priceBookId: _bookId,
        createdAt: _createdAt,
        version: _version,
        ...value
      }) => value,
    );
  expect(economics(saved.rates)).toEqual(economics(proposed.rates));
  expect(
    saved.rates.every(
      (row) => !proposed.rates.some((prior) => prior.id === row.id),
    ),
  ).toBe(true);
  const copiedBindingCount = await withInternalTransaction(
    db,
    randomUUID(),
    async (tx) => {
      const mappings = await tx.select().from(providerResourceBindings);
      return mappings.filter((mapping) =>
        saved.rates.some((row) => row.id === mapping.aggregateId),
      ).length;
    },
  );
  expect(copiedBindingCount).toBe(0);
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0]?.eventType).toBe("core.price_books.clone");
  expect(saved.events[0]?.before).toMatchObject({
    sourceBook: { id: sourceId, rowVersion: proposed.book.rowVersion },
    sourceRates: proposed.rates,
  });
  expect(
    await command({
      id: target,
      action: "clone",
      payload,
      key: "clone-target",
    }),
  ).toEqual(cloned);
  await expect(
    command({
      id: randomUUID(),
      action: "clone",
      payload: {
        ...payload,
        version: versionBase + 62,
        sourceRowVersion: proposed.book.rowVersion - 1,
      },
      key: "clone-stale",
    }),
  ).rejects.toThrow("Source price book changed");
  await expect(
    command({
      id: target,
      action: "activate",
      payload: { reason: "Try inherited source approval" },
      key: "clone-unapproved-activate",
    }),
  ).rejects.toThrow("pending request");
  await command({
    id: target,
    action: "add_rate",
    expectedVersion: 1,
    payload: rate("NEW-CLONE-ONLY-RATE"),
    key: "clone-edit",
  });
  expect(await snapshot()).toEqual(proposed);
  await expect(
    command({
      id: randomUUID(),
      action: "clone",
      roles: ["internal_operator"],
      payload: { ...payload, version: versionBase + 62 },
      key: "clone-not-finance",
    }),
  ).rejects.toThrow("Finance approval authority");
});

it("returns one clear conflict when two clones claim the same currency/version", async () => {
  const sourceId = await createDraft(63, "clone-race-source");
  const source = await readBook(sourceId, "clone-race-source");
  if (!source) throw new Error("Missing source");
  const payload = {
    sourceId,
    sourceRowVersion: source.rowVersion,
    name: "Concurrent clone",
    version: versionBase + 64,
    effectiveFrom: "2026-09-01",
    reason: "Concurrent finance clone request",
  };
  const results = await Promise.allSettled([
    command({
      id: randomUUID(),
      action: "clone",
      payload,
      key: "clone-race-a",
    }),
    command({
      id: randomUUID(),
      action: "clone",
      payload,
      key: "clone-race-b",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failure = results.find((result) => result.status === "rejected");
  expect(
    failure?.status === "rejected" ? failure.reason : undefined,
  ).toMatchObject({ code: "DUPLICATE" });
});

it("imports lossless uploaded economics with fresh identities, audit evidence and no authority", async () => {
  const sourceId = await createDraft(70, "import-source");
  const reader = new DatabasePriceBookAdministrationReader(db);
  const source = (await reader.list({ limit: 500 })).find(
    (book) => book.id === sourceId,
  );
  if (!source) throw new Error("Import source missing");
  const document = exportPriceBookExchange(source, occurredAt);
  const first = document.rateCards[0];
  if (!first) throw new Error("Import source rate missing");
  first.minimumQuantity = "0.123456789123456789";
  first.unitPrice = {
    ...first.unitPrice,
    minor: "9007199254740993" as typeof first.unitPrice.minor,
  };
  const id = randomUUID();
  const payload = {
    name: "Imported Sterling economics",
    version: versionBase + 71,
    effectiveFrom: "2026-08-01",
    reason: "Review imported regional economics",
    document,
  };
  for (const invalid of [
    { ...document, status: "active" },
    {
      ...document,
      rateCards: [{ ...first, unitPrice: { currency: "GBP", minor: "abc" } }],
    },
    { ...document, unexpected: "a".repeat(1_048_576) },
  ]) {
    await expect(
      command({
        id,
        action: "import",
        key: randomUUID(),
        payload: { ...payload, document: invalid },
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  }
  const imported = await command({
    id,
    action: "import",
    key: "import-economics",
    payload,
  });
  expect(imported.record).toMatchObject({
    rowVersion: 1,
    data: {
      status: "draft",
      effectiveTo: null,
      rateCardCount: 1,
      importProvenance: {
        source: document.source,
        documentHashKind: "normalized_validated_economics_sha256",
        providerMappings: "not_imported_requires_review",
        approvalHistory: "not_imported",
      },
    },
  });
  const saved = await withInternalTransaction(db, randomUUID(), async (tx) => ({
    rates: await tx
      .select()
      .from(rateCards)
      .where(eq(rateCards.priceBookId, id)),
    approvals: await tx
      .select()
      .from(approvals)
      .where(eq(approvals.objectId, id)),
    events: await tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.aggregateId, id)),
  }));
  expect(saved.rates[0]?.unitPriceMinor).toBe(9007199254740993n);
  expect(saved.rates[0]?.minimumQuantity).toBe("0.123456789123456789");
  expect(saved.rates[0]?.id).not.toBe(first.id);
  expect(saved.approvals).toHaveLength(0);
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0]?.before).toMatchObject({ importDocument: document });
  expect(
    await command({ id, action: "import", key: "import-economics", payload }),
  ).toEqual(imported);
  await expect(
    command({
      id: randomUUID(),
      action: "import",
      key: "import-duplicate",
      payload,
    }),
  ).rejects.toMatchObject({ code: "DUPLICATE" });
  await expect(
    command({
      id,
      action: "activate",
      key: "import-no-proposal",
      userId: approverId,
      expectedVersion: 1,
      payload: { reason: "Try importing approval authority" },
    }),
  ).rejects.toThrow("pending request");
});
