import type { DeadLetterSource } from "@clockwork/db";

type Decision = "retry" | "abandon";

export const sourceLabels: Readonly<Record<DeadLetterSource, string>> = {
  outbox_message: "Dispatch queue",
  provisioning_attempt: "Provisioning",
  workflow_run: "Workflow task",
};

/**
 * What the operator is about to cause, in the words they would use. Both
 * decisions are consequential, so both state their effect on the record and on
 * everything waiting behind it.
 */
export const decisionConsequences: Readonly<
  Record<Decision, Readonly<Record<DeadLetterSource, string>>>
> = {
  retry: {
    outbox_message:
      "The event is queued for delivery again. Everything waiting on it runs once delivery succeeds.",
    provisioning_attempt:
      "A new provider attempt is issued for this order. The provider may create resources.",
    workflow_run: "The task runs again from the input already recorded on it.",
  },
  abandon: {
    outbox_message:
      "The event is closed and never delivered. Everything waiting on it stays undone.",
    provisioning_attempt:
      "No further provider attempt is made. The order stays unprovisioned until someone raises a new command.",
    workflow_run: "The run is cancelled and is never invoked again.",
  },
};

/**
 * How firmly the decision holds. Two of the three engines have a column that
 * closes the work; provisioning does not, so its answer says what the audit
 * decision covers rather than claiming a terminal state the schema lacks.
 */
export const decisionReversibility: Readonly<
  Record<Decision, Readonly<Record<DeadLetterSource, string>>>
> = {
  retry: {
    outbox_message:
      "Yes. The message can be abandoned later if it stops again.",
    provisioning_attempt:
      "Yes. The attempt can be abandoned later if it stops again.",
    workflow_run: "Yes. The run can be abandoned later if it stops again.",
  },
  abandon: {
    outbox_message:
      "No. The dispatcher never claims a closed message, so nothing delivers it.",
    provisioning_attempt:
      "No provider attempt is issued again, and the attempt leaves this queue. The attempt row stays at dead_letter, because the state constraint has no abandoned value, so the decision is held on the audit trail.",
    workflow_run:
      "No. A cancelled run is not re-entered by a lease or a redrive.",
  },
};

export const recoveryCopy = {
  page: {
    title: "Stopped work",
    description:
      "Dispatch, provisioning, and workflow tasks that ran out of attempts. Each one needs a retry or an abandonment before it moves.",
  },
  summary: {
    label: "Stopped work by engine",
    dispatch: {
      title: "Dispatch queue",
      detail: "Events that exhausted delivery attempts",
    },
    provisioning: {
      title: "Provisioning",
      detail: "Provider attempts that stopped permanently",
    },
    workflow: {
      title: "Workflow tasks",
      detail: "Runs the task runner gave up on",
    },
  },
  unreadable: {
    title: "The queue could not be read.",
    detail:
      "This page is showing nothing because no read completed, which is a different state from an empty queue. Check the service database connection before concluding there is no stopped work.",
  },
  retrying: {
    title: (count: number) =>
      `${count} ${count === 1 ? "record is" : "records are"} retrying.`,
    detail:
      "A retried record stays here until it succeeds. Check the reason before deciding it again.",
  },
  table: {
    heading: "Stopped work",
    subheading: "Engine, failure, attempts, and how long it has been waiting.",
    caption: "Stopped work with its failure and the decisions available",
    empty:
      "Nothing has stopped. Every dispatch, provisioning attempt, and workflow task either succeeded or is still retrying on its own.",
    count: (count: number) => `${count} ${count === 1 ? "record" : "records"}`,
    columns: {
      engine: "Engine",
      work: "Work",
      record: "Record",
      failure: "Failure",
      attempts: "Attempts",
      waiting: "Waiting",
      decision: "Decision",
    },
    retryingCell: (reason: string | null) =>
      reason ? `Retrying. ${reason}` : "Retrying.",
    waitingUnderHour: "Under an hour",
    waitingHours: (hours: number) => `${hours} hours`,
    waitingDays: (days: number) => (days === 1 ? "1 day" : `${days} days`),
  },
  decision: {
    labels: {
      retry: { trigger: "Retry", confirm: "Retry this work" },
      abandon: { trigger: "Abandon", confirm: "Abandon this work" },
    } as Readonly<Record<Decision, { trigger: string; confirm: string }>>,
    recordTerm: "Record",
    effectTerm: "Effect",
    reversibleTerm: "Reversible",
    reasonLabel: "Reason",
    reasonHelp:
      "At least 8 characters. Kept with your name on the audit record.",
    submitting: "Recording",
    recorded: "Recorded.",
  },
  failures: {
    SYSTEM_RECOVERY_REASON_REQUIRED: "Give a reason of at least 8 characters.",
    SYSTEM_RECOVERY_RECENT_AUTH_REQUIRED:
      "Sign in again to confirm it is you, then repeat the decision.",
    SYSTEM_RECOVERY_PERMISSION_REVOKED:
      "Your permission to operate system recovery has changed.",
    SYSTEM_RECOVERY_AUTHORIZATION_REVOKED:
      "Your permission to operate system recovery has changed.",
    SYSTEM_RECOVERY_AUTHORIZATION_EXPIRED:
      "This page has been open too long. Reload and repeat the decision.",
    SYSTEM_RECOVERY_IDEMPOTENCY_CONFLICT:
      "A different decision was already recorded under this key.",
    SYSTEM_RECOVERY_INVALID: "The decision could not be read. Reload the page.",
    DEAD_LETTER_OPERATION_ALREADY_DECIDED:
      "Another operator already abandoned this work.",
    DEAD_LETTER_OPERATION_NOT_FOUND: "This work is no longer stopped.",
    // Only reachable from a page rendered before this row stopped being listed.
    // The dispatch record cannot be decided; the message it delivers can.
    DEAD_LETTER_OPERATION_NOT_ADDRESSABLE:
      "This is the dispatch record for a queued message, not work you can decide. Reload the page and decide the message itself.",
    SYSTEM_RECOVERY_UNAVAILABLE: "The recovery queue cannot be reached.",
    SYSTEM_RECOVERY_REDRIVE_NOT_SUBMITTED:
      "The decision is recorded. The task runner did not accept the redrive, so submit it again.",
    SYSTEM_RECOVERY_REDRIVE_UNMAPPED:
      "The decision is recorded. No dispatch was found to re-invoke, so raise the work again from its own command.",
  } as Readonly<Record<string, string>>,
  fallbackFailure: "The decision could not be recorded.",
  sourceLabel: {
    live: "Dispatch queue, provisioning, and workflow tasks",
    demo: "Demonstration recovery ledger",
    unavailable: "No queue read is available",
  },
} as const;
