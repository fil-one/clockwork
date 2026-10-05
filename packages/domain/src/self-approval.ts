import { z } from "zod";

import { contextHasPermission } from "@clockwork/contracts";

import type { AuthorizationContext } from "./authorization";

/**
 * Self-approval: a person holding `approval:self` (the commerce
 * administrator) deciding their own request on a two-person control. Everyone
 * else still needs a second person.
 *
 * A self-approval always carries a reason, is recorded on the decision, is
 * audited as `approval.self_approved` and notifies the other commerce
 * administrators (supabase/migrations/001449_self_approval.sql). The session
 * that asks for it must be the person's own, MFA-verified session: an
 * assisted session never carries `approval:self`.
 */

export const selfApprovalReasonLength = { min: 8, max: 500 } as const;

export const SelfApprovalReasonSchema = z
  .string()
  .trim()
  .min(selfApprovalReasonLength.min)
  .max(selfApprovalReasonLength.max);

/** A request to approve one's own request, with its reason. */
export interface SelfApproval {
  /** Trimmed, 8 to 500 characters. */
  readonly reason: string;
}

declare const checkedSelfApprovalBrand: unique symbol;

/**
 * A self-approval whose authority has been confirmed against the session and
 * the stored memberships. Only `checkedSelfApproval` in `@clockwork/db`
 * makes one, so a decision function cannot be handed a bare client flag.
 */
export type CheckedSelfApproval = SelfApproval & {
  readonly [checkedSelfApprovalBrand]: true;
};

/** The reason, trimmed, or `SELF_APPROVAL_REASON_REQUIRED`. */
export function selfApprovalReason(reason: unknown): string {
  const parsed = SelfApprovalReasonSchema.safeParse(reason);
  if (!parsed.success) throw new Error("SELF_APPROVAL_REASON_REQUIRED");
  return parsed.data;
}

/**
 * The session half of the authority: the person's own session (never an
 * assisted one), MFA verified, internal staff, holding `approval:self`. The
 * stored half (memberships, MFA enrolment) is checked against the database
 * by the repository that records the decision.
 */
export function assertSelfApprovalSession(
  context: Pick<
    AuthorizationContext,
    | "roles"
    | "permissions"
    | "side"
    | "isInternalStaff"
    | "mfaVerified"
    | "impersonation"
  >,
): void {
  if (context.impersonation)
    throw new Error("SELF_APPROVAL_DIRECT_SESSION_REQUIRED");
  if (
    !context.isInternalStaff ||
    !contextHasPermission(context, "approval:self")
  )
    throw new Error("SELF_APPROVAL_NOT_PERMITTED");
  if (!context.mfaVerified) throw new Error("SELF_APPROVAL_MFA_REQUIRED");
}

/**
 * Whether a decision by `deciderId` on a request raised by `requesterIds`
 * (the requester, and for versioned policy also its author and editor) may
 * stand. A distinct decider needs nothing more; the requester needs a
 * checked self-approval. A self-approval offered by someone deciding another
 * person's request is refused, so the marker always means "their own".
 */
export function assertDistinctOrSelfApproved(input: {
  deciderId: string;
  requesterIds: readonly (string | null | undefined)[];
  selfApproval: SelfApproval | undefined;
  /** The error a non-holder deciding their own request has always seen. */
  distinctError: string;
}): boolean {
  const own = input.requesterIds.some(
    (requester) => requester === input.deciderId,
  );
  if (!input.selfApproval) {
    if (own) throw new Error(input.distinctError);
    return false;
  }
  if (!own) throw new Error("SELF_APPROVAL_NOT_OWN_REQUEST");
  selfApprovalReason(input.selfApproval.reason);
  return true;
}
