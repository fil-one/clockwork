import { createHash } from "node:crypto";

import {
  IdempotencyKeySchema,
  ids,
  type ProvisioningPort,
} from "@clockwork/contracts";
import type {
  AuthoritativeLifecycleTaskResult,
  ProvisioningDispatchTarget,
} from "@clockwork/db";
import { z } from "zod";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import type { LifecycleTaskInvocation } from "../onboarding/trigger-runtime";
import type { LifecycleTaskHandler } from "./database-lifecycle";

const ProvisioningRequestedEventSchema = z.object({
  eventType: z.literal("order.provisioning_requested"),
  aggregateType: z.literal("provider_operation"),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int().positive(),
  data: z.object({
    orderId: z.uuid(),
    organizationId: z.uuid(),
  }),
});

const aggregateIdKeys = {
  "lifecycle-onboarding-": ["accountId"],
  "lifecycle-agreements-": ["agreementId", "envelopeId"],
  "lifecycle-provisioning-": ["orderId", "provisioningAttemptId"],
  "lifecycle-pocs-": ["pocId"],
  "lifecycle-renewals-": ["orderId", "renewalId"],
  "lifecycle-offboarding-": ["terminationId", "orderId"],
  "lifecycle-exceptions-": ["caseId", "exceptionCaseId"],
  "lifecycle-migrations-": ["runId", "migrationRunId"],
} as const;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function identityFromPayload(invocation: LifecycleTaskInvocation): {
  aggregateId: string;
  aggregateVersion: number;
} {
  const payload = isObject(invocation.payload) ? invocation.payload : undefined;
  if (!payload) throw new Error("LIFECYCLE_TASK_PAYLOAD_OBJECT_REQUIRED");
  const nested = isObject(payload.workflowIdentity)
    ? payload.workflowIdentity
    : isObject(payload.aggregate)
      ? payload.aggregate
      : undefined;
  const prefixes = Object.entries(aggregateIdKeys).find(([prefix]) =>
    invocation.taskId.startsWith(prefix),
  )?.[1];
  const candidates = [
    nested?.aggregateId,
    nested?.id,
    payload.aggregateId,
    ...(prefixes?.map((key) => payload[key]) ?? []),
  ];
  const aggregateId = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      candidate.trim().length > 0 &&
      candidate.length <= 255,
  );
  const versionCandidates = [
    nested?.aggregateVersion,
    nested?.version,
    payload.aggregateVersion,
    payload.version,
    payload.runVersion,
  ];
  const aggregateVersion = versionCandidates.find(
    (candidate): candidate is number =>
      typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate >= 1,
  );
  if (aggregateId && aggregateVersion)
    return { aggregateId: aggregateId.trim(), aggregateVersion };

  // Trigger scheduled payloads do not carry a domain aggregate. Treat each UTC
  // schedule occurrence as an immutable scheduler aggregate; the selected
  // executor then queries due domain records and returns a replay-safe summary.
  const timestamp = payload.timestamp;
  if (typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)))
    return {
      aggregateId: `schedule:${createHash("sha256")
        .update(invocation.taskId)
        .update("\0")
        .update(new Date(timestamp).toISOString())
        .digest("hex")}`,
      aggregateVersion: 1,
    };
  if (!aggregateId) throw new Error("LIFECYCLE_TASK_AGGREGATE_ID_REQUIRED");
  throw new Error("LIFECYCLE_TASK_AGGREGATE_VERSION_REQUIRED");
}

export interface AuthoritativeLifecycleTaskStore {
  run(input: {
    taskId: string;
    aggregateId: string;
    scheduled: boolean;
    requestId: string;
  }): Promise<AuthoritativeLifecycleTaskResult>;
}

export interface ProvisioningDispatchStore {
  load(input: {
    attemptId: string;
    orderId: string;
    organizationId: string;
    requestId: string;
  }): Promise<ProvisioningDispatchTarget>;
  record(input: {
    target: ProvisioningDispatchTarget;
    result:
      | { ok: true; operationId: string }
      | {
          ok: false;
          kind: "transient" | "permanent";
          code: string;
          message: string;
        };
    requestId: string;
  }): Promise<unknown>;
}

class AuthoritativeLifecycleTaskHandler implements LifecycleTaskHandler {
  public constructor(private readonly store: AuthoritativeLifecycleTaskStore) {}

  public aggregate(invocation: LifecycleTaskInvocation) {
    return identityFromPayload(invocation);
  }

  public execute(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const aggregate = identityFromPayload(invocation);
    return this.store.run({
      taskId: invocation.taskId,
      aggregateId: aggregate.aggregateId,
      scheduled: aggregate.aggregateId.startsWith("schedule:"),
      requestId: `lifecycle-task:${invocation.triggerRunId}`,
    });
  }
}

class ProvisioningCommandDispatchHandler implements LifecycleTaskHandler {
  public constructor(
    private readonly store: ProvisioningDispatchStore,
    private readonly provider: ProvisioningPort,
  ) {}

  public aggregate(invocation: LifecycleTaskInvocation) {
    const event = ProvisioningRequestedEventSchema.parse(invocation.payload);
    return {
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
    };
  }

  public async execute(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const event = ProvisioningRequestedEventSchema.parse(invocation.payload);
    const target = await this.store.load({
      attemptId: event.aggregateId,
      orderId: event.data.orderId,
      organizationId: event.data.organizationId,
      requestId: `provisioning-load:${invocation.triggerRunId}`,
    });
    if (
      target.attempt.state === "in_flight" ||
      target.attempt.state === "confirmed"
    )
      return {
        operationId: target.attempt.providerOperationId,
        duplicate: true,
      };
    const result = await this.provider.provision({
      orderId: ids.order.parse(target.attempt.command.orderId),
      organizationId: ids.organization.parse(
        target.attempt.command.organizationId,
      ),
      entitlements: target.attempt.command.entitlements.map((entitlement) => ({
        sku: entitlement.sku,
        quantity: entitlement.quantity,
        region: entitlement.region,
      })),
      idempotencyKey: IdempotencyKeySchema.parse(
        target.attempt.command.idempotencyKey,
      ),
    });
    if (!result.ok) {
      await this.store.record({
        target,
        result: {
          ok: false,
          kind: result.kind,
          code: result.code,
          message: result.message,
        },
        requestId: `provisioning-failed:${invocation.triggerRunId}`,
      });
      throw new Error(`PROVISIONING_DISPATCH_FAILED:${result.code}`);
    }
    await this.store.record({
      target,
      result: { ok: true, operationId: result.value.operationId },
      requestId: `provisioning-accepted:${invocation.triggerRunId}`,
    });
    return { operationId: result.value.operationId, duplicate: false };
  }
}

export function createAuthoritativeLifecycleHandlers(input: {
  store: AuthoritativeLifecycleTaskStore;
  provisioning: {
    store: ProvisioningDispatchStore;
    provider: ProvisioningPort;
  };
}): ReadonlyMap<string, LifecycleTaskHandler> {
  const handlers = new Map<string, LifecycleTaskHandler>(
    lifecycleWorkflowRegistry.map((taskId) => [
      taskId,
      new AuthoritativeLifecycleTaskHandler(input.store),
    ]),
  );
  handlers.set(
    "lifecycle-provisioning-command-dispatch-v1",
    new ProvisioningCommandDispatchHandler(
      input.provisioning.store,
      input.provisioning.provider,
    ),
  );
  return handlers;
}
