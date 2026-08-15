import { randomUUID } from "node:crypto";

import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdempotencyKeySchema } from "@clockwork/contracts";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import { createRuntimeDatabase } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  exceptionCases,
  outboxMessages,
  providerOperations,
} from "../../schema";
import { systemExceptionRoster } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { DatabasePersistedWorkflowExceptionRouting } from "../system/exception-routing";
import { DatabaseWorkflowExceptionPort } from "../workflows/core";
import { DatabaseLifecycleAuthorizationScopeResolver } from "./authorization-scopes";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const requestPrefix = "integration:exception-queue-vocabulary";
const accountId = "73000000-0000-4000-8000-000000000001";
const users = {
  primary: "74000000-0000-4000-8000-000000000001",
  backup: "74000000-0000-4000-8000-000000000002",
  escalationOne: "74000000-0000-4000-8000-000000000003",
  escalationTwo: "74000000-0000-4000-8000-000000000004",
} as const;
const now = new Date("2026-07-31T16:00:00.000Z");

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const routing = new DatabasePersistedWorkflowExceptionRouting(db, () => now);
const exceptions = new DatabaseWorkflowExceptionPort(db, routing);
const scopes = new DatabaseLifecycleAuthorizationScopeResolver(db);

/** The queue §16 owns and no declaration in the tree could name before P0-43. */
const recoveryQueue = "provisioning_recovery";
/** The shape-valid near miss a live packages/api fixture uses for the same idea. */
const shadowQueue = "provider_recovery";

async function cleanup(): Promise<void> {
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
      await tx.delete(auditEvents).where(
        inArray(
          auditEvents.id,
          events.map(({ id }) => id),
        ),
      );
    }
    await tx
      .delete(providerOperations)
      .where(like(providerOperations.idempotencyKey, `${requestPrefix}%`));
    await tx
      .delete(exceptionCases)
      .where(eq(exceptionCases.accountId, accountId));
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
        legalName: "Exception Vocabulary Test Account",
        relationshipRoles: ["direct_client"],
        registeredAddress: { country: "US" },
        taxIds: [],
        billingContact: { email: "billing@vocabulary.invalid" },
        apContact: { email: "ap@vocabulary.invalid" },
        invoiceDeliveryEmail: "invoices@vocabulary.invalid",
        domain: "exception-vocabulary.invalid",
        country: "US",
        currency: "USD",
      })
      .onConflictDoNothing();
    await tx
      .insert(commerceUsers)
      .values(
        Object.entries(users).map(([name, id]) => ({
          id,
          workosUserId: `workos-vocabulary-${name}`,
          email: `${name}@vocabulary.invalid`,
          name,
          isInternalStaff: true,
          mfaEnrolled: true,
        })),
      )
      .onConflictDoNothing();
    await tx.insert(systemExceptionRoster).values(
      (
        [
          [users.primary, "primary", 10],
          [users.backup, "backup", 10],
          [users.escalationOne, "escalation", 10],
          [users.escalationTwo, "escalation", 20],
        ] as const
      ).map(([userId, role, priority]) => ({
        accountId,
        queue: recoveryQueue,
        userId,
        role,
        active: true,
        qualificationEvidenceReference: `evidence://approvers/${userId}`,
        qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
        targetMinutes: 90,
        priority,
      })),
    );
  });
});

afterAll(async () => {
  await cleanup();
  await client.end();
});

/** The case the workflow path opens below; the scope assertion reads it back. */
let raisedCaseId = "";

