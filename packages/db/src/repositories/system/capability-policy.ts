import type { SystemCapabilityKey } from "./capabilities";

export function capabilityApprovalRole(key: SystemCapabilityKey): string {
  return key === "legal"
    ? "legal_approver"
    : key === "teardown"
      ? "destructive_action_approver"
      : "finance_approver";
}

export function assertCapabilityDecision(input: {
  requestedBy: string;
  actorId: string;
  requestedAt: Date;
  now: Date;
  baseVersion: number;
  currentVersion: number;
}) {
  if (input.requestedBy === input.actorId)
    throw new Error("CAPABILITY_DISTINCT_APPROVER_REQUIRED");
  const age = input.now.getTime() - input.requestedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000)
    throw new Error("CAPABILITY_REQUEST_EXPIRED");
  if (input.baseVersion !== input.currentVersion)
    throw new Error("CAPABILITY_VERSION_CONFLICT");
}
