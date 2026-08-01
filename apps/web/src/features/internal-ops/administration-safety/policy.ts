import type { Role } from "@clockwork/contracts";

export type SafetyDecision = "finance" | "legal" | "destructive" | "assisted";

const decisionRoles: Readonly<Record<SafetyDecision, readonly Role[]>> = {
  finance: ["finance_approver"],
  legal: ["legal_approver"],
  destructive: ["destructive_action_approver"],
  assisted: ["internal_operator"],
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
  roles: readonly string[],
  decision: SafetyDecision,
): boolean {
  return decisionRoles[decision].some((role) => roles.includes(role));
}

export function buildReviewSummary(input: ReviewSummaryInput): ReviewSummary {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    throw new Error(
      "A specific decision reason of at least 8 characters is required.",
    );
  }
  if (input.evidence.length === 0) {
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
  roles: readonly string[];
  reviewed: boolean;
  reason: string;
  effectiveAccountId: string;
}): boolean {
  return (
    canDecide(input.roles, "assisted") &&
    input.reviewed &&
    input.reason.trim().length >= 8 &&
    input.effectiveAccountId.trim().length > 0
  );
}
