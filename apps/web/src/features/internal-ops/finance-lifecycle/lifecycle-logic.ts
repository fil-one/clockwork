import type {
  CollectionRecord,
  MigrationRecord,
  ProvisioningRecord,
  RenewalRecord,
  RenewalWindow,
} from "./lifecycle-data";

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function groupRenewals(
  records: readonly RenewalRecord[],
): Record<RenewalWindow, RenewalRecord[]> {
  const grouped: Record<RenewalWindow, RenewalRecord[]> = {
    "30": [],
    "60-90": [],
    "180": [],
  };
  for (const record of records) grouped[record.window].push(record);
  for (const window of Object.keys(grouped) as RenewalWindow[]) {
    grouped[window].sort((left, right) =>
      left.deadline.localeCompare(right.deadline),
    );
  }
  return grouped;
}

const disputePriority = {
  "Under review": 2,
  "Evidence due": 1,
  "No dispute": 0,
} as const;

export function prioritizeCollections(
  records: readonly CollectionRecord[],
): CollectionRecord[] {
  return [...records].sort(
    (left, right) =>
      right.overdueCents - left.overdueCents ||
      right.ageDays - left.ageDays ||
      disputePriority[right.dispute] - disputePriority[left.dispute] ||
      left.owner.localeCompare(right.owner),
  );
}

export interface RetryAssessment {
  allowed: boolean;
  label: string;
  reason: string;
}

export function assessRetry(record: ProvisioningRecord): RetryAssessment {
  if (record.failureClass === "Permanent") {
    return {
      allowed: false,
      label: "Escalation required",
      reason: "Permanent failures must not be retried.",
    };
  }
  if (record.failureClass === "Waiting") {
    return {
      allowed: false,
      label: "Activation test pending",
      reason: "Wait for the provider activation test before another request.",
    };
  }
  if (
    record.idempotencyState !== "Verified" ||
    record.idempotencyKey === null
  ) {
    return {
      allowed: false,
      label: "Retry blocked",
      reason: "Idempotency evidence is required before retry.",
    };
  }
  if (record.attempts >= record.maxAttempts) {
    return {
      allowed: false,
      label: "Attempts exhausted",
      reason: "The safe retry limit has been reached.",
    };
  }
  return {
    allowed: true,
    label: "Safe retry available",
    reason: `Transient failure with verified idempotency; ${record.maxAttempts - record.attempts} attempts remain.`,
  };
}

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
