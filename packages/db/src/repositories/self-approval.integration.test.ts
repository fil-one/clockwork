import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ids, permissionsForRoles, type Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import { createRuntimeDatabase } from "../client";
import {
  approvals,
  auditEvents,
  commerceUsers,
  exceptionCases,
  memberships,
  orders,
  priceBooks,
  quotes,
  rateCards,
} from "../schema";
import { priceBookSchedules } from "../schema/core/price-book-schedules";
import { staffNotices } from "../schema/access";
import { systemCapabilities, systemCapabilityRequests } from "../schema/system";
import { withInternalTransaction } from "../transaction";
import { DatabaseChannelPolicyRepository } from "./core/channel-policy";
import { DatabaseCoreFinanceRepository } from "./core/database-finance";
import { DatabasePaygOfferRepository } from "./core/payg-offers";
import { DatabasePriceBookScheduleRepository } from "./core/price-book-schedules";
import { FixtureTaxPort } from "./core/tax-fixture";
import { DatabaseLifecycleCommandRepository } from "./lifecycle/command-repository";
import { DatabaseSystemCapabilityAdmin } from "./system/capability-admin";
import { OwnerConsoleRepository } from "./system/owner-console";

/**
 * Self-approval on every control with an application path: a commerce
 * administrator approves their own request with a reason, the decision row
 * carries the marker, an `approval.self_approved` event is written and every
 * other commerce administrator gets a notice. Everyone else keeps the
 * distinct-approver rule exactly as before.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const staffOrganization = "30000000-0000-4000-8000-000000000008";
const account = "10000000-0000-4000-8000-000000000004";
const evidenceDocument = "40000000-0000-4000-8000-000000000020";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const run = randomUUID().slice(0, 8);
const ada = randomUUID(); // commerce administrator
const ben = randomUUID(); // commerce administrator
const cy = randomUUID(); // finance approver, no approval:self
const dee = randomUUID(); // exception escalation owner

const reason = "Second approver is away until Monday";

function staffAuthorization(
  userId: string,
  role: Role,
  extra: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  const assisted = Boolean(extra.impersonation);
  return {
    userId: ids.user.parse(userId),
    accountIds: [ids.account.parse(account)],
    roles: [role],
    permissions: permissionsForRoles([role], { side: "fil_one", assisted }),
    side: "fil_one",
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...extra,
  };
}

async function selfApprovalEvents(subjectId: string) {
  return withInternalTransaction(db, `self-approval-events-${run}`, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.eventType, "approval.self_approved"),
          sql`${auditEvents.after}->>'subjectId' = ${subjectId}`,
        ),
      ),
  );
}

async function noticeRecipients(eventId: string) {
  const rows = await withInternalTransaction(
    db,
    `self-approval-notices-${run}`,
    (tx) =>
      tx
        .select({ recipient: staffNotices.recipientUserId })
        .from(staffNotices)
        .where(eq(staffNotices.auditEventId, eventId)),
  );
  return rows.map((row) => row.recipient);
}

/** One event naming the control and reason, and a notice for Ben only. */
async function expectAudited(subjectId: string, control: string) {
  const events = await selfApprovalEvents(subjectId);
  expect(events).toHaveLength(1);
  const [event] = events;
  if (!event) throw new Error("SELF_APPROVAL_EVENT_MISSING");
  expect(event).toMatchObject({
    accountId: null,
    aggregateType: "self_approval",
    actor: { kind: "user", id: ada },
  });
  expect(event.after).toMatchObject({ control, reason, approverId: ada });
  const recipients = await noticeRecipients(event.id);
  expect(recipients).toContain(ben);
  expect(recipients).not.toContain(ada);
  expect(recipients).not.toContain(cy);
}

beforeAll(async () =>
  withInternalTransaction(db, `self-approval-fixture-${run}`, async (tx) => {
    for (const [id, role, name] of [
      [ada, "commerce_admin", "Ada Admin"],
      [ben, "commerce_admin", "Ben Admin"],
      [cy, "finance_approver", "Cy Finance"],
      [dee, "internal_operator", "Dee Operator"],
    ] as const) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `user_self_${id}`,
        email: `${id}@fil-one.test`,
        name,
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await tx
        .insert(memberships)
        .values({ userId: id, organizationId: staffOrganization, role });
    }
  }),
);
afterAll(async () => client.end());

