/** Trial policy is supplied by approved configuration; no launch defaults. */
export interface TrialPolicySnapshot {
  id: string;
  version: number;
  approvalEvidenceId: string;
  durationDays: number;
  gracePeriodDays: number;
  storageLimitBytes: string;
  cumulativeEgressLimitBytes: string;
  maximumCounterAgeSeconds: number;
  egressExhaustion: "disable_all" | "block_egress";
}

export interface TrialEntitlement {
  id: string;
  organizationId: string;
  verifiedDomain: string;
  domainVerificationEvidenceId: string;
  tenantId: string;
  policy: TrialPolicySnapshot;
  startsAt: string;
  expiresAt: string;
  convertedAt?: string;
  paidEntitlementId?: string;
  paidOrderId?: string;
  paidPaygEnrollmentId?: string;
  conversionEvidenceId?: string;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error("TRIAL_INSTANT_INVALID");
  return parsed;
}

function counter(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("TRIAL_COUNTER_INVALID");
  return BigInt(value);
}

function validatePolicy(policy: TrialPolicySnapshot): void {
  if (
    !policy.id.trim() ||
    !policy.approvalEvidenceId.trim() ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    !Number.isSafeInteger(policy.durationDays) ||
    policy.durationDays < 1 ||
    !Number.isSafeInteger(policy.gracePeriodDays) ||
    policy.gracePeriodDays < 0 ||
    !Number.isSafeInteger(policy.maximumCounterAgeSeconds) ||
    policy.maximumCounterAgeSeconds < 1 ||
    !["disable_all", "block_egress"].includes(policy.egressExhaustion) ||
    counter(policy.storageLimitBytes) <= 0n ||
    counter(policy.cumulativeEgressLimitBytes) <= 0n
  )
    throw new Error("TRIAL_APPROVED_POLICY_REQUIRED");
}

/** Caller must atomically claim both verified organization and domain forever. */
export function enrollTrial(input: {
  id: string;
  organizationId: string;
  tenantId: string;
  domain: string;
  domainVerificationEvidenceId: string;
  previousTrials: readonly Pick<
    TrialEntitlement,
    "organizationId" | "verifiedDomain"
  >[];
  policy: TrialPolicySnapshot;
  now: string;
}): TrialEntitlement {
  validatePolicy(input.policy);
  const now = instant(input.now);
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");
  if (
    !input.id.trim() ||
    !input.organizationId.trim() ||
    !input.tenantId.trim() ||
    !input.domainVerificationEvidenceId.trim() ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  )
    throw new Error("TRIAL_VERIFIED_ORGANIZATION_REQUIRED");
  if (
    input.previousTrials.some(
      (trial) =>
        trial.organizationId === input.organizationId ||
        trial.verifiedDomain.toLowerCase().replace(/\.$/, "") === domain,
    )
  )
    throw new Error("TRIAL_ALREADY_USED");
  return {
    id: input.id,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    verifiedDomain: domain,
    domainVerificationEvidenceId: input.domainVerificationEvidenceId,
    policy: structuredClone(input.policy),
    startsAt: input.now,
    expiresAt: new Date(
      now + input.policy.durationDays * 86_400_000,
    ).toISOString(),
  };
}

export interface TrialCounters {
  organizationId: string;
  tenantId: string;
  measuredAt: string;
  storedBytes: string;
  cumulativeEgressBytes: string;
}

/**
 * Evaluate each operation against an authoritative current counter, including
 * reserved/in-flight usage. The provider must reserve the allowed delta
 * atomically; this pure decision is not a distributed quota reservation.
 * Expiry blocks writes. Deletion/retention remains a separately approved policy.
 */
