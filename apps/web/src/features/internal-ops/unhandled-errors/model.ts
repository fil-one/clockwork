// i18n-exempt-file: the runtime-failure catalogue and its types. The only prose here is the reason each excluded event type is out of scope, which model.test.ts and developers read and no page renders; the page's words are in copy.ts.
/**
 * What an operator can actually learn about an unhandled runtime failure, and
 * what the tree does not keep.
 *
 * `docs/operations/unhandled-errors.md` step 1 asks the operator to record the
 * boundary, the safe error type and code, the request/workflow/task/audit/outbox
 * identifiers and the first and last occurrence. Each of those is a column or a
 * key on a durable row for at least some of the catalogued writers, so this
 * surface reads them rather than restating the runbook -- and where a writer
 * records none, the cell says so instead of substituting a different fact under
 * the same heading. Step 3 -- diagnosis -- is the part the tree cannot supply
 * for most failures, and that is stated on the page instead of implied away.
 */

/**
 * The audit event types that record a runtime failure durably.
 *
 * The list is curated rather than inferred, because "carries a code" is not a
 * failure predicate here: `core.refund.provider_accepted` and
 * `exception_case.opened` both carry one on a live database.
 *
 * Two tests in `model.test.ts` hold the list to the tree, and they fail in
 * opposite directions. The binding below fails when an entry here is not spelled
 * by source fragments in the module it names. The completeness check fails when
 * a failure-shaped event type appears as a string literal anywhere under
 * `packages/db/src/repositories` or `packages/workflows/src` and is neither
 * listed here nor excluded by name, with a written reason, in
 * `excludedFailureShapedEventTypes`.
 *
 * A curated list without the second half is how
 * `lifecycle.provider_effect.dead_lettered` was missed. It is appended by
 * `checkpointProviderEffect` on every permanent provisioning-provider failure,
 * and the `store.record()` call paired with it appends no audit event at all, so
 * it is the durable record of that failure. While it was uncatalogued this
 * surface showed nothing during exactly the outage the runbook exists for.
 */
export const runtimeFailureEventTypes = [
  "workflow.task.retry_scheduled",
  "workflow.task.dead_lettered",
  "lifecycle.effect.retry_scheduled",
  "lifecycle.effect.dead_lettered",
  "lifecycle.provider_effect.retry_scheduled",
  "lifecycle.provider_effect.dead_lettered",
  "order.provisioning_dead_lettered",
  "experience.projection_action.failed",
] as const;

export type RuntimeFailureEventType = (typeof runtimeFailureEventTypes)[number];

export interface RuntimeFailureWriter {
  /** Workspace-relative module whose append call writes this event type. */
  module: string;
  /**
   * Source fragments that spell the event type once the template placeholder in
   * the first fragment is replaced by the second.
   *
   * The fragments are not an existence check on arbitrary strings. They are
   * required to *reconstruct* the event type -- see `eventTypeFromFragments` --
   * so a catalogue entry cannot be satisfied by naming a module that happens to
   * contain a common token such as `"failed"`.
   */
  fragments: readonly string[];
}

/**
 * Rebuilds the event type a writer's fragments describe, or `null` when they
 * describe nothing.
 *
 * One of the catalogued writers composes its event type rather than writing it
 * out: `portal-runtime.ts` appends
 * `` `experience.projection_action.${status}` `` where `status` comes from a
 * three-member enum. A binding that looked only for the whole literal would
 * report that writer as missing, which is how an earlier tripwire in this
 * repository missed a task id written as a reference. A binding that looked for
 * either fragment independently would accept `"failed"` as proof of any event
 * type at all. Substituting one into the other is the only form that fails in
 * both of those directions.
 */
export function eventTypeFromFragments(
  fragments: readonly string[],
): string | null {
  const unquote = (fragment: string): string | null => {
    const first = fragment.at(0);
    const last = fragment.at(-1);
    if (fragment.length < 2) return null;
    if ((first === '"' || first === "`") && first === last)
      return fragment.slice(1, -1);
    return null;
  };
  const [head, substitution, ...rest] = fragments;
  if (head === undefined || rest.length > 0) return null;
  const body = unquote(head);
  if (body === null) return null;
  const placeholder = /\$\{[^}]*\}/;
  if (!placeholder.test(body)) return substitution === undefined ? body : null;
  if (substitution === undefined) return null;
  const value = unquote(substitution);
  if (value === null) return null;
  const substituted = body.replace(placeholder, value);
  return placeholder.test(substituted) ? null : substituted;
}

