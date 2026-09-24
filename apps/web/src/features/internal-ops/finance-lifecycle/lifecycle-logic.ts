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

/**
 * Why a migration record may or may not go to review, as a code. The surface
 * words it in the reader's language; the server action reads only `allowed`
 * and `action`.
 */
export type MigrationResolutionReason =
  | "ambiguous"
  | "selectAccount"
  | "confirmEvidence"
  | "readyToLink"
  | "newAccountReview";

export interface MigrationResolution {
  allowed: boolean;
  action: "link" | "create" | "blocked";
  reason: MigrationResolutionReason;
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
      reason: record.candidates.length > 1 ? "ambiguous" : "selectAccount",
    };
  }

  if (!evidenceConfirmed) {
    return {
      allowed: false,
      action: "blocked",
      reason: "confirmEvidence",
    };
  }

  if (selectedCandidate) {
    return {
      allowed: true,
      action: "link",
      reason: "readyToLink",
    };
  }

  return {
    allowed: true,
    action: "create",
    reason: "newAccountReview",
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
  if (!normalizedReason) throw new Error("REVIEW_REASON_REQUIRED");
  return { ...summary, reason: normalizedReason };
}
