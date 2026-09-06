import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ids } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../../client";
import {
  approvals,
  auditEvents,
  commerceUsers,
  memberships,
  priceBooks,
  rateCards,
} from "../../schema";
import { priceBookSchedules } from "../../schema/core/price-book-schedules";
import { systemCapabilities } from "../../schema/system";
import { providerResourceBindings } from "../../schema/system/providers";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabasePriceBookScheduleRepository } from "./price-book-schedules";
import { DatabasePriceBookAdministrationReader } from "./price-book-administration";
import { DatabaseCatalogAdmin } from "../system/catalog-admin";
import { FixtureTaxPort } from "./tax-fixture";

const url = process.env.DIRECT_DATABASE_URL;
const local =
  url && ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
const { db, client } = createRuntimeDatabase({
  url: url ?? "postgresql://localhost/clockwork",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

describe.skipIf(!local)("approved price-book schedules", () => {
  it("freezes exact approvals, honors controls and dates, cancels safely and executes only once", async () => {
    const rollback = new Error("ROLLBACK_SCHEDULE_FIXTURE");
    const result = await db
      .transaction(async (outer) => {
        await outer.execute(sql`set local role clockwork_service`);
        const proposer = randomUUID(),
          approver = randomUUID();
        for (const id of [proposer, approver]) {
          await outer.insert(commerceUsers).values({
            id,
            workosUserId: `schedule-${id}`,
            email: `schedule-${id}@clockwork.test`,
            name: "Schedule finance fixture",
            isInternalStaff: true,
            mfaEnrolled: true,
          });
          await outer.insert(memberships).values({
            userId: id,
            organizationId: "30000000-0000-4000-8000-000000000008",
            role: "finance_approver",
          });
        }
        const [template] = await outer.select().from(rateCards).limit(1);
        const [version] = await outer.execute<{ next: number }>(
          sql`select coalesce(max(version),0)+1 as next from price_books where currency='USD'`,
        );
        const incumbent = await outer.query.priceBooks.findFirst({
          where: and(
            eq(priceBooks.currency, "USD"),
            eq(priceBooks.status, "active"),
          ),
        });
        if (!template || !version || !incumbent)
          throw new Error("Missing price fixtures");
        const nested = vi
          .spyOn(db, "transaction")
          .mockImplementation(outer.transaction.bind(outer));
        try {
          const core = new DatabaseCoreFinanceRepository({
            database: db,
            pricingDatabase: db,
            authorizationSecret:
              process.env.AUTHORIZATION_CONTEXT_SECRET ??
              "clockwork-local-auth-context-secret-change-me",
            tax: new FixtureTaxPort(),
          });
          const worker = new DatabasePriceBookScheduleRepository(db);
          const read = <T>(
            run: (
              tx: Parameters<Parameters<typeof withInternalTransaction>[2]>[0],
            ) => Promise<T>,
          ) => withInternalTransaction(db, randomUUID(), run);
          const command = (
            id: string,
            action: string,
            payload: Record<string, unknown> = {},
            userId = proposer,
            mfa = true,
          ) =>
            core.mutate({
              resource: "price_books",
              id,
              action,
              payload,
              actor: { kind: "user", id: userId },
              authorization: {
                userId: ids.user.parse(userId),
                roles: ["finance_approver"],
                accountIds: [],
                isInternalStaff: true,
                mfaVerified: mfa,
                recentAuthenticationVerified: mfa,
              },
              requestId: randomUUID(),
              idempotencyKey: randomUUID(),
              occurredAt: "2026-09-06T12:00:00Z",
            });
          const reason = {
            reason: "Approve the exact future economics and effective window",
          };
          let offset = 0;
          const draft = async (from = "2026-09-08", to = "2026-09-09") => {
            const id = randomUUID(),
              rateId = randomUUID();
            await command(id, "create", {
              name: "Scheduled USD fixture",
              currency: "USD",
              version: version.next + offset++,
              effectiveFrom: from,
              effectiveTo: to,
            });
            await read(async (tx) => {
              await tx
                .insert(rateCards)
                .values({ ...template, id: rateId, priceBookId: id });
            });
            await command(id, "request_activation", reason);
            return { id, rateId };
          };
          const getBook = (id: string) =>
            read((tx) =>
              tx.query.priceBooks.findFirst({ where: eq(priceBooks.id, id) }),
            );
          const getSchedule = (id: string) =>
            read((tx) =>
              tx.query.priceBookSchedules.findFirst({
                where: and(
                  eq(priceBookSchedules.priceBookId, id),
                  eq(priceBookSchedules.status, "approved"),
                ),
              }),
            );
          const first = await draft();
          await expect(
            command(first.id, "schedule_activation", reason),
          ).rejects.toThrow("different finance approver");
          await expect(
            command(first.id, "schedule_activation", reason, approver, false),
          ).rejects.toThrow("recent MFA");
          await command(first.id, "schedule_activation", reason, approver);
          const schedule = await getSchedule(first.id);
          if (!schedule) throw new Error("Missing schedule");
          expect(
            (
              await new DatabasePriceBookAdministrationReader(db).list({
                limit: 500,
              })
            ).find((book) => book.id === first.id)?.activationSchedule,
          ).toMatchObject({
            status: "approved",
            effectiveFrom: "2026-09-08",
            effectiveTo: "2026-09-09",
          });
          expect(
            (await new DatabaseCatalogAdmin(db).list(randomUUID())).find(
              (rate) => rate.rateCardId === first.rateId,
            )?.editable,
          ).toBe(false);
          await expect(
            worker.execute(schedule.id, "2026-09-07T23:59:59Z"),
          ).resolves.toMatchObject({ status: "not_due" });
          expect(await getBook(incumbent.id)).toMatchObject({
            status: "active",
            rowVersion: incumbent.rowVersion,
          });
          await expect(
            command(first.id, "request_activation", reason),
          ).rejects.toThrow("frozen");
          await expect(
            read(async (tx) => {
              await tx
                .update(priceBooks)
                .set({ effectiveFrom: "2026-09-07" })
                .where(eq(priceBooks.id, first.id));
            }),
          ).rejects.toThrow();
          await expect(
            read(async (tx) => {
              await tx
                .update(rateCards)
                .set({ unitPriceMinor: 1n })
                .where(eq(rateCards.id, first.rateId));
            }),
          ).rejects.toThrow();
          await expect(
            read(async (tx) => {
              await tx.insert(providerResourceBindings).values({
                provider: "fil_one",
                providerResourceType: "sku_region",
                providerResourceId: `schedule-${first.rateId}`,
                aggregateType: "rate_card",
                aggregateId: first.rateId,
                binding: {
                  providerSku: "object",
                  providerRegion: "us",
                  meterId: "byte_hours",
                  sourceEvidence: "https://evidence.clockwork.test/mapping",
                },
              });
            }),
          ).rejects.toThrow();
          const conflicting = await draft();
          await expect(
            command(conflicting.id, "schedule_activation", reason, approver),
          ).rejects.toThrow("already has an approved schedule");
          const immediate = await draft("2026-09-01", "2026-09-30");
          await expect(
            command(immediate.id, "activate", reason, approver),
          ).rejects.toThrow("Cancel the approved schedule");
          await read(async (tx) => {
            await tx
              .update(systemCapabilities)
              .set({ enabled: false })
              .where(eq(systemCapabilities.capabilityKey, "new_business"));
          });
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:00:00Z"),
          ).rejects.toThrow("NEW_BUSINESS_DISABLED");
          expect(await getBook(incumbent.id)).toMatchObject({
            status: "active",
          });
          await read(async (tx) => {
            await tx
              .update(systemCapabilities)
              .set({ enabled: true })
              .where(eq(systemCapabilities.capabilityKey, "new_business"));
            await tx
              .delete(memberships)
              .where(eq(memberships.userId, approver));
          });
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:00:00Z"),
          ).rejects.toThrow("no longer eligible");
          await read(async (tx) => {
            await tx.insert(memberships).values({
              userId: approver,
              organizationId: "30000000-0000-4000-8000-000000000008",
              role: "finance_approver",
            });
          });
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:00:00Z"),
          ).resolves.toMatchObject({ status: "executed", replayed: false });
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:01:00Z"),
          ).resolves.toMatchObject({ status: "executed", replayed: true });
          expect(await getBook(first.id)).toMatchObject({
            status: "active",
            effectiveTo: "2026-09-09",
          });
          expect(await getBook(incumbent.id)).toMatchObject({
            status: "retired",
          });
          const audits = await read((tx) =>
            tx
              .select()
              .from(auditEvents)
              .where(
                and(
                  eq(auditEvents.aggregateId, first.id),
                  eq(
                    auditEvents.eventType,
                    "core.price_books.scheduled_activation",
                  ),
                ),
              ),
          );
          expect(audits).toHaveLength(1);
          expect(audits[0]?.actor).toMatchObject({ kind: "system" });
          await command(
            conflicting.id,
            "schedule_activation",
            reason,
            approver,
          );
          const cancelled = await getSchedule(conflicting.id);
          if (!cancelled) throw new Error("Missing cancellation schedule");
          await command(conflicting.id, "cancel_schedule", {
            reason: "Cancel the schedule and reopen reviewed pricing",
          });
          await expect(
            worker.execute(cancelled.id, "2026-09-08T00:00:00Z"),
          ).resolves.toMatchObject({ status: "cancelled", replayed: true });
          await read(async (tx) => {
            await tx
              .update(rateCards)
              .set({ unitPriceMinor: template.unitPriceMinor + 1n })
              .where(eq(rateCards.id, conflicting.rateId));
          });
          const expired = await draft("2026-09-10", "2026-09-10");
          await command(expired.id, "schedule_activation", reason, approver);
          const expiring = await getSchedule(expired.id);
          if (!expiring) throw new Error("Missing expiry schedule");
          let clockReads = 0;
          const delayedWorker = new DatabasePriceBookScheduleRepository(
            db,
            () =>
              new Date(
                clockReads++ === 0
                  ? "2026-09-10T23:59:59Z"
                  : "2026-09-11T00:00:01Z",
              ),
          );
          await expect(
            delayedWorker.execute(expiring.id),
          ).resolves.toMatchObject({ status: "expired" });
          expect(await getBook(first.id)).toMatchObject({ status: "active" });
          expect(await getBook(expired.id)).toMatchObject({ status: "draft" });
          expect(
            await read((tx) =>
              tx.query.approvals.findFirst({
                where: eq(approvals.id, schedule.approvalId),
              }),
            ),
          ).toMatchObject({ status: "approved", approvedBy: approver });
        } finally {
          nested.mockRestore();
        }
        throw rollback;
      })
      .catch((error: unknown) => error);
    expect(result).toBe(rollback);
  }, 20000);
});
