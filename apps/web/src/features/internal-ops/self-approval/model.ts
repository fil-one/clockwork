import { contextHasPermission, type Permission } from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

/**
 * Self-approval on the two-person controls: a commerce administrator
 * (`approval:self`) approving a request they raised themselves, with a
 * written reason. The reason is kept with the decision, the decision is
 * audited as `approval.self_approved`, and every other commerce administrator
 * gets a notice on the owner console.
 */

export const selfApprovalReasonMinimum = 8;
export const selfApprovalReasonMaximum = 500;

/**
 * What the confirm callback of the dialog reports back. `expired` says the
 * session lapsed, so the dialog offers a reload beside the message.
 */
export type SelfApprovalOutcome =
  { ok: true } | { ok: false; message: string; expired?: boolean };

/**
 * Whether a session may offer "Approve my own request". The server checks
 * again (session and stored memberships) whatever the page shows; an
 * assisted session never carries `approval:self`, so it never sees the
 * action.
 */
export function mayApproveOwnRequests(session: {
  readonly roles: readonly string[];
  readonly permissions?: readonly Permission[];
  readonly impersonation?: unknown;
  readonly assistedSession?: unknown;
  readonly authenticationProviderImpersonator?: unknown;
  readonly mfaVerified?: boolean;
}): boolean {
  return (
    !session.impersonation &&
    !session.assistedSession &&
    !session.authenticationProviderImpersonator &&
    session.mfaVerified === true &&
    contextHasPermission(session, "approval:self")
  );
}

const errorMessages: readonly (readonly [string, MessageId])[] = [
  ["SELF_APPROVAL_REASON_REQUIRED", "common.selfApproval.error.reason"],
  ["SELF_APPROVAL_NOT_PERMITTED", "common.selfApproval.error.notPermitted"],
  ["SELF_APPROVAL_MFA_REQUIRED", "common.selfApproval.error.directSession"],
  [
    "SELF_APPROVAL_DIRECT_SESSION_REQUIRED",
    "common.selfApproval.error.directSession",
  ],
  ["SELF_APPROVAL_SERVICE_ONLY", "common.selfApproval.error.directSession"],
  ["SELF_APPROVAL_NOT_OWN_REQUEST", "common.selfApproval.error.notOwn"],
  ["SELF_APPROVAL_APPROVE_ONLY", "common.selfApproval.error.notOwn"],
];

/**
 * The sentence for a refused self-approval, from whatever the server sent:
 * an error code, a problem code, or a message that names one.
 */
export function selfApprovalErrorMessage(failure: unknown): MessageId {
  const texts: string[] = [];
  if (typeof failure === "string") texts.push(failure);
  if (failure && typeof failure === "object") {
    for (const key of ["problemCode", "code", "message"] as const) {
      const value = (failure as Record<string, unknown>)[key];
      if (typeof value === "string") texts.push(value);
    }
  }
  for (const [code, message] of errorMessages)
    if (texts.some((text) => text.includes(code))) return message;
  return "common.selfApproval.error.generic";
}
