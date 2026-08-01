import { randomUUID } from "node:crypto";

import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  exceptionCases,
  outboxMessages,
} from "../../schema";
import { systemExceptionRoster } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseExceptionRosterAdminService,
  DatabasePersistedWorkflowExceptionRouting,
} from "./exception-routing";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const requestPrefix = "integration:persisted-exception-routing";
const accountId = "71000000-0000-4000-8000-000000000001";
const caseId = randomUUID();
const objectId = randomUUID();
const users = {
  operator: "72000000-0000-4000-8000-000000000001",
  primary: "72000000-0000-4000-8000-000000000002",
  backup: "72000000-0000-4000-8000-000000000003",
  escalationOne: "72000000-0000-4000-8000-000000000004",
  escalationTwo: "72000000-0000-4000-8000-000000000005",
} as const;
const now = new Date("2026-07-31T16:00:00.000Z");

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const routing = new DatabasePersistedWorkflowExceptionRouting(db, () => now);
const admin = new DatabaseExceptionRosterAdminService(db);

async function cleanup() {
  await withInternalTransaction(db, `${requestPrefix}:cleanup`, async (tx) => {
    const events = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        or(
          like(auditEvents.requestId, `${requestPrefix}%`),
          eq(auditEvents.accountId, accountId),
        ),
      );
    if (events.length > 0) {
      await tx.delete(outboxMessages).where(
        inArray(
          outboxMessages.eventId,
          events.map(({ id }) => id),
        ),
      );
      await tx
        .delete(auditEvents)
        .where(
          or(
            like(auditEvents.requestId, `${requestPrefix}%`),
            eq(auditEvents.accountId, accountId),
          ),
        );
    }
    await tx.delete(exceptionCases).where(eq(exceptionCases.id, caseId));
    await tx
      .delete(systemExceptionRoster)
      .where(eq(systemExceptionRoster.accountId, accountId));
  });
}

beforeAll(async () => {
  await cleanup();
  await withInternalTransaction(db, `${requestPrefix}:setup`, async (tx) => {
    await tx
      .insert(accounts)
      .values({
        id: accountId,
        legalName: "Persisted Routing Test Account",
        relationshipRoles: ["direct_client"],
        registeredAddress: { country: "US" },
        taxIds: [],
        billingContact: { email: "billing@routing.invalid" },
        apContact: { email: "ap@routing.invalid" },
        invoiceDeliveryEmail: "invoices@routing.invalid",
        domain: "routing-integration.invalid",
        country: "US",
        currency: "USD",
      })
      .onConflictDoNothing();
    await tx
      .insert(commerceUsers)
      .values(
        Object.entries(users).map(([name, id]) => ({
          id,
          workosUserId: `workos-routing-${name}`,
          email: `${name}@routing.invalid`,
          name,
          isInternalStaff: true,
          mfaEnrolled: true,
        })),
      )
      .onConflictDoNothing();
    await tx.insert(systemExceptionRoster).values([
      {
        accountId,
        queue: "reconciliation",
        userId: users.primary,
        role: "primary",
        active: true,
        qualificationEvidenceReference: "evidence://approvers/primary",
        qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
        targetMinutes: 60,
        priority: 10,
      },
      {
        accountId,
        queue: "reconciliation",
        userId: users.backup,
        role: "backup",
        active: true,
        qualificationEvidenceReference: "evidence://approvers/backup",
        qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
        targetMinutes: 60,
        priority: 10,
      },
      ...([users.escalationOne, users.escalationTwo] as const).map(
        (userId, priority) => ({
          accountId,
          queue: "reconciliation",
          userId,
          role: "escalation",
          active: true,
          qualificationEvidenceReference: `evidence://approvers/${userId}`,
          qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
          targetMinutes: 60,
          priority: 10 + priority,
        }),
      ),
    ]);
  });
});

afterAll(async () => {
  await cleanup();
  await client.end();
});

describe.sequential("persisted exception routing", () => {
  it("derives account scope and routes an arbitrary safe runtime queue", async () => {
    await expect(
      routing.resolve({
        queue: "reconciliation",
        aggregateId: accountId,
        occurredAt: now.toISOString(),
        severity: "blocking",
      }),
    ).resolves.toEqual({
      accountId,
      ownerUserId: users.primary,
      backupUserId: users.backup,
      objectType: "account",
      targetAt: "2026-07-31T17:00:00.000Z",
    });
  });

  it("audits roster absence and separation-of-duties reassignment", async () => {
    const primary = await withInternalTransaction(
      db,
      `${requestPrefix}:read-primary`,
      (tx) =>
        tx.query.systemExceptionRoster.findFirst({
          where: eq(systemExceptionRoster.userId, users.primary),
        }),
    );
    if (!primary) throw new Error("Primary roster row is missing");
    await admin.upsert({
      rosterEntryId: primary.id,
      expectedRowVersion: primary.rowVersion,
      accountId,
      queue: "reconciliation",
      userId: users.primary,
      role: "primary",
      active: true,
      qualificationEvidenceReference: "evidence://approvers/primary-absence",
      qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
      absentFrom: new Date("2026-07-31T15:00:00.000Z"),
      absentUntil: new Date("2026-08-01T15:00:00.000Z"),
      targetMinutes: 60,
      priority: 10,
      actor: { kind: "user", id: users.operator },
      requestId: `${requestPrefix}:absence-control`,
      now,
    });
    await withInternalTransaction(
      db,
      `${requestPrefix}:case-setup`,
      async (tx) => {
        await tx.insert(exceptionCases).values({
          id: caseId,
          accountId,
          queue: "reconciliation",
          objectType: "account",
          objectId,
          ownerUserId: users.primary,
          backupUserId: users.backup,
          targetAt: new Date("2026-07-31T17:00:00.000Z"),
          status: "open",
        });
      },
    );
    const updated = await admin.reassignOpenCase({
      caseId,
      requestedBy: users.operator,
      actor: { kind: "user", id: users.operator },
      requestId: `${requestPrefix}:audited-reassignment`,
      now,
      reason: "Primary requester is absent and cannot approve",
    });
    expect(updated).toMatchObject({
      ownerUserId: users.backup,
      backupUserId: users.escalationOne,
    });
    const audit = await withInternalTransaction(
      db,
      `${requestPrefix}:read-audit`,
      (tx) =>
        tx.query.auditEvents.findFirst({
          where: eq(
            auditEvents.requestId,
            `${requestPrefix}:audited-reassignment`,
          ),
        }),
    );
    expect(audit).toMatchObject({
      eventType: "exception_case.absence_escalated",
      aggregateVersion: 2,
    });
  });
});