/**
 * The module whose `appendAuditAndOutbox` call writes each type, and the source
 * fragments that reconstruct it.
 */
export const runtimeFailureWriters: Readonly<
  Record<RuntimeFailureEventType, RuntimeFailureWriter>
> = {
  "workflow.task.retry_scheduled": {
    module: "packages/db/src/repositories/workflows/core.ts",
    fragments: ['"workflow.task.retry_scheduled"'],
  },
  "workflow.task.dead_lettered": {
    module: "packages/db/src/repositories/workflows/core.ts",
    fragments: ['"workflow.task.dead_lettered"'],
  },
  "lifecycle.effect.retry_scheduled": {
    module: "packages/db/src/repositories/workflows/lifecycle.ts",
    fragments: ['"lifecycle.effect.retry_scheduled"'],
  },
  "lifecycle.effect.dead_lettered": {
    module: "packages/db/src/repositories/workflows/lifecycle.ts",
    fragments: ['"lifecycle.effect.dead_lettered"'],
  },
  "lifecycle.provider_effect.retry_scheduled": {
    module: "packages/db/src/repositories/workflows/lifecycle.ts",
    fragments: ['"lifecycle.provider_effect.retry_scheduled"'],
  },
  "lifecycle.provider_effect.dead_lettered": {
    module: "packages/db/src/repositories/workflows/lifecycle.ts",
    fragments: ['"lifecycle.provider_effect.dead_lettered"'],
  },
  "order.provisioning_dead_lettered": {
    module: "packages/db/src/repositories/lifecycle/command-repository.ts",
    fragments: ['"order.provisioning_dead_lettered"'],
  },
  "experience.projection_action.failed": {
    module: "packages/db/src/repositories/experience/portal-runtime.ts",
    fragments: ["`experience.projection_action.${status}`", '"failed"'],
  },
};

/** Trees the completeness check reads when looking for uncatalogued failures. */
export const failureWriterRoots = [
  "packages/db/src/repositories",
  "packages/workflows/src",
] as const;

/**
 * Terminal segments that make a dotted event-type literal failure-shaped.
 *
 * This is the net the completeness check casts. It is deliberately wider than
 * the catalogue -- it catches business rejections and operator decisions too --
 * because the point is to force every catch into one of two lists rather than
 * to be right first time.
 */
export const failureShapedSuffixes = [
  "failed",
  "payment_failed",
  "dead_lettered",
  "provisioning_dead_lettered",
  "retry_scheduled",
  "retry_requested",
  "retry_released",
  "rejected",
  "abandoned",
] as const;

export function isFailureShapedEventType(eventType: string): boolean {
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(eventType)) return false;
  const last = eventType.slice(eventType.lastIndexOf(".") + 1);
  return (failureShapedSuffixes as readonly string[]).includes(last);
}

/**
 * Failure-shaped event types that are deliberately not runtime failures, each
 * with the reason it is out of scope.
 *
 * Every key here must still be found by the scan; an entry whose writer is gone
 * fails the completeness test just as a missing catalogue entry does, so this
 * list cannot quietly rot into a permanent silencer.
 */
export const excludedFailureShapedEventTypes: Readonly<Record<string, string>> =
  {
    "exception.rejected":
      "A reviewer's decision on an exception case, not a runtime failure. packages/workflows/src/exceptions/index.ts.",
    "poc.rejected":
      "A commercial decision on a proof of concept. packages/db/src/repositories/lifecycle/command-repository.ts.",
    "termination.rejected":
      "A commercial decision on a termination request. packages/db/src/repositories/lifecycle/command-repository.ts.",
    "experience.projection_action.rejected":
      "A portal action refused by authorization or validation. The request was answered; nothing failed unhandled.",
    "experience.projection_action.retry_released":
      "An operator releasing a claimed portal action for another attempt. A recovery step, not a failure.",
    "system.dead_letter.retry_requested":
      "An operator decision on the recovery queue at /internal/recovery, which this surface links to rather than duplicates.",
    "system.dead_letter.abandoned":
      "An operator decision on the recovery queue at /internal/recovery, which this surface links to rather than duplicates.",
    "payment_intent.payment_failed":
      "A Stripe webhook event type matched on ingest, not an audit event this platform appends. packages/db/src/repositories/system/providers.ts.",
    "invoice_payment.failed":
      "A Stripe webhook event type matched on ingest, not an audit event this platform appends. packages/db/src/repositories/system/providers.ts.",
    "invoice.payment_failed":
      "A Stripe webhook event type matched on ingest, not an audit event this platform appends. packages/db/src/repositories/system/providers.ts.",
    "provider.stripe.invoice.payment_failed":
      "An outbox handler subscription to a payment outcome. A dunning path, handled by billing rather than by this runbook.",
  };

