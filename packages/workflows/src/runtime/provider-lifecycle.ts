import { createHash } from "node:crypto";

import {
  IdempotencyKeySchema,
  ids,
  type ProviderResult,
  type ProvisioningPort,
} from "@clockwork/contracts";
import type { ProvisioningDispatchTarget } from "@clockwork/db";
import { z } from "zod";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import type { LifecycleTaskInvocation } from "../onboarding/trigger-runtime";
import type { LifecycleTaskHandler } from "./database-lifecycle";
import {
  ProviderRuntimeDeniedError,
  type ProviderRuntimeDenialCode,
} from "@clockwork/integrations";

export type LifecycleTaskId = (typeof lifecycleWorkflowRegistry)[number];

export type LifecycleAggregateLoader =
  | "account"
  | "procurement_profile"
  | "signature_envelope"
  | "provisioning_attempt"
  | "poc"
  | "quote"
  | "order"
  | "termination"
  | "exception_case"
  | "migration_run";

export type LifecycleEffectBoundary =
  | "screening_provider"
  | "notification_provider"
  | "signature_provider"
  | "evidence_provider"
  | "provisioning_provider"
  | "persisted_transition"
  | "human_wait";

export interface LifecycleTaskExecutionSpec {
  taskId: LifecycleTaskId;
  loader: LifecycleAggregateLoader;
  transition: string;
  effectBoundary: LifecycleEffectBoundary;
}

function executionSpec(
  taskId: LifecycleTaskId,
  loader: LifecycleAggregateLoader,
  transition: string,
  effectBoundary: LifecycleEffectBoundary,
): LifecycleTaskExecutionSpec {
  return Object.freeze({ taskId, loader, transition, effectBoundary });
}

/**
 * Authoritative, exhaustive runtime contract for every Trigger lifecycle ID.
 * Adding an ID to lifecycleWorkflowRegistry is a type error until its persisted
 * loader, transition planner, and typed effect boundary are declared here.
 */
export const lifecycleTaskExecutionSpecs: Readonly<
  Record<LifecycleTaskId, LifecycleTaskExecutionSpec>
