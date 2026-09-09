import { describe, expect, it, vi } from "vitest";

import { ProviderRuntimeDeniedError } from "@clockwork/integrations";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import {
  type AuthoritativeLifecycleTaskStore,
  createAuthoritativeLifecycleHandlers,
  type LifecycleEffectExecutor,
  type LifecyclePreparedEffect,
  lifecycleTaskExecutionSpecs,
} from "./provider-lifecycle";

function dependencies(authoritative?: {
  store: AuthoritativeLifecycleTaskStore;
  effects: LifecycleEffectExecutor;
}) {
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
      store: authoritative?.store ?? {
        prepare: () => Promise.resolve([]),
        claimEffect: () =>
          Promise.resolve({ status: "invoke", leaseToken: "lease-1" }),
        checkpointEffectSuccess: () => Promise.resolve(),
        finalizeEffect: () => Promise.resolve(),
        failEffect: () => Promise.resolve(),
      },
      effects: authoritative?.effects ?? {
        authorize: () => Promise.resolve(),
        execute: () =>
          Promise.resolve({
            ok: true,
            value: { reference: "lifecycle-effect-1" },
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
          claimProviderEffect: () =>
            Promise.resolve({ status: "invoke", leaseToken: "lease-provider" }),
          checkpointProviderEffect: () => Promise.resolve(),
          finalizeProviderEffect: () => Promise.resolve(),
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

  it("declares a persisted loader, planner, and typed effect boundary for all 25 IDs", () => {
    expect(lifecycleWorkflowRegistry).toHaveLength(25);
    expect(Object.keys(lifecycleTaskExecutionSpecs).sort()).toEqual(
      [...lifecycleWorkflowRegistry].sort(),
    );
    for (const taskId of lifecycleWorkflowRegistry) {
      const spec = lifecycleTaskExecutionSpecs[taskId];
      expect(spec.taskId).toBe(taskId);
      expect(spec.loader.length).toBeGreaterThan(0);
      expect(spec.transition).toMatch(/^plan_/);
      expect(spec.effectBoundary).toMatch(
        /^(screening|notification|signature|evidence|provisioning)_provider$|^persisted_transition$|^human_wait$/,
      );
    }
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

  it("uses the same occurrence identity for Trigger Date payloads and serialized replays", () => {
    const { handlers } = dependencies();
    const handler = handlers.get("lifecycle-pocs-proposal-v1");
    const invocation = {
      taskId: "lifecycle-pocs-proposal-v1",
      triggerRunId: "run-schedule",
      attempt: 1,
      idempotencyKey: "lifecycle:schedule:date-regression",
      payload: { timestamp: "2026-09-09T02:20:00.000Z" },
    };
    const expected = handler?.aggregate(invocation);
    expect(expected).toMatchObject({ aggregateVersion: 1 });
    expect(
      handler?.aggregate({
        ...invocation,
        payload: { timestamp: new Date(invocation.payload.timestamp) },
      }),
    ).toEqual(expected);
    expect(() =>
      handler?.aggregate({
        ...invocation,
        payload: { timestamp: new Date("invalid") },
      }),
    ).toThrow("LIFECYCLE_TASK_AGGREGATE_ID_REQUIRED");
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

  it("recovers provider success after a local commit failure without invoking the provider again", async () => {
    const effect: LifecyclePreparedEffect = {
      effectKey: "lifecycle-effect:provider-success-recovery",
      taskId: "lifecycle-pocs-conversion-v1",
      aggregateId: "poc-1",
      aggregateVersion: 7,
      loader: "poc",
      transition: "plan_poc_conversion",
      effectBoundary: "provisioning_provider",
      persistedState: { id: "poc-1", rowVersion: 7, status: "converted" },
    };
    const claimEffect = vi
      .fn<AuthoritativeLifecycleTaskStore["claimEffect"]>()
      .mockResolvedValueOnce({ status: "invoke", leaseToken: "lease-1" })
      .mockResolvedValueOnce({
        status: "provider_succeeded",
        leaseToken: "lease-2",
        reference: "provider-operation-1",
      });
    const finalizeEffect = vi
      .fn<AuthoritativeLifecycleTaskStore["finalizeEffect"]>()
      .mockRejectedValueOnce(new Error("LOCAL_COMMIT_FAILED"))
      .mockResolvedValueOnce(undefined);
    const executeEffect = vi.fn<LifecycleEffectExecutor["execute"]>(() =>
      Promise.resolve({
        ok: true,
        value: { reference: "provider-operation-1" },
      }),
    );
    const { handlers } = dependencies({
      store: {
        prepare: () => Promise.resolve([effect]),
        claimEffect,
        checkpointEffectSuccess: () => Promise.resolve(),
        finalizeEffect,
        failEffect: () => Promise.resolve(),
      },
      effects: {
        authorize: () => Promise.resolve(),
        execute: executeEffect,
      },
    });
    const handler = handlers.get(effect.taskId);
    const invocation = {
      taskId: effect.taskId,
      triggerRunId: "run-provider-success-recovery",
      attempt: 1,
      idempotencyKey: "lifecycle:poc:provider-success-recovery",
      payload: { pocId: "poc-1", version: 7 },
    };
    await expect(handler?.execute(invocation)).rejects.toThrow(
      "LOCAL_COMMIT_FAILED",
    );
    await expect(
      handler?.execute({ ...invocation, attempt: 2 }),
    ).resolves.toMatchObject({
      effects: 1,
      invoked: 0,
      recovered: 1,
    });
    expect(executeEffect).toHaveBeenCalledOnce();
    expect(finalizeEffect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ leaseToken: "lease-2" }),
    );
  });

  it("authorizes before claiming an external effect and creates no ledger on gate denial", async () => {
    const effect: LifecyclePreparedEffect = {
      effectKey: "lifecycle-effect:denied",
      taskId: "lifecycle-pocs-conversion-v1",
      aggregateId: "poc-1",
      aggregateVersion: 7,
      loader: "poc",
      transition: "plan_poc_conversion",
      effectBoundary: "provisioning_provider",
      persistedState: { id: "poc-1", rowVersion: 7, status: "converted" },
    };
    const claimEffect = vi.fn<AuthoritativeLifecycleTaskStore["claimEffect"]>();
    const executeEffect = vi.fn<LifecycleEffectExecutor["execute"]>();
    const { handlers } = dependencies({
      store: {
        prepare: () => Promise.resolve([effect]),
        claimEffect,
        checkpointEffectSuccess: () => Promise.resolve(),
        finalizeEffect: () => Promise.resolve(),
        failEffect: () => Promise.resolve(),
      },
      effects: {
        authorize: () =>
          Promise.reject(
            new ProviderRuntimeDeniedError("PROVIDER_GATE_INACTIVE"),
          ),
        execute: executeEffect,
      },
    });
    await expect(
      handlers.get(effect.taskId)?.execute({
        taskId: effect.taskId,
        triggerRunId: "run-denied",
        attempt: 1,
        idempotencyKey: "lifecycle:poc:denied",
        payload: { pocId: "poc-1", version: 7 },
      }),
    ).rejects.toThrow("PROVIDER_GATE_INACTIVE");
    expect(claimEffect).not.toHaveBeenCalled();
    expect(executeEffect).not.toHaveBeenCalled();
  });

  it("does not persist retry/dead-letter state when a provider returns a typed gate denial", async () => {
    const effect: LifecyclePreparedEffect = {
      effectKey: "lifecycle-effect:returned-denial",
      taskId: "lifecycle-pocs-conversion-v1",
      aggregateId: "poc-1",
      aggregateVersion: 7,
      loader: "poc",
      transition: "plan_poc_conversion",
      effectBoundary: "provisioning_provider",
      persistedState: { id: "poc-1", rowVersion: 7, status: "converted" },
    };
    const failEffect = vi.fn<AuthoritativeLifecycleTaskStore["failEffect"]>();
    const { handlers } = dependencies({
      store: {
        prepare: () => Promise.resolve([effect]),
        claimEffect: () =>
          Promise.resolve({ status: "invoke", leaseToken: "lease-denied" }),
        checkpointEffectSuccess: () => Promise.resolve(),
        finalizeEffect: () => Promise.resolve(),
        failEffect,
      },
      effects: {
        authorize: () => Promise.resolve(),
        execute: () =>
          Promise.resolve({
            ok: false,
            kind: "permanent",
            code: "PROVIDER_GATE_INACTIVE",
            message: "Provider gate is inactive",
          }),
      },
    });
    await expect(
      handlers.get(effect.taskId)?.execute({
        taskId: effect.taskId,
        triggerRunId: "run-returned-denial",
        attempt: 1,
        idempotencyKey: "lifecycle:poc:returned-denial",
        payload: { pocId: "poc-1", version: 7 },
      }),
    ).rejects.toBeInstanceOf(ProviderRuntimeDeniedError);
    expect(failEffect).not.toHaveBeenCalled();
  });
});
