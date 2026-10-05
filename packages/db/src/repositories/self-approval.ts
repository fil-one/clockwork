import { sql } from "drizzle-orm";

import {
  selfApprovalReason,
  type CheckedSelfApproval,
  type SelfApproval,
} from "@clockwork/domain";

import type { RuntimeTransaction } from "../client";

/**
 * The stored half of the self-approval authority: the person is internal
 * staff, enrolled in MFA, and their stored memberships confer
 * `approval:self` (`public.member_can_self_approve`, 001449). The session
 * half is checked where the request arrives. The database checks this again
 * when the decision is written, and writes the audit event and the notices.
 *
 * Returns the self-approval with its reason trimmed, ready to record. This
 * is the only place a `CheckedSelfApproval` is made.
 */
export async function checkedSelfApproval(
  transaction: RuntimeTransaction,
  userId: string,
  selfApproval: SelfApproval,
): Promise<CheckedSelfApproval> {
  const reason = selfApprovalReason(selfApproval.reason);
  const [row] = await transaction.execute<{ allowed: boolean }>(
    sql`select public.member_can_self_approve(${userId}::uuid) as allowed`,
  );
  if (row?.allowed !== true) throw new Error("SELF_APPROVAL_NOT_PERMITTED");
  return { reason } as CheckedSelfApproval;
}
