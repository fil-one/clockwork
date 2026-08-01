import { z } from "zod";

import type { Actor } from "@clockwork/contracts";

export const externalGateKeys = [
  "EXT-ACC-01",
  "EXT-LEGAL-01",
  "EXT-COMMERCIAL-01",
  "EXT-PROVIDER-01",
  "EXT-PROVISION-01",
  "EXT-TAX-01",
  "EXT-DOMAIN-01",
  "EXT-BRAND-01",
  "EXT-APPROVERS-01",
  "EXT-TEARDOWN-01",
  "EXT-MARKETPLACE-01",
  "EXT-MIGRATION-01",
] as const;

export const ExternalGateKeySchema = z.enum(externalGateKeys);
export const ExternalGateConfiguredStatusSchema = z.enum([
  "blocked",
  "review",
  "pending",
  "active",
  "not_required",
]);
export const ExternalGateSimulatorStateSchema = z.enum([
  "ready",
  "degraded",
  "unavailable",
]);
export const ExternalGateActivationTestStatusSchema = z.enum([
  "never",
  "passed",
  "failed",
]);

export const externalCapabilities = [
  "new_business",
  "legal_execution",
  "provisioning_invoicing",
  "partner",
  "white_label",
  "marketplace",
  "teardown",
  "migration",
] as const;
export const ExternalCapabilitySchema = z.enum(externalCapabilities);
export const externalGateBoundaries = [
  "lifecycle",
  "provider_effect",
  "replay",
  "assisted_action",
  "redrive",
  "recovery",
] as const;
export const ExternalGateBoundarySchema = z.enum(externalGateBoundaries);
export const ExternalGateEffectIntentSchema = z.enum([
  "external_effect",
  "local_recovery",
]);

export type ExternalGateKey = z.infer<typeof ExternalGateKeySchema>;
export type ExternalGateConfiguredStatus = z.infer<
  typeof ExternalGateConfiguredStatusSchema
>;
export type ExternalGateSimulatorState = z.infer<
  typeof ExternalGateSimulatorStateSchema
>;
export type ExternalGateActivationTestStatus = z.infer<
  typeof ExternalGateActivationTestStatusSchema
>;
export type ExternalCapability = z.infer<typeof ExternalCapabilitySchema>;
export type ExternalGateBoundary = z.infer<typeof ExternalGateBoundarySchema>;
export type ExternalGateEffectIntent = z.infer<
  typeof ExternalGateEffectIntentSchema
>;

export const EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ExternalGateActivationTestResult {
  status: Exclude<ExternalGateActivationTestStatus, "never">;
  testedAt: string;
  testedBy: string;
  evidenceReference: string;
  simulatorState: ExternalGateSimulatorState;
  simulatorDetails: string;
}

export const ExternalGateActivationTestResultSchema = z.object({
  status: z.enum(["passed", "failed"]),
  testedAt: z.string().datetime({ offset: true }),
  testedBy: z.string().min(1),
  evidenceReference: z.string().min(8),
  simulatorState: ExternalGateSimulatorStateSchema,
  simulatorDetails: z.string().min(1),
});

export interface ActivationTestRunner {
  run(input: {
    gate: ExternalGateView;
    actor: Actor;
    requestId: string;
    requestedAt: Date;
  }): Promise<ExternalGateActivationTestResult>;
}

export interface ExternalGateRecord {
  id: string;
  gateKey: ExternalGateKey;
  title: string;
  owner: string;
  inputRequired: string;
  affectedFeature: string;
  severity: string;
  configuredStatus: ExternalGateConfiguredStatus;
  simulatorState: ExternalGateSimulatorState;
  simulatorDetails: string;
  lastActivationTestStatus: ExternalGateActivationTestStatus;
  lastActivationTestAt: string | null;
  lastActivationTestedBy: string | null;
  activationEvidenceReference: string | null;
  reviewOn: string | null;
  statusReason: string;
  emergencyDisabledAt?: string | null;
  emergencyDisabledBy?: string | null;
  emergencyDisableReason?: string | null;
  emergencyDisableEvidenceReference?: string | null;
  rowVersion: number;
  updatedAt: string;
}

export interface ExternalGateView extends ExternalGateRecord {
  effectiveStatus: ExternalGateConfiguredStatus;
  activationAllowed: boolean;
  blockedReasons: readonly string[];
}

