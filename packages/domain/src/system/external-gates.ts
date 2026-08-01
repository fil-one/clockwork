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
export const ExternalGateInputProvenanceSchema = z.enum([
  "unverified",
  "repository_fixture",
  "live_signed",
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
export type ExternalGateInputProvenance = z.infer<
  typeof ExternalGateInputProvenanceSchema
>;

export const EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ExternalGateActivationTestResult {
  status: Exclude<ExternalGateActivationTestStatus, "never">;
  testedAt: string;
  testedBy: string;
  evidenceReference: string;
  simulatorState: ExternalGateSimulatorState;
  simulatorDetails: string;
  inputProvenance: ExternalGateInputProvenance;
}

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
  inputProvenance: ExternalGateInputProvenance;
  lastActivationTestStatus: ExternalGateActivationTestStatus;
  lastActivationTestAt: string | null;
  lastActivationTestedBy: string | null;
  activationEvidenceReference: string | null;
  reviewOn: string | null;
  statusReason: string;
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

const liveSignedInputGates = new Set<ExternalGateKey>([
  "EXT-COMMERCIAL-01",
  "EXT-TAX-01",
]);

export function externalGateRequiresLiveSignedInput(
  gateKey: ExternalGateKey,
): boolean {
  return liveSignedInputGates.has(gateKey);
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
  if (record.simulatorState !== "ready") reasons.push("simulator_not_ready");
  if (
    externalGateRequiresLiveSignedInput(record.gateKey) &&
    record.inputProvenance !== "live_signed"
  )
    reasons.push("live_signed_input_missing");
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
