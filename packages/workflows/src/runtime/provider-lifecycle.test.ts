import { describe, expect, it, vi } from "vitest";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import { createAuthoritativeLifecycleHandlers } from "./provider-lifecycle";

function dependencies() {
  const record = vi.fn(() => Promise.resolve({}));
  const provision = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { operationId: "provider-operation-1" },
    }),
  );
  return {
    record,
    provision,
    handlers: createAuthoritativeLifecycleHandlers({
      store: {
        run: (input) =>
          Promise.resolve({
            taskId: input.taskId,
            status: "authoritative_state_loaded",
            candidateIds: [input.aggregateId],
          }),
      },
      provisioning: {
        provider: {
          provision,
          teardown: () =>
            Promise.resolve({
              ok: true,
              value: { operationId: "teardown-operation-1" },
            }),
        },
        store: {
          load: () =>
            Promise.resolve({
              attemptId: "40000000-0000-4000-8000-000000000001",
              rowVersion: 1,
              attempt: {
                command: {
                  commandId: "provisioning-command-1",
                  idempotencyKey: "order:provision:123456789",
                  orderId: "50000000-0000-4000-8000-000000000001",
                  orderVersion: 1,
                  organizationId: "30000000-0000-4000-8000-000000000001",
                  operation: "provision",
                  tenantId: null,
                  entitlements: [
                    {
                      sku: "LOCKED-STORAGE-TB",
                      productCode: "locked-storage",
                      entitlementKind: "storage",
                      quantity: "1",
                      region: "us-east-2",
                    },
                  ],
                  requestedAt: "2026-07-31T16:00:00.000Z",
                },
                state: "pending",
                attempts: 0,
                nextAttemptAt: "2026-07-31T16:00:00.000Z",
                lastError: null,
                providerOperationId: null,
                confirmedAt: null,
                operatorRecovery: null,
              },
            }),
          record,
        },
      },
    }),
  };
}

describe("authoritative lifecycle task handlers", () => {
  it("registers a concrete handler for every lifecycle task ID", () => {
    const { handlers } = dependencies();
    expect([...handlers.keys()].sort()).toEqual(
      [...lifecycleWorkflowRegistry].sort(),
    );
  });

  it("derives domain and scheduled aggregate identities without replay drift", () => {
    const { handlers } = dependencies();
    const domainInvocation = {
      taskId: "lifecycle-pocs-conversion-v1",
      triggerRunId: "run-1",
      attempt: 1,
      idempotencyKey: "lifecycle:poc:123456",
      payload: { pocId: "poc-1", version: 7 },
    };
    expect(
      handlers.get(domainInvocation.taskId)?.aggregate(domainInvocation),
    ).toEqual({ aggregateId: "poc-1", aggregateVersion: 7 });

    const scheduledInvocation = {
      taskId: "lifecycle-renewals-term-alerts-v1",
      triggerRunId: "run-schedule-1",
      attempt: 1,
      idempotencyKey: "lifecycle:schedule:123456",
      payload: { timestamp: "2026-07-31T16:00:00.000Z" },
    };
    const handler = handlers.get(scheduledInvocation.taskId);
    expect(handler?.aggregate(scheduledInvocation)).toEqual(
      handler?.aggregate({ ...scheduledInvocation, attempt: 4 }),
    );
  });

  it("requires an aggregate version for non-scheduled invocations", () => {
    const { handlers } = dependencies();
    const handler = handlers.get("lifecycle-agreements-envelope-dispatch-v1");
    expect(() =>
      handler?.aggregate({
        taskId: "lifecycle-agreements-envelope-dispatch-v1",
        triggerRunId: "run-1",
        attempt: 1,
        idempotencyKey: "lifecycle:agreement:123456",
        payload: { agreementId: "agreement-1" },
      }),
    ).toThrow("LIFECYCLE_TASK_AGGREGATE_VERSION_REQUIRED");
  });

  it("rebuilds accepted-order provisioning from the persisted command", async () => {
    const { handlers, provision, record } = dependencies();
    const event = {
      eventType: "order.provisioning_requested",
      aggregateType: "provider_operation",
      aggregateId: "40000000-0000-4000-8000-000000000001",
      aggregateVersion: 1,
      data: {
        orderId: "50000000-0000-4000-8000-000000000001",
        organizationId: "30000000-0000-4000-8000-000000000001",
        // Untrusted outbox quantities are deliberately ignored by the handler.
        command: { entitlements: [{ quantity: "999999" }] },
      },
    };
    const handler = handlers.get("lifecycle-provisioning-command-dispatch-v1");
    await expect(
      handler?.execute({
        taskId: "lifecycle-provisioning-command-dispatch-v1",
        triggerRunId: "run-provision-1",
        attempt: 1,
        idempotencyKey: "outbox:provision:123456",
        payload: event,
      }),
    ).resolves.toEqual({
      operationId: "provider-operation-1",
      duplicate: false,
    });
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: event.data.orderId,
        organizationId: event.data.organizationId,
        entitlements: [
          {
            sku: "LOCKED-STORAGE-TB",
            quantity: "1",
            region: "us-east-2",
          },
        ],
      }),
    );
    expect(record).toHaveBeenCalledOnce();
  });
});