export type IncidentDecision = "contain" | "release";

/**
 * The two operator records, appended against the failure's own audit event.
 *
 * That anchor is immutable and no other writer versions an `audit_event`
 * aggregate, which is the whole reason for the choice: `provider_operation`,
 * `workflow_run` and `report_export` audit rows are all numbered from the
 * source row's `row_version`, so an operator record numbered `max + 1` against
 * one of those would take the number the next runtime transition is about to
 * use and make that transition fail on `audit_aggregate_version_unique`. A
 * control that stops legitimate work is worse than no control.
 */
export const unhandledErrorContainEvent = "system.unhandled_error.contained";
export const unhandledErrorReleaseEvent = "system.unhandled_error.released";

/**
 * Bounds on the operator's reason, in one place because three callers state
 * them: the server action refuses outside them, the store refuses outside them,
 * and the help text in `copy.ts` tells the operator what they are. A cap the
 * help text does not mention is a refusal the operator cannot act on.
 */
export const decisionReasonLimits = { min: 8, max: 2000 } as const;

/**
 * What a containment reference may contain.
 *
 * Wide enough for the ordinary mid-incident forms -- a gate key, a deploy
 * revision, a ticket id, a ticket URL with a query string, and a short phrase
 * with spaces -- and narrow enough to stay a single-line reference: printable
 * ASCII only, and none of the characters that would make the value read as
 * markup or as a second statement.
 *
 * The earlier pattern refused `https://tickets.test/browse?id=4421` for its
 * query string and refused `gate EXT-PROVIDER-01` for its space -- the two most
 * likely things an operator types into a field labelled "Gate key, deploy
 * revision or ticket". The help text in `copy.ts` states exactly these two
 * rules, so a refusal here is one the operator can act on.
 */