> = Object.freeze({
  "lifecycle-onboarding-screening-refresh-v1": executionSpec(
    "lifecycle-onboarding-screening-refresh-v1",
    "account",
    "plan_screening_refresh",
    "screening_provider",
  ),
  "lifecycle-onboarding-procurement-reminders-v1": executionSpec(
    "lifecycle-onboarding-procurement-reminders-v1",
    "procurement_profile",
    "plan_procurement_reminders",
    "notification_provider",
  ),
  "lifecycle-agreements-envelope-dispatch-v1": executionSpec(
    "lifecycle-agreements-envelope-dispatch-v1",
    "signature_envelope",
    "plan_envelope_dispatch",
    "signature_provider",
  ),
  "lifecycle-agreements-signature-reminder-v1": executionSpec(
    "lifecycle-agreements-signature-reminder-v1",
    "signature_envelope",
    "plan_signature_reminder",
    "notification_provider",
  ),
  "lifecycle-agreements-evidence-ingestion-v1": executionSpec(
    "lifecycle-agreements-evidence-ingestion-v1",
    "signature_envelope",
    "plan_signature_evidence_ingestion",
    "evidence_provider",
  ),
  "lifecycle-provisioning-command-dispatch-v1": executionSpec(
    "lifecycle-provisioning-command-dispatch-v1",
    "provisioning_attempt",
    "plan_provisioning_dispatch",
    "provisioning_provider",
  ),
  "lifecycle-provisioning-confirmation-ingestion-v1": executionSpec(
    "lifecycle-provisioning-confirmation-ingestion-v1",
    "provisioning_attempt",
    "plan_provisioning_confirmation",
    "persisted_transition",
  ),
  "lifecycle-provisioning-stuck-recovery-v1": executionSpec(
    "lifecycle-provisioning-stuck-recovery-v1",
    "provisioning_attempt",
    "plan_stuck_provisioning_recovery",
    "provisioning_provider",
  ),
  "lifecycle-pocs-milestones-v1": executionSpec(
    "lifecycle-pocs-milestones-v1",
    "poc",
    "plan_poc_milestones",
    "notification_provider",
  ),
  "lifecycle-pocs-expiry-v1": executionSpec(
    "lifecycle-pocs-expiry-v1",
    "poc",
    "plan_poc_expiry",
    "persisted_transition",
  ),
  "lifecycle-pocs-proposal-v1": executionSpec(
    "lifecycle-pocs-proposal-v1",
    "poc",
    "plan_poc_proposal",
    "persisted_transition",
  ),
  "lifecycle-pocs-conversion-v1": executionSpec(
    "lifecycle-pocs-conversion-v1",
    "poc",
    "plan_poc_conversion",
    "provisioning_provider",
  ),
  "lifecycle-quotes-expiry-alerts-v1": executionSpec(
    "lifecycle-quotes-expiry-alerts-v1",
    "quote",
    "plan_quote_expiry_alert",
    "notification_provider",
  ),
  "lifecycle-renewals-term-alerts-v1": executionSpec(
    "lifecycle-renewals-term-alerts-v1",
    "order",
    "plan_renewal_term_alerts",
    "notification_provider",
  ),
  "lifecycle-renewals-notice-windows-v1": executionSpec(
    "lifecycle-renewals-notice-windows-v1",
    "order",
    "plan_renewal_notice_windows",
    "notification_provider",
  ),
  "lifecycle-renewals-auto-renew-evaluation-v1": executionSpec(
    "lifecycle-renewals-auto-renew-evaluation-v1",
    "order",
    "plan_auto_renewal",
    "persisted_transition",
  ),
  "lifecycle-offboarding-retrieval-window-v1": executionSpec(
    "lifecycle-offboarding-retrieval-window-v1",
    "termination",
    "plan_retrieval_window",
    "notification_provider",
  ),
  "lifecycle-offboarding-retention-release-v1": executionSpec(
    "lifecycle-offboarding-retention-release-v1",
    "termination",
    "plan_retention_release",
    "persisted_transition",
  ),
  "lifecycle-offboarding-teardown-v1": executionSpec(
    "lifecycle-offboarding-teardown-v1",
    "termination",
    "plan_teardown",
    "provisioning_provider",
  ),
  "lifecycle-offboarding-confirmation-v1": executionSpec(
    "lifecycle-offboarding-confirmation-v1",
    "termination",
    "plan_teardown_confirmation",
    "persisted_transition",
  ),
  "lifecycle-exceptions-escalation-v1": executionSpec(
    "lifecycle-exceptions-escalation-v1",
    "exception_case",
    "plan_exception_escalation",
    "notification_provider",
  ),
  "lifecycle-exceptions-human-decision-v1": executionSpec(
    "lifecycle-exceptions-human-decision-v1",
    "exception_case",
    "plan_human_decision",
    "human_wait",
  ),
  "lifecycle-migrations-discovery-v1": executionSpec(
    "lifecycle-migrations-discovery-v1",
    "migration_run",
    "plan_migration_discovery",
    "persisted_transition",
  ),
  "lifecycle-migrations-scheduled-batch-v1": executionSpec(
    "lifecycle-migrations-scheduled-batch-v1",
    "migration_run",
    "plan_migration_batch",
    "persisted_transition",
  ),
  "lifecycle-migrations-review-wait-v1": executionSpec(
    "lifecycle-migrations-review-wait-v1",
    "migration_run",
    "plan_migration_review",
    "human_wait",
  ),
});

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
  "lifecycle-quotes-": ["quoteId"],
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
  scheduled: boolean;
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
    return {
      aggregateId: aggregateId.trim(),
      aggregateVersion,
      scheduled: false,
    };

  // Trigger scheduled payloads do not carry a domain aggregate. Treat each UTC
  // schedule occurrence as an immutable scheduler aggregate; the selected
  // executor then queries due domain records and returns a replay-safe summary.
  const timestamp =
    payload.timestamp instanceof Date
      ? payload.timestamp.getTime()
      : typeof payload.timestamp === "string"
        ? Date.parse(payload.timestamp)
        : Number.NaN;
  if (Number.isFinite(timestamp)) {
    const digest = createHash("sha256")
      .update(invocation.taskId)
      .update("\0")
      .update(new Date(timestamp).toISOString())
      .digest("hex");
    // workflow_runs.aggregate_id is UUID. Use a deterministic RFC 4122-shaped
    // identifier so a recovered schedule occurrence claims the same row.
    const aggregateId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return {
      aggregateId,
      aggregateVersion: 1,
      scheduled: true,
    };
  }
  if (!aggregateId) throw new Error("LIFECYCLE_TASK_AGGREGATE_ID_REQUIRED");
  throw new Error("LIFECYCLE_TASK_AGGREGATE_VERSION_REQUIRED");
}

