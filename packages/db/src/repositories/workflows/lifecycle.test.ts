import { describe, expect, it } from "vitest";

import {
  DatabaseAuthoritativeLifecycleTaskStore,
  deriveLifecycleProviderInput,
} from "./lifecycle";

describe("authoritative lifecycle provider planning", () => {
  it("derives only provider input already present in persisted screening, signature, and provisioning rows", () => {
    expect(
      deriveLifecycleProviderInput(
        "lifecycle-onboarding-screening-refresh-v1",
        {
          id: "10000000-0000-4000-8000-000000000001",
          legalName: "Persisted Customer",
          country: "US",
        },
      ),
    ).toEqual({
      accountId: "10000000-0000-4000-8000-000000000001",
      legalName: "Persisted Customer",
      country: "US",
      reason: "registration",
    });
    expect(
      deriveLifecycleProviderInput(
        "lifecycle-agreements-envelope-dispatch-v1",
        {
          accountId: "10000000-0000-4000-8000-000000000001",
          documentId: "40000000-0000-4000-8000-000000000001",
          signerEmail: "persisted@example.test",
        },
      ),
    ).toEqual({
      accountId: "10000000-0000-4000-8000-000000000001",
      documentId: "40000000-0000-4000-8000-000000000001",
      signerEmail: "persisted@example.test",
    });
    expect(
      deriveLifecycleProviderInput("lifecycle-provisioning-stuck-recovery-v1", {
        attempt: {
          command: {
            operation: "provision",
            orderId: "80000000-0000-4000-8000-000000000001",
            organizationId: "30000000-0000-4000-8000-000000000001",
            entitlements: [
              { sku: "LOCKED-STORAGE-TB", quantity: "1", region: "us-east-2" },
            ],
          },
        },
      }),
    ).toEqual({
      operation: "provision",
      orderId: "80000000-0000-4000-8000-000000000001",
      organizationId: "30000000-0000-4000-8000-000000000001",
      entitlements: [
        { sku: "LOCKED-STORAGE-TB", quantity: "1", region: "us-east-2" },
      ],
    });
  });

  it("does not invent recipients, evidence bytes, migration authority, or teardown approvals", () => {
    for (const taskId of [
      "lifecycle-onboarding-procurement-reminders-v1",
      "lifecycle-agreements-evidence-ingestion-v1",
      "lifecycle-offboarding-teardown-v1",
      "lifecycle-migrations-scheduled-batch-v1",
    ])
      expect(
        deriveLifecycleProviderInput(taskId, {
          id: "10000000-0000-4000-8000-000000000001",
          status: "pending",
        }),
      ).toBeUndefined();
    expect(
      deriveLifecycleProviderInput("lifecycle-provisioning-stuck-recovery-v1", {
        attempt: {
          command: {
            operation: "teardown",
            organizationId: "30000000-0000-4000-8000-000000000001",
          },
        },
      }),
    ).toBeUndefined();
  });
});

const termAlertSpec = {
  taskId: "lifecycle-renewals-term-alerts-v1",
  loader: "order",
  transition: "plan_renewal_term_alerts",
  effectBoundary: "notification_provider",
} as const;

function plannerDatabase(
  order: Record<string, unknown>,
  contacts: readonly { accountId: string; email: string }[],
  disabledAlertAccounts: readonly { accountId: string }[] = [],
) {
  return {
    transaction: (operation: (transaction: unknown) => Promise<unknown>) =>
      operation({
        execute: () => Promise.resolve(),
        query: {
          orders: { findMany: () => Promise.resolve([order]) },
          accountContacts: { findMany: () => Promise.resolve(contacts) },
          notificationPreferences: {
            findMany: () => Promise.resolve(disabledAlertAccounts),
          },
        },
      }),
  } as never;
}

