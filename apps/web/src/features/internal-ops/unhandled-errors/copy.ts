import type { MessageId, Translator } from "@/src/i18n";

import {
  containmentReferenceLimit,
  decisionReasonLimits,
  safeCodePattern,
  type CauseDiscardSite,
  type IncidentDecision,
  type IncidentQueueSource,
  type ProviderMessageProvenance,
} from "./model";

/**
 * Every number an operator is told is read from the constant the refusal is
 * made with. A cap written out in prose is a cap that drifts away from the
 * check, and a refusal message that names the wrong bound is worse than one
 * that names none: the operator acts on it. Each message below takes those
 * constants as placeholders, never as digits typed into a translation.
 */
const limits = {
  min: decisionReasonLimits.min,
  max: decisionReasonLimits.max,
  limit: containmentReferenceLimit,
};

export const incidentDecisionLabels: Readonly<
  Record<
    IncidentDecision,
    {
      trigger: MessageId;
      confirm: MessageId;
      title: MessageId;
      consequence: MessageId;
      recorded: MessageId;
      recordedWithReason: MessageId;
    }
  >
> = {
  contain: {
    trigger: "operations.incidents.decision.contain",
    confirm: "operations.incidents.decision.contain.confirm",
    title: "operations.incidents.decision.contain.title",
    consequence: "operations.incidents.decision.contain.effect",
    recorded: "operations.incidents.decided.contained",
    recordedWithReason: "operations.incidents.decided.containedWithReason",
  },
  release: {
    trigger: "operations.incidents.decision.release",
    confirm: "operations.incidents.decision.release.confirm",
    title: "operations.incidents.decision.release.title",
    consequence: "operations.incidents.decision.release.effect",
    recorded: "operations.incidents.decided.released",
    recordedWithReason: "operations.incidents.decided.releasedWithReason",
  },
};

export const provenanceLabels: Readonly<
  Record<ProviderMessageProvenance, MessageId>
> = {
  commandAttempt: "operations.incidents.cause.commandAttempt",
  operationAttempt: "operations.incidents.cause.operationAttempt",
};

export const incidentSourceLabels: Readonly<
  Record<IncidentQueueSource, MessageId>
> = {
  live: "operations.incidents.source.live",
  demo: "operations.incidents.source.demo",
  unavailable: "operations.incidents.source.unavailable",
  unwired: "operations.incidents.source.unwired",
};

/** Where the writer discarded the cause, as a sentence around its identifiers. */
export function causeDiscardText(
  site: CauseDiscardSite,
  t: Translator,
): string {
  switch (site.kind) {
    case "coerced":
      return t("operations.incidents.discard.coerced", {
        column: site.column,
        pattern: safeCodePattern,
        module: site.module,
      });
    case "coerced_attempt_survives":
      return t("operations.incidents.discard.coercedAttemptSurvives", {
        column: site.column,
        pattern: safeCodePattern,
        module: site.module,
      });
    case "attempt_document":
      return t("operations.incidents.discard.attemptDocument", {
        field: site.field,
      });
    case "code_column":
      return t("operations.incidents.discard.codeColumn", {
        column: site.column,
      });
    case "unknown":
      return t("operations.incidents.discard.unknown");
  }
}

const failures: Readonly<Record<string, MessageId>> = {
  UNHANDLED_ERROR_REASON_REQUIRED: "operations.decision.reasonRequired",
  UNHANDLED_ERROR_REASON_TOO_LONG: "operations.incidents.failure.reasonTooLong",
  UNHANDLED_ERROR_INVALID: "operations.decision.unreadable",
  UNHANDLED_ERROR_EVIDENCE_INVALID:
    "operations.incidents.failure.referenceInvalid",
  UNHANDLED_ERROR_RECENT_AUTH_REQUIRED: "operations.decision.recentAuth",
  UNHANDLED_ERROR_FORBIDDEN: "operations.decision.permissionChanged",
  UNHANDLED_ERROR_UNAVAILABLE: "operations.incidents.failure.unavailable",
  UNHANDLED_ERROR_NOT_FOUND: "operations.incidents.failure.notFound",
  UNHANDLED_ERROR_FAILED: "operations.decision.failed",
};

/** A refusal in the reader's language, with the bound it was refused under. */
export function incidentFailureMessage(
  code: string | undefined,
  t: Translator,
): string {
  const id = code && Object.hasOwn(failures, code) ? failures[code] : undefined;
  return t(id ?? "operations.decision.failed", limits);
}

export function incidentReasonHelp(t: Translator): string {
  return t("operations.incidents.decision.reasonHelp", limits);
}

export function containmentReferenceHelp(t: Translator): string {
  return t("operations.incidents.decision.referenceHelp", limits);
}