export class ExternalGatePolicyError extends Error {
  public constructor(
    public readonly code:
      "EXTERNAL_GATE_ACTIVATION_DENIED" | "EXTERNAL_GATE_NOT_REQUIRED_DENIED",
    message: string,
  ) {
    super(message);
    this.name = "ExternalGatePolicyError";
  }
}

function nonEmpty(value: string | null): boolean {
  return Boolean(value?.trim());
}

function reviewIsCurrent(reviewOn: string | null, now: Date): boolean {
  if (!reviewOn) return false;
  const reviewEndsAt = Date.parse(`${reviewOn}T23:59:59.999Z`);
  return Number.isFinite(reviewEndsAt) && reviewEndsAt >= now.getTime();
}

/**
 * Authoritative mapping from a business capability to every external input
 * whose activation can cause a new external side effect. The mapping is kept
 * in the domain package so lifecycle, provider, replay, assisted action,
 * redrive, and recovery callers cannot quietly diverge.
 */
export const externalCapabilityGateMatrix = Object.freeze({
  new_business: ["EXT-ACC-01", "EXT-COMMERCIAL-01", "EXT-LEGAL-01"],
  legal_execution: ["EXT-LEGAL-01", "EXT-PROVIDER-01"],
  provisioning_invoicing: [
    "EXT-ACC-01",
    "EXT-PROVIDER-01",
    "EXT-PROVISION-01",
    "EXT-TAX-01",
  ],
  partner: ["EXT-COMMERCIAL-01", "EXT-LEGAL-01", "EXT-PROVIDER-01"],
  white_label: ["EXT-DOMAIN-01", "EXT-BRAND-01", "EXT-PROVIDER-01"],
  marketplace: [
    "EXT-MARKETPLACE-01",
    "EXT-ACC-01",
    "EXT-PROVIDER-01",
    "EXT-PROVISION-01",
    "EXT-TAX-01",
  ],
  teardown: ["EXT-TEARDOWN-01", "EXT-APPROVERS-01", "EXT-PROVISION-01"],
  migration: ["EXT-MIGRATION-01", "EXT-APPROVERS-01", "EXT-ACC-01"],
} as const satisfies Readonly<
  Record<ExternalCapability, readonly ExternalGateKey[]>
>);

export interface ExternalCapabilityAuthorization {
  capability: ExternalCapability;
  boundary: ExternalGateBoundary;
  effectIntent: ExternalGateEffectIntent;
  allowed: boolean;
  requiredGateKeys: readonly ExternalGateKey[];
  deniedGateKeys: readonly ExternalGateKey[];
  permitsOutbox: boolean;
  permitsProviderEffect: boolean;
}

/** Local state repair is deliberately independent and can never emit outbox/provider work. */
export function evaluateExternalCapabilityAuthorization(input: {
  capability: ExternalCapability;
  boundary: ExternalGateBoundary;
  effectIntent: ExternalGateEffectIntent;
  gates: ReadonlyMap<ExternalGateKey, ExternalGateView>;
}): ExternalCapabilityAuthorization {
  if (input.boundary === "recovery" && input.effectIntent === "local_recovery")
    return {
      capability: input.capability,
      boundary: input.boundary,
      effectIntent: input.effectIntent,
      allowed: true,
      requiredGateKeys: [],
      deniedGateKeys: [],
      permitsOutbox: false,
      permitsProviderEffect: false,
    };
  const requiredGateKeys = externalCapabilityGateMatrix[input.capability];
  const deniedGateKeys = requiredGateKeys.filter(
    (gateKey) => input.gates.get(gateKey)?.activationAllowed !== true,
  );
  const allowed = deniedGateKeys.length === 0;
  return {
    capability: input.capability,
    boundary: input.boundary,
    effectIntent: input.effectIntent,
    allowed,
    requiredGateKeys,
    deniedGateKeys,
    permitsOutbox: allowed,
    permitsProviderEffect: allowed,
  };
}

