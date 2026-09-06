import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { ids } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../../client";
import { approvals, priceBooks, rateCards } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { findActiveCustomerQuoteOffers } from "../experience/quote-offers";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

const url = process.env.DIRECT_DATABASE_URL;
const local =
  url && ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
const connection = createRuntimeDatabase({
  url: url ?? "postgresql://localhost/clockwork",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => connection.client.end());

describe.skipIf(!local)(
  "bounded price-book activation and offer discovery",
  () => {
    it("keeps approved dates, rejects expired/future drafts, and offers the inclusive final day", async () => {
      const { db } = connection;
      const rollback = new Error("ROLLBACK_PRICE_BOOK_WINDOW_FIXTURE");
      const result = await db
        .transaction(async (outer) => {
          await outer.execute(sql`set local role clockwork_service`);
          const [template] = await outer.select().from(rateCards).limit(1);
          const [latest] = await outer.execute<{ next: number }>(
            sql`select coalesce(max(version),0)+1 as next from price_books where currency='USD'`,
          );
          if (!template || !latest)
            throw new Error("Missing price-book fixture template");
          const previous = await outer.query.priceBooks.findFirst({
            where: sql`${priceBooks.currency}='USD' and ${priceBooks.status}='active'`,
          });
          if (!previous) throw new Error("Missing current USD pricing");
          const nested = vi
            .spyOn(db, "transaction")
            .mockImplementation(outer.transaction.bind(outer));
          try {
            const repository = new DatabaseCoreFinanceRepository({
              database: db,
              pricingDatabase: db,
              authorizationSecret:
                process.env.AUTHORIZATION_CONTEXT_SECRET ??
                "clockwork-local-auth-context-secret-change-me",
              tax: new FixtureTaxPort(),
            });
            const command = (
              id: string,
              action: string,
              payload: Record<string, unknown>,
              approving = false,
            ) => {
              const userId = approving
                ? "20000000-0000-4000-8000-000000000002"
                : "20000000-0000-4000-8000-000000000001";
              return repository.mutate({
                resource: "price_books",
                id,
                action,
                payload,
                actor: { kind: "user", id: userId },
                authorization: {
                  userId: ids.user.parse(userId),
                  accountIds: [],
                  roles: ["finance_approver"],
                  isInternalStaff: true,
                  mfaVerified: true,
                  recentAuthenticationVerified: true,
                },
                requestId: randomUUID(),
                idempotencyKey: randomUUID(),
                occurredAt: "2026-09-06T23:59:59Z",
              });
            };
            const draft = async (offset: number, from: string, to: string) => {
              const id = randomUUID();
              await command(id, "create", {
                name: "Bounded pricing fixture",
                currency: "USD",
                effectiveFrom: from,
                effectiveTo: to,
                version: latest.next + offset,
              });
              await withInternalTransaction(db, randomUUID(), (tx) =>
                tx
                  .insert(rateCards)
                  .values({ ...template, id: randomUUID(), priceBookId: id }),
              );
              await command(id, "request_activation", {
                reason: "Review the exact bounded effective window",
              });
              return id;
            };
            const read = (id: string) =>
              withInternalTransaction(db, randomUUID(), (tx) =>
                tx.query.priceBooks.findFirst({ where: eq(priceBooks.id, id) }),
              );
            for (const [offset, from, to, error] of [
              [0, "2026-09-01", "2026-09-05", "after its effective end date"],
              [1, "2026-09-07", "2026-09-30", "before its effective date"],
            ] as const) {
              const id = await draft(offset, from, to);
              await expect(
                command(
                  id,
                  "activate",
                  { reason: "Second finance review" },
                  true,
                ),
              ).rejects.toThrow(error);
              expect(await read(id)).toMatchObject({
                status: "draft",
                effectiveTo: to,
              });
              expect(await read(previous.id)).toMatchObject({
                status: "active",
                rowVersion: previous.rowVersion,
              });
              const approval = await withInternalTransaction(
                db,
                randomUUID(),
                (tx) =>
                  tx.query.approvals.findFirst({
                    where: eq(approvals.objectId, id),
                  }),
              );
              expect(approval).toMatchObject({
                status: "pending",
                approvedBy: null,
              });
            }
            const id = await draft(2, "2026-09-01", "2026-09-06");
            await command(
              id,
              "activate",
              { reason: "Second finance approves the bounded final day" },
              true,
            );
            expect(await read(id)).toMatchObject({
              status: "active",
              effectiveTo: "2026-09-06",
            });
            const offers = (at: string) =>
              withInternalTransaction(db, randomUUID(), (tx) =>
                findActiveCustomerQuoteOffers(tx, {
                  currency: "USD",
                  now: new Date(at),
                }),
              );
            expect(
              (await offers("2026-09-06T23:59:59Z")).map(
                (entry) => entry.price_book_id,
              ),
            ).toContain(id);
            expect(
              (await offers("2026-09-07T00:00:00Z")).map(
                (entry) => entry.price_book_id,
              ),
            ).not.toContain(id);
          } finally {
            nested.mockRestore();
          }
          throw rollback;
        })
        .catch((error: unknown) => error);
      expect(result).toBe(rollback);
    });
  },
);
