import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { approvals, priceBooks, rateCards } from "../../schema";
import { priceBookActivationEvents } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreFinanceRepository } from "./database-finance";
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