describe("channel policy", () => {
  const repository = new DatabaseChannelPolicyRepository(db);
  const command = (
    input: Parameters<typeof repository.command>[0]["command"],
    actor: string,
    selfApproval?: { reason: string },
  ) =>
    repository.command({
      command: input,
      actor: { kind: "user", id: actor },
      requestId: randomUUID(),
      now: new Date().toISOString(),
      ...(selfApproval ? { selfApproval } : {}),
    });
  async function proposed(author: string) {
    const version = 2_000_000 + Math.floor(Math.random() * 1_000_000);
    let row = await command(
      {
        action: "create",
        terms: {
          version,
          effectiveFrom: new Date(
            Date.UTC(2100, 0, 1) + (version % 20_000) * 86_400_000,
          )
            .toISOString()
            .slice(0, 10),
          selfServeThresholdTb: 250,
          defaultProtectionDays: 30,
          maximumProtectionDays: 60,
          extensionDays: 30,
          maximumExtensions: 1,
          sourceEvidence: "self-approval source",
        },
      },
      author,
    );
    row = await command(
      {
        action: "propose",
        id: row.id,
        expectedRowVersion: row.rowVersion,
        reason: "Ready for review",
      },
      author,
    );
    return row;
  }
  const approve = (
    row: Awaited<ReturnType<typeof proposed>>,
    text = reason,
  ) => ({
    action: "approve" as const,
    id: row.id,
    expectedRowVersion: row.rowVersion,
    reason: text,
    approvalEvidence: "Board minutes 2026-10",
    selfApproval: true as const,
  });

  it("lets a commerce administrator approve their own version with a reason", async () => {
    const row = await proposed(ada);
    const approved = await command(approve(row), ada, { reason });
    expect(approved).toMatchObject({
      status: "approved",
      approvedBy: ada,
      selfApproved: true,
      selfApprovalReason: reason,
    });
    await expectAudited(row.id, "channel_policy");
  });

  it("refuses a short or long reason and keeps the distinct rule for everyone else", async () => {
    const own = await proposed(ada);
    await expect(
      command(approve(own, "too short"), ada, { reason: "short" }),
    ).rejects.toThrow("SELF_APPROVAL_REASON_REQUIRED");
    await expect(
      command(approve(own, "x".repeat(600)), ada, {
        reason: "x".repeat(600),
      }),
    ).rejects.toThrow("SELF_APPROVAL_REASON_REQUIRED");
    const theirs = await proposed(cy);
    await expect(command(approve(theirs), cy, { reason })).rejects.toThrow(
      "SELF_APPROVAL_NOT_PERMITTED",
    );
    const { selfApproval, ...plain } = approve(theirs);
    expect(selfApproval).toBe(true);
    await expect(command(plain, cy)).rejects.toThrow(
      "CHANNEL_POLICY_DISTINCT_APPROVER_REQUIRED",
    );
    // A second commerce administrator approving normally still works.
    expect(await command(plain, ben)).toMatchObject({
      status: "approved",
      approvedBy: ben,
    });
    expect(await selfApprovalEvents(theirs.id)).toHaveLength(0);
  });
});

