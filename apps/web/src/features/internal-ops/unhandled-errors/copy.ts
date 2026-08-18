import { containmentReferenceLimit, decisionReasonLimits } from "./model";

/**
 * Every number an operator is told is read from the constant the refusal is
 * made with. A cap written out in prose is a cap that drifts away from the
 * check, and a refusal message that names the wrong bound is worse than one
 * that names none: the operator acts on it.
 */
export const unhandledErrorsCopy = {
  page: {
    title: "Runtime incidents",
    description:
      "Review repeated system failures, inspect the evidence that was captured, and record containment or release decisions.",
  },
  summary: {
    label: "Failure signatures",
    signatures: {
      title: "Signatures",
      detail: "Distinct failure patterns requiring review",
    },
    occurrences: {
      title: "Occurrences",
      detail: "Recorded events across those patterns",
    },
    diagnosable: {
      title: "With a cause",
      detail: "Patterns with a provider explanation available",
    },
  },
  diagnosis: {
    heading: "What this page can and cannot tell you",
    /**
     * The scope sentence. It names the mechanism -- a curated list -- rather
     * than implying the page sees everything, because it does not: it sees the
     * audit event types named in `model.ts`.
     */
    scope: (types: number) =>
      `This page reads ${types} audit event types, each one bound in model.ts to the module that appends it. It is a curated list, not everything that can go wrong. A completeness test fails when a failure-shaped event type appears as a string literal anywhere under packages/db/src/repositories or packages/workflows/src and is neither on the list nor excluded by name with a written reason.`,
    codeOnly:
      "Most runtime failures are stored as a machine code and nothing else. The workflow-task and lifecycle-effect writers pass the failure through /^[A-Z0-9_]{3,100}$/ and substitute a constant when it does not match, and the portal-action writer stores the failure code alone, so the provider's own description never reaches those columns. For those rows, step 3 of the runbook -- reproduce with a sanitized deterministic scenario -- is the first step that can produce a cause, and this page does not pretend otherwise.",
    withCause:
      "Provisioning is the exception. The attempt document keeps lastError.message next to lastError.code, and this page joins it in two ways: by commandId for a dead-lettered command, and through provider_operations.aggregate_id for a lifecycle.provider_effect failure. Each shown message says which join reached it, because the second one reads the attempt's most recent error and a retry sequence can have moved it on.",
    containment:
      "Containment is not applied here. The control that disables a provider capability is the emergency state on the external gate register.",
    containmentLink: "Open the gate register",
    containmentHref: "/internal/gates",
    recoveryNote:
      "Work that has already exhausted its attempts is decided on the recovery queue, not here.",
    recoveryLink: "Open the recovery queue",
    recoveryHref: "/internal/recovery",
  },
  unreadable: {
    read_failed: {
      title: "Runtime incidents are temporarily unavailable.",
      detail: "Refresh the page or try again shortly.",
    },
    no_connection: {
      title: "Runtime incidents are not available in this workspace.",
      detail: "No incident data is connected to the current environment.",
    },
  } as Readonly<Record<string, { title: string; detail: string }>>,
  unwiredDetail: "Runtime incident data is not enabled for this workspace.",
  table: {
    heading: "Failure signatures",
    subheading:
      "Grouped by event, code and aggregate, most recent occurrence first.",
    caption: "Runtime failure signatures with their evidence and decisions",
    /**
     * The empty state. The previous sentence here read "Every workflow task,
     * lifecycle effect, provisioning command and portal action either succeeded
     * or has not run", which is a claim about the system. This page cannot make
     * a claim about the system; it can only report what is on the trail for the
     * types it reads, and it says which claim it is making.
     */
    empty: (_types: number) => "No runtime incidents need attention.",
    count: (count: number) =>
      `${count} ${count === 1 ? "signature" : "signatures"}`,
    columns: {
      failure: "Failure",
      boundary: "Boundary and task",
      record: "Record and identifiers",
      cause: "Cause",
      occurrences: "Occurrences",
      window: "First and last",
      decision: "Decision",
    },
    occurrencesCell: (count: number) => `${count}`,
    codeMissing: "No code recorded",
    codeOnlyCell: "Code only",
    /**
     * Three separate absences, because "the writer records no boundary" and
     * "there is no outbox row" are different facts and neither is served by a
     * blank cell or by a different value borrowed from elsewhere.
     */
    boundaryMissing: "No boundary recorded by this writer",
    taskMissing: "no task identifier recorded",
    outboxMissing: "no outbox row",
    requestPrefix: "request",
    auditPrefix: "audit event",
    outboxPrefix: "outbox",
    decidedCell: (decision: string, reason: string | null) =>
      reason ? `${decision}. ${reason}` : `${decision}.`,
  },
  decision: {
    labels: {
      contain: {
        trigger: "Record containment",
        confirm: "Record this containment",
      },
      release: { trigger: "Record release", confirm: "Record this release" },
    } as Readonly<Record<string, { trigger: string; confirm: string }>>,
    consequences: {
      contain:
        "Records that this failure is contained and names the containment you applied elsewhere. It applies no containment itself and changes no runtime state.",
      release:
        "Records that the containment for this failure has been lifted. It restores nothing itself and changes no runtime state.",
    } as Readonly<Record<string, string>>,
    anchorTerm: "Anchored on",
    anchorDetail:
      "The immutable audit event that recorded the failure. Decisions are numbered against it in their own sequence, so no runtime writer's version can collide with one.",
    effectTerm: "Effect",
    evidenceTerm: "Containment reference",
    evidenceHelp: (limit: number) =>
      `Optional. Gate key, deploy revision, ticket id or ticket URL, up to ${limit} characters. One line of printable text; no quotes, angle brackets, backticks, semicolons or backslashes.`,
    reasonLabel: "Reason",
    reasonHelp: (min: number, max: number) =>
      `Between ${min} and ${max} characters. Kept with your name on the audit record.`,
    submitting: "Recording",
    recorded: "Recorded.",
  },
  failures: {
    UNHANDLED_ERROR_REASON_REQUIRED: `Give a reason of at least ${decisionReasonLimits.min} characters.`,
    UNHANDLED_ERROR_REASON_TOO_LONG: `That reason is longer than ${decisionReasonLimits.max} characters. Shorten it, or put the detail in the ticket you reference.`,
    UNHANDLED_ERROR_INVALID: "The decision could not be read. Reload the page.",
    UNHANDLED_ERROR_EVIDENCE_INVALID: `The containment reference must be one line of printable text, at most ${containmentReferenceLimit} characters, with no quotes, angle brackets, backticks, semicolons or backslashes.`,
    UNHANDLED_ERROR_RECENT_AUTH_REQUIRED:
      "Sign in again to confirm it is you, then repeat the decision.",
    UNHANDLED_ERROR_FORBIDDEN:
      "Your permission to operate system recovery has changed.",
    UNHANDLED_ERROR_UNAVAILABLE: "The audit trail cannot be reached.",
    UNHANDLED_ERROR_NOT_FOUND:
      "That failure is no longer on the audit trail. Reload the page.",
    UNHANDLED_ERROR_FAILED: "The decision could not be recorded.",
  } as Readonly<Record<string, string>>,
  fallbackFailure: "The decision could not be recorded.",
  sourceLabel: {
    live: "Audit trail, durable runtime failure events",
    unavailable: "No audit read completed",
    unwired: "No service connection is configured",
  },
} as const;
