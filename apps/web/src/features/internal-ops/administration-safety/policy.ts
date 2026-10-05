import type { Permission } from "@clockwork/contracts";

export type SafetyDecision =
  "finance" | "legal" | "destructive" | "assisted" | "operations";

/** The permission each decision needs. */
const decisionPermissions: Readonly<Record<SafetyDecision, Permission>> = {
  finance: "quote:approve",
  legal: "agreement:approve",
  destructive: "destructive:approve",
  assisted: "impersonation:assume",
  operations: "operations:write",
};

export interface ReviewSummaryInput {
  entity: string;
  impact: string;
  evidence: readonly string[];
  policyBasis: string;
  downstreamEffect: string;
  reason: string;
}

export interface ReviewSummary extends Omit<ReviewSummaryInput, "reason"> {
  reason: string;
}

export interface EvidenceIdentifier {
  label: string;
  value: string;
}

export function canDecide(
  permissions: readonly Permission[],
  decision: SafetyDecision,
): boolean {
  return permissions.includes(decisionPermissions[decision]);
}

export function buildReviewSummary(input: ReviewSummaryInput): ReviewSummary {
  const reason = input.reason.trim();
  // Callers run this in submit handlers behind `minLength` fields. The errors
  // are for developers and tests; no surface renders their text.
  if (reason.length < 8) {
    throw new Error(
      // i18n-exempt: developer-facing invariant error, never rendered
      "A specific decision reason of at least 8 characters is required.",
    );
  }
  if (input.evidence.length === 0) {
    // i18n-exempt: developer-facing invariant error, never rendered
    throw new Error("At least one evidence item is required.");
  }
  return { ...input, reason };
}

export function disclosedIdentifiers(
  identifiers: readonly EvidenceIdentifier[],
): readonly EvidenceIdentifier[] {
  return identifiers.filter(
    ({ label, value }) => label.trim().length > 0 && value.trim().length > 0,
  );
}

export function assistedCommercialActionReady(input: {
  permissions: readonly Permission[];
  reviewed: boolean;
  reason: string;
  effectiveAccountId: string;
}): boolean {
  return (
    canDecide(input.permissions, "assisted") &&
    input.reviewed &&
    input.reason.trim().length >= 8 &&
    input.effectiveAccountId.trim().length > 0
  );
}

/*
 * The external-gate register's closed-set keys. The operations lane's gate
 * loader writes these values too, so they keep their established spelling;
 * the register renders each one through a message (copy.ts).
 */
export const gateGroups = {
  provider: "Provider", // i18n-exempt: closed-set key, rendered via gateGroupLabels
  legal: "Legal", // i18n-exempt: closed-set key, rendered via gateGroupLabels
  brand: "Brand", // i18n-exempt: closed-set key, rendered via gateGroupLabels
  operations: "Operations", // i18n-exempt: closed-set key, rendered via gateGroupLabels
} as const;

export const gateSeverities = {
  launchBlocker: "Launch blocker", // i18n-exempt: closed-set key, rendered via gateSeverityLabels
  pathBlocker: "Path blocker", // i18n-exempt: closed-set key, rendered via gateSeverityLabels
  high: "High", // i18n-exempt: closed-set key, rendered via gateSeverityLabels
  medium: "Medium", // i18n-exempt: closed-set key, rendered via gateSeverityLabels
} as const;

export const gateStates = {
  active: "Active", // i18n-exempt: closed-set key, rendered via gateStateLabels
  blocked: "Blocked", // i18n-exempt: closed-set key, rendered via gateStateLabels
  review: "Review", // i18n-exempt: closed-set key, rendered via gateStateLabels
  pending: "Pending", // i18n-exempt: closed-set key, rendered via gateStateLabels
} as const;
