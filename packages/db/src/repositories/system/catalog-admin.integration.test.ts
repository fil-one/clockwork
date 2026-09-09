import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../../client";
import {
  approvals,
  auditEvents,
  commerceUsers,
  memberships,
  outboxMessages,
  priceBooks,
  rateCards,
} from "../../schema";
import { providerResourceBindings } from "../../schema/system/providers";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCatalogAdmin } from "./catalog-admin";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
if (!local)
  throw new Error("Integration tests require a loopback database URL");
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

describe("catalog mapping repository transaction", () => {
  it("audits draft writes, refuses stale and frozen changes, and leaves no fixture history", async () => {
    const rollback = new Error("ROLLBACK_CATALOG_FIXTURE");
    const bookId = randomUUID(),
      rateId = randomUUID(),
      userId = randomUUID();
    const result = await db
      .transaction(async (outer) => {
        await outer.execute(sql`set local role clockwork_service`);
        await outer.insert(commerceUsers).values({
          id: userId,
          workosUserId: `catalog-${userId}`,
          email: `catalog-${userId}@clockwork.test`,
          name: "Catalog operator fixture",
          isInternalStaff: true,
          mfaEnrolled: true,
        });
        await outer.insert(memberships).values({
          userId,
          organizationId: "30000000-0000-4000-8000-000000000008",
          role: "internal_operator",
        });
        const [template] = await outer.select().from(rateCards).limit(1);
        if (!template) throw new Error("Missing seeded rate template");
        const [version] = await outer.execute<{ next: number }>(
          sql`select coalesce(max(version),0)+1 as next from price_books where currency='USD'`,
        );
        if (!version) throw new Error("Missing next catalog version");
        await outer.insert(priceBooks).values({
          id: bookId,
          name: "Catalog integration draft",
          currency: "USD",
          version: version.next,
          effectiveFrom: "2026-09-01",
          status: "draft",
        });
        await outer.insert(rateCards).values({
          ...template,
          id: rateId,
          priceBookId: bookId,
          sku: `catalog-${rateId}`,
        });

        // Real repository transactions run as savepoints inside this rollback-only
        // fixture. All actual service role checks, SQL guards and audit writes run.
        const nested = vi
          .spyOn(db, "transaction")
          .mockImplementation(outer.transaction.bind(outer));
        try {
          const repository = new DatabaseCatalogAdmin(db);
          const command = {
            rateCardId: rateId,
            expectedRowVersion: 1,
            providerSku: "object",
            providerRegion: "fr",
            meterId: "byte_hours",
            sourceEvidence: "evidence:catalog-fixture",
            reason: "Verified provider mapping fixture",
          };
          const save = (
            change: Partial<typeof command> = {},
            actorId = userId,
          ) =>
            repository.save({
              command: { ...command, ...change },
              actor: { kind: "user", id: actorId },
              requestId: randomUUID(),
            });
          await expect(save({}, randomUUID())).rejects.toThrow(
            "CATALOG_AUTHORITY_REQUIRED",
          );
          await save();
          const first = (await repository.list(randomUUID())).find(
            (row) => row.rateCardId === rateId,
          );
          expect(first).toMatchObject({
            rowVersion: 2,
            editable: true,
            mapping: { meterId: "byte_hours" },
          });
          await expect(save()).rejects.toThrow("CATALOG_VERSION_CONFLICT");
          await save({ expectedRowVersion: 2, meterId: "storage_byte_hours" });
          await withInternalTransaction(db, randomUUID(), async (tx) => {
            await tx.insert(approvals).values({
              action: "price_book_activation",
              objectType: "price_book",
              objectId: bookId,
              requestedBy: userId,
              status: "pending",
            });
          });
          await expect(save({ expectedRowVersion: 3 })).rejects.toThrow(
            "CATALOG_DRAFT_FROZEN",
          );
          const persisted = await withInternalTransaction(
            db,
            randomUUID(),
            async (tx) => ({
              audits: await tx
                .select()
                .from(auditEvents)
                .where(eq(auditEvents.aggregateId, bookId))
                .orderBy(auditEvents.aggregateVersion),
              bindings: await tx
                .select()
                .from(providerResourceBindings)
                .where(eq(providerResourceBindings.aggregateId, rateId)),
              deliveries: await tx
                .select({ id: outboxMessages.id })
                .from(outboxMessages)
                .innerJoin(
                  auditEvents,
                  eq(auditEvents.id, outboxMessages.eventId),
                )
                .where(eq(auditEvents.aggregateId, bookId)),
            }),
          );
          expect(persisted.bindings).toHaveLength(1);
          expect(persisted.bindings[0]?.binding).toMatchObject({
            meterId: "storage_byte_hours",
          });
          expect(persisted.audits).toHaveLength(2);
          expect(persisted.audits.map((row) => row.aggregateVersion)).toEqual([
            2, 3,
          ]);
          expect(
            persisted.audits.every(
              (row) => row.eventType === "core.catalog.mapping_updated",
            ),
          ).toBe(true);
          expect(persisted.deliveries).toHaveLength(2);
          expect(
            (await repository.list(randomUUID())).find(
              (row) => row.rateCardId === rateId,
            )?.editable,
          ).toBe(false);
        } finally {
          nested.mockRestore();
        }
        throw rollback;
      })
      .catch((error: unknown) => error);
    expect(result).toBe(rollback);
    const remaining = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select({ id: priceBooks.id })
        .from(priceBooks)
        .where(eq(priceBooks.id, bookId)),
    );
    expect(remaining).toHaveLength(0);
  });
});
