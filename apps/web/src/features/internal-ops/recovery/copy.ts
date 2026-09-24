import type { DeadLetterSource } from "@clockwork/db";

import type { MessageId, Translator } from "@/src/i18n";

type Decision = "retry" | "abandon";

/**
 * The shortest reason a recovery decision accepts. The server action refuses
 * below it and the help text states it, from this one constant.
 */
export const recoveryReasonMinimum = 8;

/** The engine that stopped the work, as the table's first column names it. */
export const sourceLabels: Readonly<Record<DeadLetterSource, MessageId>> = {
  outbox_message: "operations.recovery.engine.dispatch",
  provisioning_attempt: "operations.recovery.engine.provisioning",
  workflow_run: "operations.recovery.engine.workflow",
};

/**
 * What the operator is about to cause, in the words they would use. Both
 * decisions are consequential, so both state their effect on the record and on
 * everything waiting behind it.
 */
export const decisionConsequences: Readonly<
  Record<Decision, Readonly<Record<DeadLetterSource, MessageId>>>
> = {
  retry: {
    outbox_message: "operations.recovery.effect.retry.dispatch",
    provisioning_attempt: "operations.recovery.effect.retry.provisioning",
    workflow_run: "operations.recovery.effect.retry.workflow",
  },
  abandon: {
    outbox_message: "operations.recovery.effect.abandon.dispatch",
    provisioning_attempt: "operations.recovery.effect.abandon.provisioning",
    workflow_run: "operations.recovery.effect.abandon.workflow",
  },
};

/**
 * How firmly the decision holds. Two of the three engines have a column that
 * closes the work; provisioning does not, so its answer says what the audit
 * decision covers rather than claiming a terminal state the schema lacks.
 */
export const decisionReversibility: Readonly<
  Record<Decision, Readonly<Record<DeadLetterSource, MessageId>>>
> = {
  retry: {
    outbox_message: "operations.recovery.reversible.retry.dispatch",
    provisioning_attempt: "operations.recovery.reversible.retry.provisioning",
    workflow_run: "operations.recovery.reversible.retry.workflow",
  },
  abandon: {
    outbox_message: "operations.recovery.reversible.abandon.dispatch",
    provisioning_attempt: "operations.recovery.reversible.abandon.provisioning",
    workflow_run: "operations.recovery.reversible.abandon.workflow",
  },
};

export const decisionLabels: Readonly<
  Record<Decision, { trigger: MessageId; confirm: MessageId; title: MessageId }>
> = {
  retry: {
    trigger: "operations.recovery.decision.retry",
    confirm: "operations.recovery.decision.retry.confirm",
    title: "operations.recovery.decision.retry.title",
  },
  abandon: {
    trigger: "operations.recovery.decision.abandon",
    confirm: "operations.recovery.decision.abandon.confirm",
    title: "operations.recovery.decision.abandon.title",
  },
};

/** The server action's refusal codes, in the words an operator acts on. */
const failures: Readonly<Record<string, MessageId>> = {
  SYSTEM_RECOVERY_REASON_REQUIRED: "operations.decision.reasonRequired",
  SYSTEM_RECOVERY_RECENT_AUTH_REQUIRED: "operations.decision.recentAuth",
  SYSTEM_RECOVERY_PERMISSION_REVOKED: "operations.decision.permissionChanged",
  SYSTEM_RECOVERY_AUTHORIZATION_REVOKED:
    "operations.decision.permissionChanged",
  SYSTEM_RECOVERY_AUTHORIZATION_EXPIRED:
    "operations.recovery.failure.authorizationExpired",
  SYSTEM_RECOVERY_IDEMPOTENCY_CONFLICT:
    "operations.recovery.failure.idempotencyConflict",
  SYSTEM_RECOVERY_INVALID: "operations.decision.unreadable",
  DEAD_LETTER_OPERATION_ALREADY_DECIDED:
    "operations.recovery.failure.alreadyAbandoned",
  DEAD_LETTER_OPERATION_NOT_FOUND: "operations.recovery.failure.notStopped",
  // Only reachable from a page rendered before this row stopped being listed.
  // The dispatch record cannot be decided; the message it delivers can.
  DEAD_LETTER_OPERATION_NOT_ADDRESSABLE:
    "operations.recovery.failure.notAddressable",
  SYSTEM_RECOVERY_UNAVAILABLE: "operations.recovery.failure.unavailable",
  SYSTEM_RECOVERY_REDRIVE_NOT_SUBMITTED:
    "operations.recovery.failure.redriveNotSubmitted",
  SYSTEM_RECOVERY_REDRIVE_UNMAPPED:
    "operations.recovery.failure.redriveUnmapped",
};

/** A refusal or partial outcome in the reader's language; unknown codes get the generic one. */
export function recoveryFailureMessage(
  code: string | undefined,
  t: Translator,
): string {
  const id = code && Object.hasOwn(failures, code) ? failures[code] : undefined;
  return id
    ? t(id, { min: recoveryReasonMinimum })
    : t("operations.decision.failed");
}

/** Where a recovery read came from; the page frame receives it worded. */
export type RecoverySource = "live" | "demo" | "unavailable";

export const recoverySourceLabels: Readonly<Record<RecoverySource, MessageId>> =
  {
    live: "operations.recovery.source.live",
    demo: "operations.recovery.source.demo",
    unavailable: "operations.recovery.source.unavailable",
  };
