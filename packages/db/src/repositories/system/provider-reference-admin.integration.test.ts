import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../../client";
import {
  auditEvents,
  commerceUsers,
  memberships,
  outboxMessages,
} from "../../schema";
import { systemProductionBootstraps } from "../../schema/system";
import { providerConnectionReferences } from "../../schema/system/provider-references";
import { DatabaseProviderReferenceAdmin } from "./provider-reference-admin";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());
it("retains bootstrap references, enforces current authority and stale writes, and audits registry changes atomically", async () => {
  const rollback = new Error("ROLLBACK_PROVIDER_REFERENCE_FIXTURE");
  const userId = randomUUID();
  const outcome = await db
    .transaction(async (outer) => {
      // Admin-only setup; every repository call below uses its real service role.
      await outer.insert(commerceUsers).values({
        id: userId,
        workosUserId: `provider-${userId}`,
        email: `provider-${userId}@clockwork.test`,
        name: "Provider operator",
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await outer.insert(memberships).values({
        userId,
        organizationId: "30000000-0000-4000-8000-000000000008",
        role: "internal_operator",
      });
      const provider = "document_renderer" as const;
      const reference = {
        provider,
        secretReference: "vault:commerce/renderer/key",
        secretVersion: "version-1",
        rotatedAt: "2026-09-01T12:00:00.000Z",
        sourceEvidence: "evidence:rotation-fixture",
      };
      await outer.insert(systemProductionBootstraps).values({
        id: randomUUID(),
        manifestHash: "a".repeat(64),
        manifest: { providerReferences: [reference] },
        appliedBy: userId,
        appliedAt: new Date("2099-01-01T00:00:00.000Z"),
      });
      await outer
        .delete(providerConnectionReferences)
        .where(eq(providerConnectionReferences.provider, provider));
      const nested = vi
        .spyOn(db, "transaction")
        .mockImplementation(outer.transaction.bind(outer));
      try {
        const repository = new DatabaseProviderReferenceAdmin(db);
        const actor = { kind: "user" as const, id: userId };
        const list = () => repository.list({ actor, requestId: randomUUID() });
        const initial = (await list()).find((row) => row.provider === provider);
        expect(initial).toMatchObject({
          source: "bootstrap",
          rowVersion: 0,
          configuration: { ...reference, reviewIntervalDays: 90 },
          reviewDueAt: "2026-11-30T12:00:00.000Z",
        });
        await expect(
          repository.list({
            actor: { kind: "user", id: randomUUID() },
            requestId: randomUUID(),
          }),
        ).rejects.toThrow("PROVIDER_REFERENCE_AUTHORITY_REQUIRED");
        const command = {
          ...reference,
          expectedRowVersion: 0,
          owner: "Commerce operations",
          reviewIntervalDays: 30,
          reason: "Verified completed provider rotation",
        };
        const save = (expectedRowVersion = 0) =>
          repository.save({
            actor,
            command: { ...command, expectedRowVersion },
            requestId: randomUUID(),
          });
        const id = await save();
        expect(
          (await list()).find((row) => row.provider === provider),
        ).toMatchObject({
          source: "registry",
          rowVersion: 1,
          configuration: {
            owner: "Commerce operations",
            reviewIntervalDays: 30,
          },
          reviewDueAt: "2026-10-01T12:00:00.000Z",
        });
        await expect(save()).rejects.toThrow(
          "PROVIDER_REFERENCE_VERSION_CONFLICT",
        );
        await save(1);
        const audits = await outer
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.aggregateId, id));
        expect(audits.map((row) => row.aggregateVersion).sort()).toEqual([
          1, 2,
        ]);
        expect(
          audits.every(
            (row) => row.eventType === "system.provider_reference.updated",
          ),
        ).toBe(true);
        const deliveries = await outer
          .select({ id: outboxMessages.id })
          .from(outboxMessages)
          .innerJoin(auditEvents, eq(auditEvents.id, outboxMessages.eventId))
          .where(eq(auditEvents.aggregateId, id));
        expect(deliveries).toHaveLength(2);
        for (const audit of audits) expect(audit.actor).toMatchObject(actor);
        await outer.delete(memberships).where(eq(memberships.userId, userId));
        await expect(save(2)).rejects.toThrow(
          "PROVIDER_REFERENCE_AUTHORITY_REQUIRED",
        );
        await expect(list()).rejects.toThrow(
          "PROVIDER_REFERENCE_AUTHORITY_REQUIRED",
        );
        await outer.execute(sql`set local role clockwork_runtime`);
        expect(
          await outer
            .select()
            .from(providerConnectionReferences)
            .catch(() => null),
        ).toBeNull();
      } finally {
        nested.mockRestore();
      }
      throw rollback;
    })
    .catch((error: unknown) => error);
  expect(outcome).toBe(rollback);
});
