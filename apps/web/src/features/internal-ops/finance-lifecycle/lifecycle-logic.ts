import type { MigrationRecord } from "./lifecycle-data";

/**
 * Decision logic for the internal lifecycle surfaces.
 *
 * `groupRenewals`, `prioritizeCollections` and `assessRetry` used to live here.
 * The first two moved next to the projection they now read
 * (`renewals-projection.ts`, `collections-projection.ts`). `assessRetry` was
 * deleted: it decided retry safety from a failure class, an attempt ceiling and
 * an idempotency state, and no projection carries any of the three. The retry
 * decision that does have those inputs is the recovery queue's.
 */

export interface MigrationResolution {
  allowed: boolean;
  action: "link" | "create" | "blocked";
  reason: string;
}

export function resolveMigration(
  record: MigrationRecord,
  selectedAccountId: string,
  evidenceConfirmed: boolean,
): MigrationResolution {
  const selectedCandidate = record.candidates.find(
    (candidate) => candidate.id === selectedAccountId,
  );

  if (record.candidates.length > 0 && !selectedCandidate) {
    return {
      allowed: false,
      action: "blocked",
      reason:
        record.candidates.length > 1
          ? "Ambiguous match: select one verified account. New account creation remains blocked."
          : "Select the verified account before continuing.",
    };
  }

  if (!evidenceConfirmed) {
    return {
      allowed: false,
      action: "blocked",
      reason: "Confirm the legal-entity evidence before review.",
    };
  }

  if (selectedCandidate) {
    return {
      allowed: true,
      action: "link",
      reason: `Ready to review linking to ${selectedCandidate.name}. No new account will be created.`,
    };
  }

  return {
    allowed: true,
    action: "create",
    reason:
      "No candidate match was found; new-account creation requires review.",
  };
}

export interface ReviewSummary {
  action: string;
  entity: string;
  impact: string;
  evidence: string;
  policyBasis: string;
  downstreamEffect: string;
  technicalId: string;
  actorAuthority: string;
}

export function buildReviewSummary(
  summary: ReviewSummary,
  reason: string,
): ReviewSummary & { reason: string } {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("A decision reason is required.");
  return { ...summary, reason: normalizedReason };
}