describe.sequential("exception queue vocabulary", () => {
  it("routes a workflow-raised §16 recovery exception to a rostered owner and backup", async () => {
    const opened = await exceptions.open({
      taskId: "core.procurement.certificate-expiry.v1",
      exceptionKey: IdempotencyKeySchema.parse(
        `${requestPrefix}:recovery-open`,
      ),
      queue: recoveryQueue,
      code: "PROVIDER_PERMANENT_FAILURE",
      safeDetail: "Provisioning could not be confirmed and needs an operator.",
      aggregateId: accountId,
      aggregateVersion: 1,
      requestId: `${requestPrefix}:recovery-open`,
      occurredAt: now.toISOString(),
      severity: "blocking",
      metadata: { operation: "provisioning confirmation" },
    });
    raisedCaseId = opened.caseId;
    const persisted = await withInternalTransaction(
      db,
      `${requestPrefix}:recovery-read`,
      (tx) =>
        tx.query.exceptionCases.findFirst({
          where: eq(exceptionCases.id, opened.caseId),
        }),
    );
    // The owner, the backup and the escalation are three distinct rostered
    // people, and the roster entries they came from are recorded on the case.
    expect(persisted).toMatchObject({
      accountId,
      queue: recoveryQueue,
      ownerUserId: users.primary,
      backupUserId: users.backup,
      escalationOwnerUserId: users.escalationOne,
      ownershipAbsenceEscalated: false,
      status: "open",
    });
    expect(persisted?.ownershipRosterEntryIds).toHaveLength(3);
    // 90 rostered target minutes, not a queue-policy default.
    expect(persisted?.targetAt.toISOString()).toBe("2026-07-31T17:30:00.000Z");
  });

  it("refuses a raise for a shape-valid queue outside the vocabulary at the routing choke point", async () => {
    await expect(
      exceptions.open({
        taskId: "core.procurement.certificate-expiry.v1",
        exceptionKey: IdempotencyKeySchema.parse(
          `${requestPrefix}:shadow-open`,
        ),
        queue: shadowQueue,
        code: "PROVIDER_PERMANENT_FAILURE",
        safeDetail: "Provisioning could not be confirmed.",
        aggregateId: accountId,
        aggregateVersion: 1,
        requestId: `${requestPrefix}:shadow-open`,
        occurredAt: now.toISOString(),
        severity: "blocking",
        metadata: {},
      }),
      // Before P0-43 this reached the roster lookup, found nothing, and failed
      // as EXCEPTION_NO_ELIGIBLE_PRIMARY — a staffing problem, reported far
      // from the misspelled queue that actually caused it.
    ).rejects.toThrow(`EXCEPTION_ROUTING_QUEUE_UNKNOWN:${shadowQueue}`);
  });

  it("refuses a roster for a queue no raise site produces", async () => {
    await expect(
      withInternalTransaction(db, `${requestPrefix}:shadow-roster`, (tx) =>
        tx.insert(systemExceptionRoster).values({
          accountId,
          queue: shadowQueue,
          userId: users.primary,
          role: "primary",
          active: true,
          qualificationEvidenceReference: "evidence://approvers/shadow",
          qualifiedUntil: new Date("2027-07-31T16:00:00.000Z"),
          targetMinutes: 90,
          priority: 10,
        }),
      ),
      // Drizzle wraps the driver failure, so the constraint name is on the cause.
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "system_exception_roster_queue_vocabulary_check",
      },
    });
  });

  it("binds the declared vocabulary to what the database will store", async () => {
    // Not two lists agreeing: every member is written to the real column and
    // every non-member is refused by the real constraint.
    const objectId = randomUUID();
    await withInternalTransaction(db, `${requestPrefix}:admitted`, (tx) =>
      tx.insert(exceptionCases).values(
        exceptionQueues.map((queue) => ({
          accountId,
          queue,
          objectType: "account",
          objectId,
          ownerUserId: users.primary,
          targetAt: now,
          // 'closed' keeps exception_open_object_unique out of the way; the
          // constraint under test is on the queue column, not on status.
          status: "closed",
        })),
      ),
    );
    const stored = await withInternalTransaction(
      db,
      `${requestPrefix}:admitted-read`,
      (tx) =>
        tx
          .select({ queue: exceptionCases.queue })
          .from(exceptionCases)
          .where(eq(exceptionCases.objectId, objectId)),
    );
    expect(new Set(stored.map((row) => row.queue))).toEqual(
      new Set(exceptionQueues),
    );
    await expect(
      withInternalTransaction(db, `${requestPrefix}:refused`, (tx) =>
        tx.insert(exceptionCases).values({
          accountId,
          queue: shadowQueue,
          objectType: "account",
          objectId: randomUUID(),
          ownerUserId: users.primary,
          targetAt: now,
          status: "closed",
        }),
      ),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exception_cases_queue_vocabulary_check" },
    });
  });

  it("tells a lifecycle-surface queue apart from one the internal surface owns", async () => {
    // The lifecycle permission map is total over the seven lifecycle queues
    // only, so this resolver still refuses the rest — but it now says which
    // kind of refusal it is instead of surfacing a bare schema error, which is
    // what a workflow-raised case used to produce here.
    await expect(
      scopes.resolveExceptionScope({
        caseId: raisedCaseId,
        requestId: `${requestPrefix}:scope-read`,
      }),
    ).rejects.toThrow(
      `LIFECYCLE_AUTHORIZATION_QUEUE_OUT_OF_SCOPE:${recoveryQueue}`,
    );
  });
});
