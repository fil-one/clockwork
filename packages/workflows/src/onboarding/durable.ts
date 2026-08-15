import { createHash } from "node:crypto";

export const LIFECYCLE_RETRY_POLICY = Object.freeze({
  maxAttempts: 8,
  minDelayMs: 1_000,
  maxDelayMs: 300_000,
  factor: 2,
});

export interface WorkflowIdentity {
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  operation: string;
}

export interface WorkflowEffect<
  TKind extends string = string,
  TPayload = Readonly<Record<string, unknown>>,
> {
  kind: TKind;
  idempotencyKey: string;
  payload: TPayload;
  executeAt?: string;
}

export interface DurableHumanWait {
  kind: "human_wait";
  waitKey: string;
  subjectType: string;
  subjectId: string;
  resumeEvents: readonly string[];
  expiresAt: string;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}_REQUIRED`);
  return normalized;
}

export function effectIdempotencyKey(
  identity: WorkflowIdentity,
  effectDiscriminator: string,
): string {
  if (
    !Number.isSafeInteger(identity.aggregateVersion) ||
    identity.aggregateVersion < 1
  )
    throw new Error("AGGREGATE_VERSION_INVALID");
  const canonical = [
    required(identity.aggregateType, "AGGREGATE_TYPE"),
    required(identity.aggregateId, "AGGREGATE_ID"),
    String(identity.aggregateVersion),
    required(identity.operation, "OPERATION"),
    required(effectDiscriminator, "EFFECT_DISCRIMINATOR"),
  ].join(":");
  return `lifecycle:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function workflowEffect<TKind extends string, TPayload>(
  identity: WorkflowIdentity,
  effectDiscriminator: string,
  kind: TKind,
  payload: TPayload,
  executeAt?: string,
): WorkflowEffect<TKind, TPayload> {
  if (executeAt !== undefined && !Number.isFinite(Date.parse(executeAt)))
    throw new Error("EFFECT_EXECUTION_TIME_INVALID");
  return {
    kind,
    idempotencyKey: effectIdempotencyKey(identity, effectDiscriminator),
    payload,
    ...(executeAt === undefined ? {} : { executeAt }),
  };
}

export function durableHumanWait(input: {
  identity: WorkflowIdentity;
  discriminator: string;
  subjectType: string;
  subjectId: string;
  resumeEvents: readonly string[];
  expiresAt: string;
}): DurableHumanWait {
  if (input.resumeEvents.length === 0) throw new Error("RESUME_EVENT_REQUIRED");
  if (!Number.isFinite(Date.parse(input.expiresAt)))
    throw new Error("WAIT_EXPIRY_INVALID");
  return Object.freeze({
    kind: "human_wait",
    waitKey: effectIdempotencyKey(
      input.identity,
      `wait:${input.discriminator}`,
    ),
    subjectType: required(input.subjectType, "WAIT_SUBJECT_TYPE"),
    subjectId: required(input.subjectId, "WAIT_SUBJECT_ID"),
    resumeEvents: Object.freeze([...new Set(input.resumeEvents)].sort()),
    expiresAt: input.expiresAt,
  });
}

export type ProviderFailure = Readonly<{
  kind: "transient" | "permanent";
  code: string;
  message: string;
  retryAfterMs?: number;
}>;

export type EffectFailureDisposition =
  | Readonly<{
      status: "retry_scheduled";
      attempt: number;
      nextAttemptAt: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      status: "dead_lettered";
      attempt: number;
      idempotencyKey: string;
      operatorRecoveryKey: string;
      reason: string;
    }>;

export function retryDelayMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error("ATTEMPT_INVALID");
  return Math.min(
    LIFECYCLE_RETRY_POLICY.maxDelayMs,
    LIFECYCLE_RETRY_POLICY.minDelayMs *
      LIFECYCLE_RETRY_POLICY.factor ** (attempt - 1),
  );
}

/** Uniform sample over the closed interval [0, 1]. */
export type RetryJitterSource = () => number;

/**
 * Equal jitter over `retryDelayMs`: the lower half of the backoff is still a
 * floor, the upper half is spread. Every run failed by one provider outage
 * shares an attempt number, so the undithered schedule wakes them together and
 * the outage recurs on the retry. Determinism is a test requirement rather than
 * a production one, so the sample is injected and never read from a module.
 */
export function jitteredRetryDelayMs(
  attempt: number,
  jitter: RetryJitterSource,
): number {
  const base = retryDelayMs(attempt);
  const sample = jitter();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1)
    throw new Error("RETRY_JITTER_SAMPLE_INVALID");
  const spread = Math.floor(base / 2);
  return base - spread + Math.round(sample * spread);
}

export function disposeEffectFailure(input: {
  identity: WorkflowIdentity;
  effectDiscriminator: string;
  attempt: number;
  failure: ProviderFailure;
  failedAt: string;
  jitter?: RetryJitterSource;
}): EffectFailureDisposition {
  if (!Number.isFinite(Date.parse(input.failedAt)))
    throw new Error("FAILED_AT_INVALID");
  const key = effectIdempotencyKey(input.identity, input.effectDiscriminator);
  if (
    input.failure.kind === "permanent" ||
    input.attempt >= LIFECYCLE_RETRY_POLICY.maxAttempts
  ) {
    return Object.freeze({
      status: "dead_lettered",
      attempt: input.attempt,
      idempotencyKey: key,
      operatorRecoveryKey: effectIdempotencyKey(
        {
          ...input.identity,
          operation: `${input.identity.operation}.operator-recovery`,
        },
        input.effectDiscriminator,
      ),
      reason: `${input.failure.code}:${input.failure.message}`,
    });
  }
  const requested = input.failure.retryAfterMs;
  // A provider-supplied Retry-After is an instruction, not a guess, so it is
  // clamped but never dithered. Only the backoff this module computes is.
  const delay =
    requested === undefined
      ? jitteredRetryDelayMs(input.attempt, input.jitter ?? Math.random)
      : Math.max(0, Math.min(requested, LIFECYCLE_RETRY_POLICY.maxDelayMs));
  return Object.freeze({
    status: "retry_scheduled",
    attempt: input.attempt,
    nextAttemptAt: new Date(Date.parse(input.failedAt) + delay).toISOString(),
    idempotencyKey: key,
  });
}