describe("PAYG offers", () => {
  const repository = new DatabasePaygOfferRepository(db);
  const now = () => new Date().toISOString();
  async function proposed(author: string) {
    const version = 1 + Math.floor(Math.random() * 1_000_000);
    const terms = {
      name: "Self-approval PAYG",
      sku: `SELF-${run}`,
      region: "eu-self",
      version,
      effectiveFrom: "2026-10-01",
      sourceUri: "https://evidence.fil-one.test/payg",
      sourceCheckedAt: "2026-09-30T00:00:00.000Z",
      sourceDocumentId: "DOC-PAYG",
      owner: "Finance",
      payg: {
        currency: "USD" as const,
        storageTbMonthMinor: "1500",
        monthlyMinimumMinor: "0",
        partialMonthMinimum: "prorated" as const,
        correctionWindowDays: 30,
        aggregation: "hourly_average_daily_utc" as const,
        egressRateMinor: "0" as const,
        apiRateMinor: "0" as const,
        stripeTaxCode: "txcd_demo",
        qboIncomeAccount: "4000",
      },
      trial: {
        durationDays: 30,
        gracePeriodDays: 7,
        storageLimitBytes: "1000000000000",
        cumulativeEgressLimitBytes: "1000000000000",
        maximumCounterAgeSeconds: 3600,
        egressExhaustion: "block_egress" as const,
      },
    };
    const created = await repository.command({
      command: { action: "create", terms },
      actor: { kind: "user", id: author },
      requestId: randomUUID(),
      now: now(),
    });
    return repository.command({
      command: {
        action: "propose",
        id: created.id,
        expectedRowVersion: created.rowVersion,
        reason: "Ready for review",
      },
      actor: { kind: "user", id: author },
      requestId: randomUUID(),
      now: now(),
    });
  }
  const approve = (
    row: Awaited<ReturnType<typeof proposed>>,
    actor: string,
    selfApproval?: { reason: string },
  ) =>
    repository.command({
      command: {
        action: "approve",
        id: row.id,
        expectedRowVersion: row.rowVersion,
        reason,
        approvalEvidenceId: "DOC-APPROVAL",
        ...(selfApproval ? { selfApproval: true as const } : {}),
      },
      actor: { kind: "user", id: actor },
      requestId: randomUUID(),
      now: now(),
      ...(selfApproval ? { selfApproval } : {}),
    });

  it("lets a commerce administrator approve their own offer and refuses a finance approver", async () => {
    const own = await proposed(ada);
    expect(await approve(own, ada, { reason })).toMatchObject({
      status: "approved",
      selfApproved: true,
      selfApprovalReason: reason,
    });
    await expectAudited(own.id, "payg_offer");

    const theirs = await proposed(cy);
    await expect(approve(theirs, cy, { reason })).rejects.toThrow(
      "SELF_APPROVAL_NOT_PERMITTED",
    );
    await expect(approve(theirs, cy)).rejects.toThrow(
      "PAYG_OFFER_DISTINCT_APPROVER_REQUIRED",
    );
    await expect(approve(theirs, ben, { reason })).rejects.toThrow(
      "SELF_APPROVAL_NOT_OWN_REQUEST",
    );
    expect(await approve(theirs, ben)).toMatchObject({ status: "approved" });
  });
});

describe("capability switches", () => {
  const admin = new DatabaseSystemCapabilityAdmin(db);
  const key = "marketplace" as const;
  async function capability() {
    const rows = await admin.list({ requestId: randomUUID() });
    const row = rows.find((item) => item.capabilityKey === key);
    if (!row) throw new Error("CAPABILITY_FIXTURE_MISSING");
    return row;
  }
  async function propose(actor: string) {
    const before = await capability();
    return admin.propose({
      capabilityKey: key,
      expectedRowVersion: before.rowVersion,
      reason: "Pilot marketplace listing",
      actor: { kind: "user", id: actor },
      requestId: randomUUID(),
      now: new Date(),
      enableRecovery: false,
      evidenceReference: "https://evidence.fil-one.test/tickets/self-1",
    });
  }
  async function disable(actor: string) {
    const before = await capability();
    await admin.disable({
      capabilityKey: key,
      expectedRowVersion: before.rowVersion,
      reason: "Back off after the self-approval test",
      actor: { kind: "user", id: actor },
      requestId: randomUUID(),
      now: new Date(),
      disableRecovery: false,
    });
  }

  it("lets a commerce administrator approve their own switch request, and only theirs", async () => {
    const request = await propose(ada);
    const decide = async (actor: string, selfApproval?: { reason: string }) =>
      admin.decide({
        capabilityKey: key,
        expectedRowVersion: (await capability()).rowVersion,
        reason,
        actor: { kind: "user", id: actor },
        requestId: randomUUID(),
        now: new Date(),
        proposalId: request.id,
        approve: true,
        ...(selfApproval ? { selfApproval } : {}),
      });
    await expect(decide(ada)).rejects.toThrow(
      "CAPABILITY_DISTINCT_APPROVER_REQUIRED",
    );
    await expect(decide(ben, { reason })).rejects.toThrow(
      "SELF_APPROVAL_NOT_OWN_REQUEST",
    );
    await expect(decide(ada, { reason: "short" })).rejects.toThrow(
      "SELF_APPROVAL_REASON_REQUIRED",
    );
    await decide(ada, { reason });
    const [stored] = await withInternalTransaction(
      db,
      `self-capability-${run}`,
      (tx) =>
        tx
          .select()
          .from(systemCapabilityRequests)
          .where(eq(systemCapabilityRequests.id, request.id)),
    );
    expect(stored).toMatchObject({
      status: "approved",
      decidedBy: ada,
      selfApproved: true,
      selfApprovalReason: reason,
    });
    await expectAudited(request.id, "capability_activation");
    await disable(ada);
  });
});