export function evaluateTrialOperation(input: {
  trial: TrialEntitlement;
  counters: TrialCounters;
  now: string;
  operation:
    | { kind: "write"; additionalBytes: string }
    | { kind: "egress"; bytes: string }
    | { kind: "api" };
}): {
  allowed: boolean;
  reason:
    | "allowed"
    | "converted"
    | "not_started"
    | "expired"
    | "disabled"
    | "stale_usage"
    | "storage_limit"
    | "egress_limit";
} {
  const { trial, counters, operation } = input;
  validatePolicy(trial.policy);
  const now = instant(input.now);
  const measuredAt = instant(counters.measuredAt);
  const startsAt = instant(trial.startsAt);
  const expiresAt = instant(trial.expiresAt);
  if (expiresAt !== startsAt + trial.policy.durationDays * 86_400_000)
    throw new Error("TRIAL_DURATION_SNAPSHOT_MISMATCH");
  if (
    counters.organizationId !== trial.organizationId ||
    counters.tenantId !== trial.tenantId
  )
    throw new Error("TRIAL_COUNTER_BINDING_MISMATCH");
  const stored = counter(counters.storedBytes);
  const egress = counter(counters.cumulativeEgressBytes);
  const delta =
    operation.kind === "write"
      ? counter(operation.additionalBytes)
      : operation.kind === "egress"
        ? counter(operation.bytes)
        : 0n;
  if (trial.convertedAt || trial.paidEntitlementId) {
    if (
      !trial.convertedAt ||
      !trial.paidEntitlementId ||
      !trial.paidOrderId === !trial.paidPaygEnrollmentId ||
      !trial.conversionEvidenceId ||
      instant(trial.convertedAt) > now
    )
      throw new Error("TRIAL_CONVERSION_EVIDENCE_INVALID");
    return { allowed: false, reason: "converted" };
  }
  if (now < startsAt) return { allowed: false, reason: "not_started" };
  if (now >= expiresAt + trial.policy.gracePeriodDays * 86_400_000)
    return { allowed: false, reason: "disabled" };
  if (now >= expiresAt && operation.kind === "write")
    return { allowed: false, reason: "expired" };
  if (
    measuredAt > now ||
    now - measuredAt > trial.policy.maximumCounterAgeSeconds * 1000
  )
    return { allowed: false, reason: "stale_usage" };
  if (
    trial.policy.egressExhaustion === "disable_all" &&
    egress >= counter(trial.policy.cumulativeEgressLimitBytes)
  )
    return { allowed: false, reason: "egress_limit" };
  if (
    operation.kind === "write" &&
    (stored >= counter(trial.policy.storageLimitBytes) ||
      stored + delta > counter(trial.policy.storageLimitBytes))
  )
    return { allowed: false, reason: "storage_limit" };
  if (
    operation.kind === "egress" &&
    egress + delta > counter(trial.policy.cumulativeEgressLimitBytes)
  )
    return { allowed: false, reason: "egress_limit" };
  return { allowed: true, reason: "allowed" };
}

/** Conversion requires confirmed paid provisioning and preserves tenant/data. */
export function convertTrial(input: {
  trial: TrialEntitlement;
  now: string;
  paid: {
    entitlementId: string;
    organizationId: string;
    tenantId: string;
    status: "active" | "pending";
    acceptedOrderId?: string;
    paygEnrollmentId?: string;
    provisioningEvidenceId: string;
  };
}): TrialEntitlement {
  const now = instant(input.now);
  if (
    now < instant(input.trial.startsAt) ||
    input.paid.organizationId !== input.trial.organizationId ||
    input.paid.tenantId !== input.trial.tenantId ||
    input.paid.status !== "active" ||
    !input.paid.entitlementId.trim() ||
    !input.paid.acceptedOrderId?.trim() ===
      !input.paid.paygEnrollmentId?.trim() ||
    !input.paid.provisioningEvidenceId.trim()
  )
    throw new Error("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
  if (input.trial.convertedAt) {
    if (
      input.trial.paidEntitlementId !== input.paid.entitlementId ||
      input.trial.paidOrderId !== input.paid.acceptedOrderId ||
      input.trial.paidPaygEnrollmentId !== input.paid.paygEnrollmentId ||
      input.trial.conversionEvidenceId !== input.paid.provisioningEvidenceId
    )
      throw new Error("TRIAL_ALREADY_CONVERTED");
    return structuredClone(input.trial);
  }
  return {
    ...structuredClone(input.trial),
    convertedAt: input.now,
    paidEntitlementId: input.paid.entitlementId,
    ...(input.paid.acceptedOrderId
      ? { paidOrderId: input.paid.acceptedOrderId }
      : {}),
    ...(input.paid.paygEnrollmentId
      ? { paidPaygEnrollmentId: input.paid.paygEnrollmentId }
      : {}),
    conversionEvidenceId: input.paid.provisioningEvidenceId,
  };
}
