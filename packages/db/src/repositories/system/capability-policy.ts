import type { Permission, Role } from "@clockwork/contracts";
import {
  assertDistinctOrSelfApproved,
  type CheckedSelfApproval,
} from "@clockwork/domain";

import type { SystemCapabilityKey } from "./capabilities";

/** The role whose name the console shows as the approver of a switch. */
export function capabilityApprovalRole(key: SystemCapabilityKey): Role {
  return key === "legal"
    ? "legal_approver"
    : key === "teardown"
      ? "destructive_action_approver"
      : "finance_approver";
}

/** The permission that decides a request to turn a switch on. */
export function capabilityApprovalPermission(
  key: SystemCapabilityKey,
): Permission {
  return key === "legal"
    ? "agreement:approve"
    : key === "teardown"
      ? "destructive:approve"
      : "quote:approve";
}

/**
 * Whether an approval may turn the switch on. Returns true when it is the
 * requester's own approval under `approval:self`, which the caller records.
 */
export function assertCapabilityDecision(input: {
  requestedBy: string;
  actorId: string;
  requestedAt: Date;
  now: Date;
  baseVersion: number;
  currentVersion: number;
  selfApproval?: CheckedSelfApproval;
}): boolean {
  const selfApproved = assertDistinctOrSelfApproved({
    deciderId: input.actorId,
    requesterIds: [input.requestedBy],
    selfApproval: input.selfApproval,
    distinctError: "CAPABILITY_DISTINCT_APPROVER_REQUIRED",
  });
  const age = input.now.getTime() - input.requestedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000)
    throw new Error("CAPABILITY_REQUEST_EXPIRED");
  if (input.baseVersion !== input.currentVersion)
    throw new Error("CAPABILITY_VERSION_CONFLICT");
  return selfApproved;
}
