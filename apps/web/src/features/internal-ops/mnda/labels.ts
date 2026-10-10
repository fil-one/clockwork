import type {
  MndaErrorCode,
  MndaRecord,
  MndaState,
  MndaStatusGroup,
} from "@clockwork/contracts";
import type { MessageId } from "@/src/i18n";

export const mndaStateLabels: Record<MndaState, MessageId> = {
  draft: "operations.mnda.state.draft",
  preparing: "operations.mnda.state.preparing",
  ready: "operations.mnda.state.ready",
  sending: "operations.mnda.state.sending",
  sent: "operations.mnda.state.sent",
  viewed: "operations.mnda.state.viewed",
  awaiting_countersignature: "operations.mnda.state.awaiting",
  completed: "operations.mnda.state.completed",
  declined: "operations.mnda.state.declined",
  expired: "operations.mnda.state.expired",
  canceled: "operations.mnda.state.canceled",
  attention: "operations.mnda.state.attention",
};
/** A request closed before it was sent was discarded, not voided. */
export function mndaRecordStateLabel(
  record: Pick<MndaRecord, "state" | "cancelCode">,
): MessageId {
  return record.state === "canceled" &&
    (record.cancelCode === "discarded" || record.cancelCode === "superseded")
    ? "operations.mnda.state.discarded"
    : mndaStateLabels[record.state];
}
export const mndaGroupLabels: Record<MndaStatusGroup, MessageId> = {
  drafts: "operations.mnda.group.drafts",
  waiting_partner: "operations.mnda.group.waitingPartner",
  waiting_fil_one: "operations.mnda.group.waitingFilOne",
  attention: "operations.mnda.group.attention",
  completed: "operations.mnda.group.completed",
  closed: "operations.mnda.group.closed",
};
export const mndaErrorLabels: Record<MndaErrorCode, MessageId> = {
  required: "operations.mnda.error.required",
  invalid_characters: "operations.mnda.error.invalidCharacters",
  invalid_email: "operations.mnda.error.invalidEmail",
  too_long: "operations.mnda.error.tooLong",
  invalid_date: "operations.mnda.error.invalidDate",
  invalid_value: "operations.mnda.error.invalidValue",
  same_as_countersigner: "operations.mnda.error.sameAsCountersigner",
  countersigner_unavailable: "operations.mnda.error.countersignerUnavailable",
  reminder_cooldown: "operations.mnda.error.reminderCooldown",
  busy: "operations.mnda.error.busy",
  provider_failed: "operations.mnda.error.providerFailed",
  forbidden: "operations.mnda.error.forbidden",
  mfa_required: "operations.mnda.error.mfaRequired",
  not_configured: "operations.mnda.error.notConfigured",
  not_found: "operations.mnda.error.notFound",
  conflict: "operations.mnda.error.conflict",
  settings_changed: "operations.mnda.error.settingsChanged",
  settings_conflict: "operations.mnda.error.settingsConflict",
  not_owner: "operations.mnda.error.notOwner",
  not_voidable: "operations.mnda.error.notVoidable",
  not_pending: "operations.mnda.error.notPending",
  signer_started: "operations.mnda.error.signerStarted",
  not_correctable: "operations.mnda.error.notCorrectable",
  already_completed: "operations.mnda.error.alreadyCompleted",
  needs_attention: "operations.mnda.error.needsAttention",
  still_preparing: "operations.mnda.error.stillPreparing",
  remind_needs_attention: "operations.mnda.error.remindNeedsAttention",
  signed_in_signwell: "operations.mnda.error.signedInSignWell",
  reason_required: "operations.mnda.error.reasonRequired",
  session_expired: "operations.session.expired",
  demo_unavailable: "operations.mnda.error.demoUnavailable",
  unexpected: "operations.mnda.error.unexpected",
};