describe("price books", () => {
  const repository = new DatabaseCoreFinanceRepository({
    database: db,
    pricingDatabase: db,
    authorizationSecret,
    tax: new FixtureTaxPort(),
  });
  const versionBase =
    500_000 + (Number.parseInt(run.slice(0, 6), 16) % 400_000);
  const command = (input: {
    id: string;
    action: string;
    payload: Record<string, unknown>;
    authorization: AuthorizationContext;
    key: string;
  }) =>
    repository.mutate({
      resource: "price_books",
      id: input.id,
      action: input.action,
      payload: input.payload,
      actor: { kind: "user", id: input.authorization.userId },
      authorization: input.authorization,
      requestId: `self-price-${input.key}-${run}`,
      idempotencyKey: `self-price-${input.key}-${run}`,
      occurredAt: "2026-08-01T16:00:00.000Z",
    });
  async function requested(offset: number, requester: AuthorizationContext) {
    const id = randomUUID();
    const version = versionBase + offset;
    await command({
      id,
      action: "create",
      payload: {
        name: `Self-approval sterling ${version}`,
        currency: "GBP",
        effectiveFrom: "2026-01-01",
        version,
      },
      authorization: requester,
      key: `create-${offset}`,
    });
    await command({
      id,
      action: "add_rate",
      payload: {
        sku: "SELF-STORAGE-TB",
        region: "uk-south",
        unit: "TB-month",
        approvedClaim: "Fictional storage capacity",
        unitPrice: { currency: "GBP", minor: "15000" },
        floorPrice: { currency: "GBP", minor: "10000" },
        overageRate: { currency: "GBP", minor: "18000" },
        minimumQuantity: "1",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_demo",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: {},
      },
      authorization: requester,
      key: `rate-${offset}`,
    });
    await command({
      id,
      action: "request_activation",
      payload: { reason: "Sterling refresh for the pilot" },
      authorization: requester,
      key: `request-${offset}`,
    });
    return id;
  }

  it("activates a commerce administrator's own request and records the self-approval", async () => {
    const adminAuthority = staffAuthorization(ada, "commerce_admin");
    const id = await requested(1, adminAuthority);
    await expect(
      command({
        id,
        action: "activate",
        payload: { reason },
        authorization: adminAuthority,
        key: "activate-plain",
      }),
    ).rejects.toThrow("cannot be the person who requested it");
    await expect(
      command({
        id,
        action: "activate",
        payload: { reason, selfApproval: true },
        authorization: staffAuthorization(ada, "commerce_admin", {
          impersonation: {
            accountId: ids.account.parse(account),
            reason: "Helping the customer",
            sessionId: randomUUID(),
            actualUserId: ids.user.parse(ada),
            actualActorEmail: `${ada}@fil-one.test`,
          },
        }),
        key: "activate-assisted",
      }),
    ).rejects.toThrow(/SELF_APPROVAL_DIRECT_SESSION_REQUIRED|authority/u);
    const activated = await command({
      id,
      action: "activate",
      payload: { reason, selfApproval: true },
      authorization: adminAuthority,
      key: "activate-self",
    });
    expect(activated.record.data).toMatchObject({
      status: "active",
      activationRequestedBy: ada,
      activationApprovedBy: ada,
      activationSelfApproved: true,
    });
    const [approval] = await withInternalTransaction(
      db,
      `self-price-approval-${run}`,
      (tx) => tx.select().from(approvals).where(eq(approvals.objectId, id)),
    );
    expect(approval).toMatchObject({
      status: "approved",
      selfApproved: true,
      selfApprovalReason: reason,
    });
    await expectAudited(id, "price_book_activation");
  });

  it("refuses a finance approver's self-approval exactly as before", async () => {
    const financeAuthority = staffAuthorization(cy, "finance_approver");
    const id = await requested(2, financeAuthority);
    await expect(
      command({
        id,
        action: "activate",
        payload: { reason, selfApproval: true },
        authorization: financeAuthority,
        key: "finance-self",
      }),
    ).rejects.toThrow("SELF_APPROVAL_NOT_PERMITTED");
    await expect(
      command({
        id,
        action: "activate",
        payload: { reason },
        authorization: financeAuthority,
        key: "finance-plain",
      }),
    ).rejects.toThrow("cannot be the person who requested it");
    await expect(
      command({
        id,
        action: "activate",
        payload: { reason: "short", selfApproval: true },
        authorization: staffAuthorization(ada, "commerce_admin"),
        key: "admin-not-own",
      }),
    ).rejects.toThrow();
    expect(await selfApprovalEvents(id)).toHaveLength(0);
  });
});

