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

describe("scheduled lifecycle effect identity", () => {
  it("binds an unchanged due aggregate to the persisted schedule occurrence", async () => {
    const row = {
      id: "80000000-0000-4000-8000-000000000001",
      rowVersion: 3,
      status: "active",
      serviceEndsOn: "2027-07-31",
    };
    const database = {
      transaction: (
        operation: (transaction: {
          execute: () => Promise<void>;
          query: {
            orders: { findMany: () => Promise<readonly [typeof row]> };
          };
        }) => Promise<unknown>,
      ) =>
        operation({
          execute: () => Promise.resolve(),
          query: { orders: { findMany: () => Promise.resolve([row]) } },
        }),
    } as never;
    const store = new DatabaseAuthoritativeLifecycleTaskStore(database);
    const prepare = (scheduleOccurrenceId: string) =>
      store.prepare({
        spec: {
          taskId: "lifecycle-renewals-term-alerts-v1",
          loader: "order",
          transition: "plan_renewal_term_alerts",
          effectBoundary: "notification_provider",
        },
        aggregateId: scheduleOccurrenceId,
        expectedAggregateVersion: 1,
        scheduled: true,
        requestId: `test:${scheduleOccurrenceId}`,
      });
    const first = await prepare("10000000-0000-5000-8000-000000000010");
    const replay = await prepare("10000000-0000-5000-8000-000000000010");
    const next = await prepare("10000000-0000-5000-8000-000000000011");
    expect(first[0]?.effectKey).toBe(replay[0]?.effectKey);
    expect(next[0]?.effectKey).not.toBe(first[0]?.effectKey);
  });
});