export interface AuthoritativeLifecycleTaskStore {
  prepare(input: {
    spec: LifecycleTaskExecutionSpec;
    aggregateId: string;
    expectedAggregateVersion: number;
    scheduled: boolean;
    requestId: string;
  }): Promise<readonly LifecyclePreparedEffect[]>;
  claimEffect(input: {
    effect: LifecyclePreparedEffect;
    requestId: string;
  }): Promise<
    | { status: "invoke"; leaseToken: string }
    | {
        status: "provider_succeeded";
        leaseToken: string;
        reference: string;
        output?: unknown;
      }
    | { status: "committed"; reference: string; output?: unknown }
    | { status: "permanent_failure"; code: string }
  >;
  checkpointEffectSuccess(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void>;
  finalizeEffect(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void>;
  failEffect(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    failure: {
      kind: "transient" | "permanent";
      code: string;
      message: string;
    };
    requestId: string;
  }): Promise<void>;
}

export interface LifecyclePreparedEffect {
  effectKey: string;
  taskId: string;
  aggregateId: string;
  aggregateVersion: number;
  loader: LifecycleAggregateLoader;
  transition: string;
  effectBoundary: LifecycleEffectBoundary;
  /** Authoritative in-memory state; never copied wholesale to audit/outbox. */
  persistedState: Readonly<Record<string, unknown>>;
}

export interface LifecycleEffectExecutor {
  /** Authorization must run before the durable effect ledger is created. */
  authorize(effect: LifecyclePreparedEffect): Promise<void>;
  execute(
    effect: LifecyclePreparedEffect,
  ): Promise<ProviderResult<{ reference: string; output?: unknown }>>;
}

export interface ProvisioningDispatchStore {
  load(input: {
    attemptId: string;
    orderId: string;
    organizationId: string;
    expectedAggregateVersion: number;
    requestId: string;
  }): Promise<ProvisioningDispatchTarget>;
  claimProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    requestId: string;
  }): Promise<
    | { status: "invoke"; leaseToken: string }
    | { status: "succeeded"; leaseToken: string; operationId: string }
    | { status: "permanent_failure"; code: string }
  >;
  checkpointProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    leaseToken: string;
    result:
      | { ok: true; operationId: string }
      | {
          ok: false;
          kind: "transient" | "permanent";
          code: string;
          message: string;
        };
    requestId: string;
  }): Promise<void>;
  finalizeProviderEffect(input: {
    target: ProvisioningDispatchTarget;
    leaseToken: string;
    operationId: string;
    requestId: string;
  }): Promise<void>;
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
  public constructor(
    private readonly store: AuthoritativeLifecycleTaskStore,
    private readonly spec: LifecycleTaskExecutionSpec,
    private readonly effects: LifecycleEffectExecutor,
  ) {}

  public aggregate(invocation: LifecycleTaskInvocation) {
    const { aggregateId, aggregateVersion } = identityFromPayload(invocation);
    return { aggregateId, aggregateVersion };
  }

  public async execute(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const aggregate = identityFromPayload(invocation);
    const effects = await this.store.prepare({
      spec: this.spec,
      aggregateId: aggregate.aggregateId,
      expectedAggregateVersion: aggregate.aggregateVersion,
      scheduled: aggregate.scheduled,
      requestId: `lifecycle-task:${invocation.triggerRunId}`,
    });
    let invoked = 0;
    let recovered = 0;
    let duplicates = 0;
    for (const effect of effects) {
      if (
        effect.effectBoundary !== "persisted_transition" &&
        effect.effectBoundary !== "human_wait"
      )
        await this.effects.authorize(effect);
      const claim = await this.store.claimEffect({
        effect,
        requestId: `lifecycle-effect-claim:${invocation.triggerRunId}`,
      });
      if (claim.status === "committed") {
        duplicates += 1;
        continue;
      }
      if (claim.status === "permanent_failure")
        throw new Error(`LIFECYCLE_EFFECT_PREVIOUSLY_FAILED:${claim.code}`);
      let reference: string;
      let output: unknown;
      const leaseToken = claim.leaseToken;
      if (claim.status === "provider_succeeded") {
        reference = claim.reference;
        output = claim.output;
        recovered += 1;
      } else if (
        effect.effectBoundary === "persisted_transition" ||
        effect.effectBoundary === "human_wait"
      ) {
        reference = `internal:${effect.effectKey}`;
        output = { transition: effect.transition };
        await this.store.checkpointEffectSuccess({
          effect,
          leaseToken,
          reference,
          output,
          requestId: `lifecycle-effect-checkpoint:${invocation.triggerRunId}`,
        });
      } else {
        const result = await this.effects.execute(effect);
        invoked += 1;
        if (!result.ok) {
          if (isProviderRuntimeDenialCode(result.code))
            throw new ProviderRuntimeDeniedError(result.code);
          await this.store.failEffect({
            effect,
            leaseToken,
            failure: {
              kind: result.kind,
              code: result.code,
              message: result.message,
            },
            requestId: `lifecycle-effect-failed:${invocation.triggerRunId}`,
          });
          throw new Error(`LIFECYCLE_EFFECT_FAILED:${result.code}`);
        }
        reference = result.value.reference;
        output = result.value.output;
        await this.store.checkpointEffectSuccess({
          effect,
          leaseToken,
          reference,
          ...(output === undefined ? {} : { output }),
          requestId: `lifecycle-effect-checkpoint:${invocation.triggerRunId}`,
        });
      }
      await this.store.finalizeEffect({
        effect,
        leaseToken,
        reference,
        ...(output === undefined ? {} : { output }),
        requestId: `lifecycle-effect-finalize:${invocation.triggerRunId}`,
      });
    }
    return {
      taskId: this.spec.taskId,
      status: "authoritative_execution_completed",
      effects: effects.length,
      invoked,
      recovered,
      duplicates,
    };
  }
}