export async function executeExternalCapabilityBoundary<T>(input: {
  authorization: ExternalCapabilityAuthorization;
  performExternalEffect: () => Promise<T>;
  enqueueOutbox: (result: T) => Promise<void>;
  performLocalRecovery?: () => Promise<T>;
}): Promise<T> {
  if (!input.authorization.allowed)
    throw new Error(
      `EXTERNAL_CAPABILITY_DENIED:${input.authorization.capability}:${input.authorization.boundary}:${input.authorization.deniedGateKeys.join(",")}`,
    );
  if (
    input.authorization.boundary === "recovery" &&
    input.authorization.effectIntent === "local_recovery"
  ) {
    if (!input.performLocalRecovery)
      throw new Error("EXTERNAL_CAPABILITY_LOCAL_RECOVERY_REQUIRED");
    return input.performLocalRecovery();
  }
  if (
    !input.authorization.permitsProviderEffect ||
    !input.authorization.permitsOutbox
  )
    throw new Error("EXTERNAL_CAPABILITY_EFFECT_NOT_PERMITTED");
  const result = await input.performExternalEffect();
  await input.enqueueOutbox(result);
  return result;
}

export function externalGateActivationTestIsCurrent(
  testedAt: string | null,
  now: Date,
): boolean {
  if (!testedAt) return false;
  const timestamp = Date.parse(testedAt);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  return now.getTime() - timestamp <= EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS;
}

export function sanitizeActivationEvidenceReference(value: string): string {
  const trimmed = value.trim();
  const containsControlCharacter = [...trimmed].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (trimmed.length < 8 || trimmed.length > 512 || containsControlCharacter)
    throw new Error("Activation evidence reference is invalid");
  let reference: URL;
  try {
    reference = new URL(trimmed);
  } catch {
    throw new Error("Activation evidence reference must be an absolute URI");
  }
  if (
    !["evidence:", "https:", "s3:", "urn:"].includes(reference.protocol) ||
    reference.username ||
    reference.password
  )
    throw new Error("Activation evidence reference uses an unsafe URI");
  reference.search = "";
  reference.hash = "";
  return reference.toString();
}

export function externalGateBlockedReasons(
  record: ExternalGateRecord,
  now: Date,
): readonly string[] {
  const reasons: string[] = [];
  if (!nonEmpty(record.owner)) reasons.push("owner_missing");
  if (!nonEmpty(record.inputRequired)) reasons.push("input_missing");
  if (record.emergencyDisabledAt) reasons.push("emergency_disabled");
  if (record.simulatorState !== "ready") reasons.push("simulator_not_ready");
  if (record.lastActivationTestStatus !== "passed")
    reasons.push("activation_test_not_passed");
  if (!record.lastActivationTestAt)
    reasons.push("activation_test_time_missing");
  else if (
    !externalGateActivationTestIsCurrent(record.lastActivationTestAt, now)
  )
    reasons.push("activation_test_expired");
  if (!nonEmpty(record.lastActivationTestedBy))
    reasons.push("activation_tester_missing");
  if (!nonEmpty(record.activationEvidenceReference))
    reasons.push("activation_evidence_missing");
  if (!reviewIsCurrent(record.reviewOn, now))
    reasons.push("review_missing_or_expired");
  return reasons;
}

export function evaluateExternalGate(
  record: ExternalGateRecord,
  now = new Date(),
): ExternalGateView {
  const blockedReasons = externalGateBlockedReasons(record, now);
  const activationAllowed =
    record.configuredStatus === "active" && blockedReasons.length === 0;
  return {
    ...record,
    effectiveStatus:
      record.configuredStatus === "active" && !activationAllowed
        ? "blocked"
        : record.configuredStatus,
    activationAllowed,
    blockedReasons,
  };
}

export function assertExternalGateTransition(
  record: ExternalGateRecord,
  now = new Date(),
): void {
  if (
    record.configuredStatus === "active" &&
    externalGateBlockedReasons(record, now).length > 0
  )
    throw new ExternalGatePolicyError(
      "EXTERNAL_GATE_ACTIVATION_DENIED",
      "An external gate cannot activate without a ready simulator, a current passing activation test, evidence, owner, and required input.",
    );
  if (
    record.configuredStatus === "not_required" &&
    (!nonEmpty(record.statusReason) ||
      !nonEmpty(record.activationEvidenceReference) ||
      !reviewIsCurrent(record.reviewOn, now))
  )
    throw new ExternalGatePolicyError(
      "EXTERNAL_GATE_NOT_REQUIRED_DENIED",
      "A not-required decision needs a reason, evidence, and a current review date.",
    );
}