describe("price book schedules", () => {
  it("schedules a commerce administrator's own request and stops it once the right is gone", async () => {
    const rollback = new Error("ROLLBACK_SELF_SCHEDULE_FIXTURE");
    await db
      .transaction(async (outer) => {
        await outer.execute(sql`set local role clockwork_service`);
        const admin = randomUUID();
        await outer.insert(commerceUsers).values({
          id: admin,
          workosUserId: `self-schedule-${admin}`,
          email: `self-schedule-${admin}@fil-one.test`,
          name: "Self schedule admin",
          isInternalStaff: true,
          mfaEnrolled: true,
        });
        await outer.insert(memberships).values({
          userId: admin,
          organizationId: staffOrganization,
          role: "commerce_admin",
        });
        const [template] = await outer.select().from(rateCards).limit(1);
        const [version] = await outer.execute<{ next: number }>(
          sql`select coalesce(max(version),0)+1 as next from price_books where currency='USD'`,
        );
        if (!template || !version) throw new Error("Missing price fixtures");
        const nested = vi
          .spyOn(db, "transaction")
          .mockImplementation(outer.transaction.bind(outer));
        try {
          const core = new DatabaseCoreFinanceRepository({
            database: db,
            pricingDatabase: db,
            authorizationSecret,
            tax: new FixtureTaxPort(),
          });
          const authority = staffAuthorization(admin, "commerce_admin");
          const command = (
            id: string,
            action: string,
            payload: Record<string, unknown>,
          ) =>
            core.mutate({
              resource: "price_books",
              id,
              action,
              payload,
              actor: { kind: "user", id: admin },
              authorization: authority,
              requestId: randomUUID(),
              idempotencyKey: randomUUID(),
              occurredAt: "2026-09-06T12:00:00Z",
            });
          const id = randomUUID();
          await command(id, "create", {
            name: "Self-scheduled USD",
            currency: "USD",
            version: version.next,
            effectiveFrom: "2026-09-08",
            effectiveTo: "2026-09-09",
          });
          await withInternalTransaction(db, randomUUID(), (tx) =>
            tx
              .insert(rateCards)
              .values({ ...template, id: randomUUID(), priceBookId: id }),
          );
          await command(id, "request_activation", {
            reason: "Future economics for September",
          });
          await expect(
            command(id, "schedule_activation", { reason }),
          ).rejects.toThrow("different finance approver");
          await command(id, "schedule_activation", {
            reason,
            selfApproval: true,
          });
          const read = <T>(
            run: (
              tx: Parameters<Parameters<typeof withInternalTransaction>[2]>[0],
            ) => Promise<T>,
          ) => withInternalTransaction(db, randomUUID(), run);
          const schedule = await read((tx) =>
            tx.query.priceBookSchedules.findFirst({
              where: and(
                eq(priceBookSchedules.priceBookId, id),
                eq(priceBookSchedules.status, "approved"),
              ),
            }),
          );
          if (!schedule) throw new Error("Missing schedule");
          expect(
            await read((tx) =>
              tx.query.approvals.findFirst({
                where: eq(approvals.id, schedule.approvalId),
              }),
            ),
          ).toMatchObject({
            requestedBy: admin,
            approvedBy: admin,
            selfApproved: true,
            selfApprovalReason: reason,
          });
          expect(await selfApprovalEvents(id)).toHaveLength(1);

          const worker = new DatabasePriceBookScheduleRepository(db);
          await read(async (tx) => {
            await tx
              .update(systemCapabilities)
              .set({ enabled: true })
              .where(eq(systemCapabilities.capabilityKey, "new_business"));
            // Still a finance approver, no longer allowed to self-approve.
            await tx
              .update(memberships)
              .set({ role: "finance_approver" })
              .where(eq(memberships.userId, admin));
          });
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:00:00Z"),
          ).rejects.toThrow("PRICE_SCHEDULE_APPROVAL_CHANGED");
          expect(
            await read((tx) =>
              tx.query.priceBooks.findFirst({ where: eq(priceBooks.id, id) }),
            ),
          ).toMatchObject({ status: "draft" });
          await read((tx) =>
            tx
              .update(memberships)
              .set({ role: "commerce_admin" })
              .where(eq(memberships.userId, admin)),
          );
          await expect(
            worker.execute(schedule.id, "2026-09-08T00:00:00Z"),
          ).resolves.toMatchObject({ status: "executed" });
        } finally {
          nested.mockRestore();
        }
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
  });
});

describe("exceptions and terminations", () => {
  const repository = new DatabaseLifecycleCommandRepository({
    database: db,
    serviceDatabase: db,
    authorizationSecret,
    policies: {
      clickThroughThresholdMinor: "1000000",
      migrationFeatureEnabled: false,
      automatedTeardownEnabled: false,
      exceptionQueues: exceptionQueues.map((queue) => ({
        queue,
        ownerId: ada,
        backupId: ben,
        targetBusinessHours: 8,
        escalationOwnerId: cy,
        separationRequired: true,
      })),
    },
  });
  const context = (
    actor: string,
    role: Role,
    extra: Partial<AuthorizationContext> = {},
  ) => ({
    requestId: `self-lifecycle-${randomUUID()}`,
    actor: { kind: "user" as const, id: actor },
    idempotencyKey: `self-lifecycle-${randomUUID()}`,
    ip: "192.0.2.12",
    userAgent: "Clockwork self-approval integration",
    occurredAt: "2026-07-31T16:00:00.000Z",
    authorization: staffAuthorization(actor, role, extra),
  });
  async function openCase(requester: string, role: Role) {
    const opened = await repository.executeInTransaction({
      command: "open_exception",
      payload: {
        queue: "pricing",
        accountId: account,
        objectType: "quote",
        objectId: randomUUID(),
        reason: "Below the floor for a pilot",
        evidenceDocumentId: evidenceDocument,
      },
      context: context(requester, role),
    });
    return opened.id;
  }
  const decide = (
    caseId: string,
    actor: string,
    role: Role,
    selfApproval: boolean,
    extra: Partial<AuthorizationContext> = {},
  ) =>
    repository.executeInTransaction({
      command: "decide_exception",
      payload: {
        caseId,
        accountId: account,
        queue: "pricing",
        decision: "approved",
        reason,
        evidenceDocumentId: evidenceDocument,
        ...(selfApproval ? { selfApproval: true } : {}),
      },
      context: context(actor, role, extra),
    });

  it("lets the requester approve their own pricing exception with a reason", async () => {
    const caseId = await openCase(ada, "commerce_admin");
    await expect(decide(caseId, ada, "commerce_admin", false)).rejects.toThrow(
      "EXCEPTION_SELF_APPROVAL_FORBIDDEN",
    );
    await expect(
      decide(caseId, ada, "commerce_admin", true, {
        impersonation: {
          accountId: ids.account.parse(account),
          reason: "Helping the customer",
          sessionId: randomUUID(),
          actualUserId: ids.user.parse(ada),
          actualActorEmail: `${ada}@fil-one.test`,
        },
      }),
    ).rejects.toThrow("SELF_APPROVAL_DIRECT_SESSION_REQUIRED");
    await decide(caseId, ada, "commerce_admin", true);
    const [stored] = await withInternalTransaction(
      db,
      `self-exception-${run}`,
      (tx) =>
        tx.select().from(exceptionCases).where(eq(exceptionCases.id, caseId)),
    );
    expect(stored).toMatchObject({
      status: "approved",
      selfApproved: true,
      selfApprovalReason: reason,
    });
    await expectAudited(caseId, "exception_case");
  });

  it("keeps separation for a finance approver and lets a second person decide", async () => {
    const caseId = await openCase(cy, "finance_approver");
    await expect(decide(caseId, cy, "finance_approver", true)).rejects.toThrow(
      "SELF_APPROVAL_NOT_PERMITTED",
    );
    await expect(decide(caseId, cy, "finance_approver", false)).rejects.toThrow(
      "EXCEPTION_SELF_APPROVAL_FORBIDDEN",
    );
    await decide(caseId, ben, "commerce_admin", false);
    expect(await selfApprovalEvents(caseId)).toHaveLength(0);
  });

  async function cloneDirectOrder(): Promise<string> {
    return withInternalTransaction(db, `self-order-${run}`, async (tx) => {
      const sourceOrder = await tx.query.orders.findFirst({
        where: eq(orders.id, "80000000-0000-4000-8000-000000000007"),
      });
      const sourceQuote = sourceOrder
        ? await tx.query.quotes.findFirst({
            where: eq(quotes.id, sourceOrder.quoteId),
          })
        : undefined;
      if (!sourceOrder || !sourceQuote)
        throw new Error("DIRECT_OFFBOARDING_SOURCE_FIXTURE_MISSING");
      const quoteId = randomUUID();
      const orderId = randomUUID();
      await tx.insert(quotes).values({
        ...sourceQuote,
        id: quoteId,
        seriesId: randomUUID(),
        previousRevisionId: null,
        rowVersion: 1,
      });
      await tx
        .insert(orders)
        .values({ ...sourceOrder, id: orderId, quoteId, rowVersion: 1 });
      return orderId;
    });
  }

  it("fills both teardown approver slots with one self-approval", async () => {
    const orderId = await cloneDirectOrder();
    const requested = await repository.executeInTransaction({
      command: "request_termination",
      payload: {
        accountId: account,
        orderId,
        reason: "customer_request" as const,
        effectiveAt: "2026-08-31T00:00:00.000Z",
        retrievalDays: 30,
        partnerAccountId: null,
      },
      context: context(ada, "commerce_admin"),
    });
    const decideTermination = (
      actor: string,
      role: Role,
      selfApproval: boolean,
    ) =>
      repository.executeInTransaction({
        command: "decide_termination",
        payload: {
          terminationId: requested.id,
          decision: "approved" as const,
          reason,
          evidenceDocumentId: evidenceDocument,
          ...(selfApproval ? { selfApproval: true as const } : {}),
        },
        context: context(actor, role),
      });
    await expect(
      decideTermination(ada, "commerce_admin", false),
    ).rejects.toThrow("DESTRUCTIVE_SELF_APPROVAL_FORBIDDEN");
    const decided = await decideTermination(ada, "commerce_admin", true);
    expect(decided).toMatchObject({
      eventType: "termination.approved",
      status: "ready_for_teardown",
    });
    const plan = await withInternalTransaction(
      db,
      `self-termination-${run}`,
      (tx) =>
        tx.query.lifecycleOffboardingPlans.findFirst({
          where: (table, { eq: equals }) =>
            equals(table.terminationId, requested.id),
        }),
    );
    const entries = (plan?.plan as { approvals: { selfApproved?: boolean }[] })
      .approvals;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.selfApproved === true)).toBe(true);
    const [approval] = await withInternalTransaction(
      db,
      `self-termination-approval-${run}`,
      (tx) =>
        tx.select().from(approvals).where(eq(approvals.objectId, requested.id)),
    );
    expect(approval).toMatchObject({ selfApproved: true, approvedBy: ada });
    await expectAudited(requested.id, "termination_teardown");
  });
});

describe("owner console", () => {
  it("lists recent self-approvals with what each was about", async () => {
    const records = await new OwnerConsoleRepository(db).selfApprovals({
      limit: 50,
      requestId: randomUUID(),
    });
    const mine = records.filter((record) => record.actor?.userId === ada);
    expect(mine.length).toBeGreaterThanOrEqual(6);
    expect(new Set(mine.map((record) => record.control))).toEqual(
      new Set([
        "channel_policy",
        "payg_offer",
        "capability_activation",
        "price_book_activation",
        "exception_case",
        "termination",
      ]),
    );
    expect(mine.every((record) => record.reason === reason)).toBe(true);
    expect(
      mine.find((record) => record.control === "payg_offer"),
    ).toMatchObject({ name: `SELF-${run}`, detail: "eu-self" });
  });

  it("shows Ben the notices for Ada's self-approvals", async () => {
    const notices = await new OwnerConsoleRepository(db).unreadNotices({
      viewerUserId: ben,
      limit: 50,
      requestId: randomUUID(),
    });
    expect(
      notices.filter(
        (notice) =>
          notice.eventType === "approval.self_approved" &&
          notice.actor?.userId === ada,
      ).length,
    ).toBeGreaterThanOrEqual(6);
  });
});