const missingLifecycleEffectExecutor: LifecycleEffectExecutor = {
  authorize: (effect) =>
    Promise.reject(
      new Error(
        `WORKFLOW_PROVIDER_NOT_CONFIGURED:lifecycle_effect:${effect.effectBoundary}`,
      ),
    ),
  execute: (effect) =>
    Promise.reject(
      new Error(
        `WORKFLOW_PROVIDER_NOT_CONFIGURED:lifecycle_effect:${effect.effectBoundary}`,
      ),
    ),
};

const providerRuntimeDenialCodes = new Set<ProviderRuntimeDenialCode>([
  "PRODUCTION_SIMULATOR_FORBIDDEN",
  "PROVIDER_GATE_REGISTER_UNAVAILABLE",
  "PROVIDER_GATE_INACTIVE",
  "PROVIDER_EFFECT_IDEMPOTENCY_REQUIRED",
  "RECOVERY_EFFECT_FORBIDDEN",
]);

function isProviderRuntimeDenialCode(
  code: string,
): code is ProviderRuntimeDenialCode {
  return providerRuntimeDenialCodes.has(code as ProviderRuntimeDenialCode);
}

class ProvisioningCommandDispatchHandler implements LifecycleTaskHandler {
  public constructor(
    private readonly store: ProvisioningDispatchStore,
    private readonly provider: ProvisioningPort,
    private readonly effects: LifecycleEffectExecutor,
    private readonly providerTimeoutMs = 30_000,
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
      expectedAggregateVersion: event.aggregateVersion,
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
    const effect: LifecyclePreparedEffect = {
      effectKey: target.attempt.command.idempotencyKey,
      taskId: invocation.taskId,
      aggregateId: target.attemptId,
      aggregateVersion: target.rowVersion,
      loader: "provisioning_attempt",
      transition: "plan_provisioning_dispatch",
      effectBoundary: "provisioning_provider",
      persistedState: target.attempt as unknown as Readonly<
        Record<string, unknown>
      >,
    };
    await this.effects.authorize(effect);
    const checkpoint = await this.store.claimProviderEffect({
      target,
      requestId: `provisioning-effect-claim:${invocation.triggerRunId}`,
    });
    if (checkpoint.status === "permanent_failure")
      throw new Error(
        `PROVISIONING_DISPATCH_PREVIOUSLY_FAILED:${checkpoint.code}`,
      );
    if (checkpoint.status === "succeeded") {
      await this.store.record({
        target,
        result: { ok: true, operationId: checkpoint.operationId },
        requestId: `provisioning-recovered:${invocation.triggerRunId}`,
      });
      await this.store.finalizeProviderEffect({
        target,
        leaseToken: checkpoint.leaseToken,
        operationId: checkpoint.operationId,
        requestId: `provisioning-effect-finalize:${invocation.triggerRunId}`,
      });
      return {
        operationId: checkpoint.operationId,
        duplicate: true,
        recoveredFromCheckpoint: true,
      };
    }
    const result = await withProviderTimeout(
      this.provider.provision({
        orderId: ids.order.parse(target.attempt.command.orderId),
        organizationId: ids.organization.parse(
          target.attempt.command.organizationId,
        ),
        entitlements: target.attempt.command.entitlements.map(
          (entitlement) => ({
            sku: entitlement.sku,
            quantity: entitlement.quantity,
            region: entitlement.region,
          }),
        ),
        idempotencyKey: IdempotencyKeySchema.parse(
          target.attempt.command.idempotencyKey,
        ),
      }),
      this.providerTimeoutMs,
    );
    if (!result.ok) {
      if (isProviderRuntimeDenialCode(result.code))
        throw new ProviderRuntimeDeniedError(result.code);
      await this.store.checkpointProviderEffect({
        target,
        leaseToken: checkpoint.leaseToken,
        result: {
          ok: false,
          kind: result.kind,
          code: result.code,
          message: result.message,
        },
        requestId: `provisioning-effect-failed:${invocation.triggerRunId}`,
      });
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
    await this.store.checkpointProviderEffect({
      target,
      leaseToken: checkpoint.leaseToken,
      result: { ok: true, operationId: result.value.operationId },
      requestId: `provisioning-effect-succeeded:${invocation.triggerRunId}`,
    });
    await this.store.record({
      target,
      result: { ok: true, operationId: result.value.operationId },
      requestId: `provisioning-accepted:${invocation.triggerRunId}`,
    });
    await this.store.finalizeProviderEffect({
      target,
      leaseToken: checkpoint.leaseToken,
      operationId: result.value.operationId,
      requestId: `provisioning-effect-finalize:${invocation.triggerRunId}`,
    });
    return { operationId: result.value.operationId, duplicate: false };
  }
}

function withProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<
  | T
  | {
      ok: false;
      kind: "transient";
      code: "PROVIDER_TIMEOUT";
      message: "Provider operation timed out";
    }
> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("LIFECYCLE_PROVIDER_TIMEOUT_INVALID");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        resolve({
          ok: false,
          kind: "transient",
          code: "PROVIDER_TIMEOUT",
          message: "Provider operation timed out",
        }),
      timeoutMs,
    );
    timeout.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error
            ? error
            : new Error("LIFECYCLE_PROVIDER_REJECTED"),
        );
      },
    );
  });
}

export function createAuthoritativeLifecycleHandlers(input: {
  store: AuthoritativeLifecycleTaskStore;
  effects?: LifecycleEffectExecutor;
  provisioning: {
    store: ProvisioningDispatchStore;
    provider: ProvisioningPort;
    timeoutMs?: number;
  };
}): ReadonlyMap<string, LifecycleTaskHandler> {
  const handlers = new Map<string, LifecycleTaskHandler>(
    lifecycleWorkflowRegistry.map((taskId) => [
      taskId,
      new AuthoritativeLifecycleTaskHandler(
        input.store,
        lifecycleTaskExecutionSpecs[taskId],
        input.effects ?? missingLifecycleEffectExecutor,
      ),
    ]),
  );
  handlers.set(
    "lifecycle-provisioning-command-dispatch-v1",
    new ProvisioningCommandDispatchHandler(
      input.provisioning.store,
      input.provisioning.provider,
      input.effects ?? missingLifecycleEffectExecutor,
      input.provisioning.timeoutMs,
    ),
  );
  return handlers;
}