export const containmentReferenceLimit = 200;
export const containmentReferenceCharacters = /^[\x20-\x7e]+$/;
export const containmentReferenceForbidden = /["'`<>;\\]/;

export function isContainmentReference(value: string): boolean {
  return (
    value.length <= containmentReferenceLimit &&
    containmentReferenceCharacters.test(value) &&
    !containmentReferenceForbidden.test(value)
  );
}

/**
 * Why a row shows a cause or does not.
 *
 * `code_only` is not a formatting choice. `workflow_runs.last_error`,
 * `provider_operations.last_error` and the lifecycle effect writers all pass the
 * failure through `/^[A-Z0-9_]{3,100}$/` and substitute a constant when it does
 * not match, so the provider's own description is discarded at the write. The
 * exception is the provisioning attempt document, whose `lastError` object keeps
 * `message` alongside `code`; that message is joined in and shown, labelled with
 * which of the two joins reached it.
 */
export type IncidentDiagnosis =
  | { kind: "code_only"; discardedAt: CauseDiscardSite }
  | {
      kind: "provider_message";
      message: string;
      provenance: ProviderMessageProvenance;
    };

/**
 * How a shown provider message was reached, because the two joins do not
 * warrant the same confidence.
 *
 * The command join lands on a dead-lettered attempt, whose `lastError` is
 * terminal. The provider-operation join lands on the attempt behind a
 * `lifecycle.provider_effect.*` event, whose `lastError` is whatever the most
 * recent dispatch wrote -- for a retry sequence that can be a later attempt than
 * the event being read. Saying so is cheaper than being wrong about it. The page
 * words each one in the reader's language.
 */
export const providerMessageProvenance = {
  commandAttempt: "commandAttempt",
  operationAttempt: "operationAttempt",
} as const;

export type ProviderMessageProvenance =
  (typeof providerMessageProvenance)[keyof typeof providerMessageProvenance];

export interface RuntimeFailureIncident {
  /** The immutable audit row this incident is anchored on. */
  auditEventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  accountId: string | null;
  requestId: string;
  occurredAt: string;
  /** Boundary the failure crossed, when the writer recorded one. */
  boundary: string | null;
  /** Safe machine code, or null when the writer recorded none at all. */
  safeCode: string | null;
  taskIdentifier: string | null;
  outboxMessageId: string | null;
  diagnosis: IncidentDiagnosis;
  /** Contain and release records already appended against this audit event. */
  decisionCount: number;
  latestDecision: IncidentDecision | null;
  latestDecisionReason: string | null;
  latestDecisionAt: string | null;
}

export type IncidentQueueState = "read" | "read_failed" | "no_connection";

/** Which store answered, or why none did; the page words it for the reader. */
export type IncidentQueueSource = "live" | "demo" | "unavailable" | "unwired";

export interface IncidentQueue {
  incidents: readonly RuntimeFailureIncident[];
  source: IncidentQueueSource;
  /** True only when a read completed. */
  readable: boolean;
  /**
   * Which of the two non-read states this is. "We are not wired to a database"
   * and "the query we ran raised" send an operator to different places, and
   * collapsing them sent every reader to the connection string.
   */
  state: IncidentQueueState;
}

/** The check the code-only writers pass a failure through before storing it. */
export const safeCodePattern = "/^[A-Z0-9_]{3,100}$/";

/**
 * Where the cause was thrown away, per writer, for the `code_only` rows. The
 * column, pattern and module are identifiers and are shown as written; the page
 * supplies the sentence around them in the reader's language.
 */
export type CauseDiscardSite =
  | { kind: "coerced"; column: string; module: string }
  | { kind: "coerced_attempt_survives"; column: string; module: string }
  | { kind: "attempt_document"; field: string }
  | { kind: "code_column"; column: string }
  | { kind: "unknown" };

export function causeDiscardSite(eventType: string): CauseDiscardSite {
  if (eventType.startsWith("workflow.task."))
    return {
      kind: "coerced",
      column: "workflow_runs.last_error",
      module: "packages/db/src/repositories/workflows/core.ts",
    };
  if (eventType.startsWith("lifecycle.provider_effect."))
    return {
      kind: "coerced_attempt_survives",
      column: "provider_operations.last_error",
      module: "packages/db/src/repositories/workflows/lifecycle.ts",
    };
  if (eventType.startsWith("lifecycle.effect."))
    return {
      kind: "coerced",
      column: "provider_operations.last_error",
      module: "packages/db/src/repositories/workflows/lifecycle.ts",
    };
  if (eventType === "order.provisioning_dead_lettered")
    return { kind: "attempt_document", field: "lastError.message" };
  if (eventType === "experience.projection_action.failed")
    return {
      kind: "code_column",
      column: "experience_projection_action_claims.last_error",
    };
  return { kind: "unknown" };
}

/**
 * Groups repeated failures so the operator sees first and last occurrence,
 * which is what step 1 of the runbook asks for and what a flat list of audit
 * rows cannot show.
 *
 * Identity is (event type, safe code, aggregate type). Two failures of the same
 * kind on different records are the same signature; the same code on a
 * different boundary is not.
 */
export interface IncidentSignature {
  key: string;
  eventType: string;
  safeCode: string | null;
  aggregateType: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The most recent incident, which is the one an operator acts on. */
  latest: RuntimeFailureIncident;
}

export function signatureKey(incident: RuntimeFailureIncident): string {
  return `${incident.eventType}|${incident.safeCode ?? ""}|${incident.aggregateType}`;
}

export function groupIncidents(
  incidents: readonly RuntimeFailureIncident[],
): readonly IncidentSignature[] {
  const groups = new Map<string, IncidentSignature>();
  for (const incident of incidents) {
    const key = signatureKey(incident);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        eventType: incident.eventType,
        safeCode: incident.safeCode,
        aggregateType: incident.aggregateType,
        occurrences: 1,
        firstSeenAt: incident.occurredAt,
        lastSeenAt: incident.occurredAt,
        latest: incident,
      });
      continue;
    }
    existing.occurrences += 1;
    if (incident.occurredAt < existing.firstSeenAt)
      existing.firstSeenAt = incident.occurredAt;
    if (incident.occurredAt > existing.lastSeenAt) {
      existing.lastSeenAt = incident.occurredAt;
      existing.latest = incident;
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.lastSeenAt < right.lastSeenAt ? 1 : -1,
  );
}

/** How many of the listed signatures can be diagnosed from stored evidence. */
export function diagnosableCount(
  signatures: readonly IncidentSignature[],
): number {
  return signatures.filter(
    (signature) => signature.latest.diagnosis.kind === "provider_message",
  ).length;
}