describe("scheduled lifecycle effect identity", () => {
  const dueOrder = {
    id: "80000000-0000-4000-8000-000000000001",
    accountId: "10000000-0000-4000-8000-000000000001",
    rowVersion: 3,
    status: "active",
    sourcing: "direct",
    serviceEndsOn: "2026-07-31",
  };
  const contacts = [
    {
      accountId: "10000000-0000-4000-8000-000000000001",
      email: "renewals@example.test",
    },
  ];

  it("binds an unchanged due aggregate to the persisted schedule occurrence", async () => {
    const store = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(dueOrder, contacts),
      () => new Date("2026-08-01T09:00:00Z"),
    );
    const prepare = (scheduleOccurrenceId: string) =>
      store.prepare({
        spec: termAlertSpec,
        aggregateId: scheduleOccurrenceId,
        expectedAggregateVersion: 1,
        scheduled: true,
        requestId: `test:${scheduleOccurrenceId}`,
      });
    const first = await prepare("10000000-0000-5000-8000-000000000010");
    const replay = await prepare("10000000-0000-5000-8000-000000000010");
    const next = await prepare("10000000-0000-5000-8000-000000000011");
    expect(first[0]?.effectKey).toBeDefined();
    expect(first[0]?.effectKey).toBe(replay[0]?.effectKey);
    expect(next[0]?.effectKey).not.toBe(first[0]?.effectKey);
  });

  it("plans a term alert only once the contracted service end has been reached", async () => {
    const before = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(dueOrder, contacts),
      () => new Date("2026-07-30T09:00:00Z"),
    );
    const after = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(dueOrder, contacts),
      () => new Date("2026-07-31T09:00:00Z"),
    );
    const request = {
      spec: termAlertSpec,
      aggregateId: "10000000-0000-5000-8000-000000000012",
      expectedAggregateVersion: 1,
      scheduled: true,
      requestId: "test:boundary",
    };
    expect(await before.prepare(request)).toEqual([]);
    const planned = await after.prepare(request);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.persistedState.providerInput).toEqual({
      template: "renewals.term_end.v1",
      recipients: ["renewals@example.test"],
      data: {
        subjectId: dueOrder.id,
        window: "service_end",
        boundaryAt: "2026-07-31T00:00:00.000Z",
      },
    });
  });

  it("skips an alert when no active commercial contact is persisted", async () => {
    const store = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(dueOrder, []),
      () => new Date("2026-08-01T09:00:00Z"),
    );
    expect(
      await store.prepare({
        spec: termAlertSpec,
        aggregateId: "10000000-0000-5000-8000-000000000013",
        expectedAggregateVersion: 1,
        scheduled: true,
        requestId: "test:no-contacts",
      }),
    ).toEqual([]);
  });

  // A preferences table the planner never reads would be a setting that does
  // nothing. Suppression is applied where recipients are resolved, so the effect
  // is never planned rather than planned and then dropped at delivery.
  it("plans nothing when the account has switched the advisory alert off", async () => {
    const store = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(dueOrder, contacts, [
        { accountId: "10000000-0000-4000-8000-000000000001" },
      ]),
      () => new Date("2026-08-01T09:00:00Z"),
    );
    expect(
      await store.prepare({
        spec: termAlertSpec,
        aggregateId: "10000000-0000-5000-8000-000000000014",
        expectedAggregateVersion: 1,
        scheduled: true,
        requestId: "test:preference-off",
      }),
    ).toEqual([]);
  });

  it("routes a resale order's commercial notice to the partner's contacts", async () => {
    const resale = {
      ...dueOrder,
      sourcing: "resale",
      partnerAccountId: "10000000-0000-4000-8000-000000000002",
    };
    const store = new DatabaseAuthoritativeLifecycleTaskStore(
      plannerDatabase(resale, [
        {
          accountId: "10000000-0000-4000-8000-000000000002",
          email: "partner@example.test",
        },
      ]),
      () => new Date("2026-08-01T09:00:00Z"),
    );
    const planned = await store.prepare({
      spec: termAlertSpec,
      aggregateId: "10000000-0000-5000-8000-000000000014",
      expectedAggregateVersion: 1,
      scheduled: true,
      requestId: "test:resale",
    });
    expect(
      (planned[0]?.persistedState.providerInput as { recipients: string[] })
        .recipients,
    ).toEqual(["partner@example.test"]);
  });
});

describe("alert boundary provider input", () => {
  const now = new Date("2026-08-01T09:00:00Z");
  const recipients = ["alerts@example.test"];

  it("names the latest POC milestone the engagement has reached", () => {
    expect(
      deriveLifecycleProviderInput(
        "lifecycle-pocs-milestones-v1",
        {
          id: "85000000-0000-4000-8000-000000000001",
          alertRecipients: recipients,
          kickoffAt: new Date("2026-07-16T16:00:00Z"),
          midpointAt: new Date("2026-07-31T16:00:00Z"),
          finalReportAt: new Date("2026-08-14T16:00:00Z"),
        },
        now,
      ),
    ).toEqual({
      template: "pocs.milestone.v1",
      recipients,
      data: {
        subjectId: "85000000-0000-4000-8000-000000000001",
        window: "midpoint",
        boundaryAt: "2026-07-31T16:00:00.000Z",
      },
    });
  });

  it("alerts on a quote at its own contracted expiry", () => {
    expect(
      deriveLifecycleProviderInput(
        "lifecycle-quotes-expiry-alerts-v1",
        {
          id: "70000000-0000-4000-8000-000000000001",
          alertRecipients: recipients,
          expiresAt: new Date("2026-07-20T16:00:00Z"),
        },
        now,
      ),
    ).toEqual({
      template: "quotes.expiry.v1",
      recipients,
      data: {
        subjectId: "70000000-0000-4000-8000-000000000001",
        window: "expired",
        boundaryAt: "2026-07-20T16:00:00.000Z",
      },
    });
  });

  it("fails closed when an alert boundary has no persisted recipient", () => {
    expect(
      deriveLifecycleProviderInput(
        "lifecycle-renewals-notice-windows-v1",
        { id: "80000000-0000-4000-8000-000000000001", noticeOn: "2026-06-30" },
        now,
      ),
    ).toBeUndefined();
  });
});
