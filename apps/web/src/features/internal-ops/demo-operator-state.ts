import "server-only";

import type {
  DeadLetterOperation,
  DeadLetterSource,
  ReplayableWebhookEvent,
} from "@clockwork/db";
import {
  demoText,
  resolveDemoText,
  type DemoTextField,
} from "@clockwork/testing/demo-localized-text";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
  DemoProjectionOverride,
} from "@clockwork/testing/demo-state";

import type { Locale } from "@/src/i18n";

import { demoUuid } from "@/src/features/experience-server/demo-artifact-catalog";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import {
  blocksClose,
  isVarianceClassification,
  type ReconciliationVariance,
  type ReconciliationWorkspace,
  type TieOutPeriod,
  type VarianceClassification,
} from "./billing-reconciliation/model";
import type {
  IncidentDecision,
  IncidentQueue,
  RuntimeFailureIncident,
} from "./unhandled-errors/model";

/**
 * A demo incident. The provider's message is demo-authored text standing in
 * for what a real provider would return, so it carries every interface
 * language (translation policy rule 4) and is resolved for the reader on read.
 */
type DemoIncident = Omit<RuntimeFailureIncident, "diagnosis"> & {
  diagnosis:
    | Extract<RuntimeFailureIncident["diagnosis"], { kind: "code_only" }>
    | {
        kind: "provider_message";
        message: DemoTextField;
        provenance: "commandAttempt" | "operationAttempt";
      };
};
import { illustrativeMigrations } from "./finance-lifecycle/lifecycle-data";

export const demoOperatorIds = {
  account: demoUuid("operator-demo:account:meridian"),
  order: demoUuid("operator-demo:order:ORD-2026-0098"),
  deadLetterDispatch: demoUuid("operator-demo:dead-letter:dispatch"),
  deadLetterProvisioning: demoUuid("operator-demo:dead-letter:provisioning"),
  deadLetterWorkflow: demoUuid("operator-demo:dead-letter:workflow"),
  webhook: demoUuid("operator-demo:webhook:stripe:evt_demo_invoice_failed"),
  workflowReplay: demoUuid("operator-demo:workflow:webhook-replay"),
  tieOut: demoUuid("operator-demo:tie-out:2026-07"),
  variance: demoUuid("operator-demo:variance:invoice-correction"),
  operator: demoUuid("operator-demo:user:commerce-operator"),
  incident: demoUuid("operator-demo:incident:provider-timeout"),
  incidentOutbox: demoUuid("operator-demo:outbox:provider-timeout"),
} as const;

const deadLetters: readonly DeadLetterOperation[] = [
  {
    id: demoOperatorIds.deadLetterDispatch,
    source: "outbox_message",
    reference: "billing.invoice.collection_requested",
    subjectType: "invoice",
    subjectId: "INV-2026-0781",
    accountId: demoOperatorIds.account,
    failureCode: "DELIVERY_ATTEMPTS_EXHAUSTED",
    attemptCount: 8,
    failedAt: "2026-07-31T13:24:00.000Z",
    redriveKey: null,
    decision: "open",
    decisionReason: null,
    decidedAt: null,
  },
  {
    id: demoOperatorIds.deadLetterProvisioning,
    source: "provisioning_attempt",
    reference: "activate_subscription",
    subjectType: "order",
    subjectId: demoOperatorIds.order,
    accountId: demoOperatorIds.account,
    failureCode: "PROVIDER_TIMEOUT",
    attemptCount: 5,
    failedAt: "2026-07-31T14:08:00.000Z",
    redriveKey: demoUuid("operator-demo:provisioning-command:activate"),
    decision: "open",
    decisionReason: null,
    decidedAt: null,
  },
  {
    id: demoOperatorIds.deadLetterWorkflow,
    source: "workflow_run",
    reference: "core.billing.dunning.evaluate.v1",
    subjectType: "invoice",
    subjectId: "INV-2026-0781",
    accountId: demoOperatorIds.account,
    failureCode: "WORKFLOW_ATTEMPTS_EXHAUSTED",
    attemptCount: 4,
    failedAt: "2026-07-31T14:42:00.000Z",
    redriveKey: "demo:dunning:INV-2026-0781",
    decision: "open",
    decisionReason: null,
    decidedAt: null,
  },
];

const webhookEvents: readonly ReplayableWebhookEvent[] = [
  {
    id: demoOperatorIds.webhook,
    provider: "stripe",
    providerEventId: "evt_demo_invoice_failed",
    eventType: "invoice.payment_failed",
    payloadHash:
      "sha256:43737958cc7b0f45ac189496ad65d4862f8198af92fbc2bf2523071c2967453b",
    occurredAt: "2026-07-31T14:31:00.000Z",
    signatureVerifiedAt: "2026-07-31T14:31:01.000Z",
    attemptCount: 3,
    processedAt: null,
    processingError: "PROCESSING_ATTEMPTS_EXHAUSTED",
    state: "failed",
  },
];

const tieOutPeriods: readonly TieOutPeriod[] = [
  {
    id: demoOperatorIds.tieOut,
    periodStartsOn: "2026-07-01",
    periodEndsOn: "2026-07-31",
    currency: "USD",
    platformRevenueMinor: "154000000",
    billingProviderRevenueMinor: "153880000",
    accountingRevenueMinor: "154000000",
    billingProviderVarianceMinor: "-120000",
    accountingVarianceMinor: "0",
    mathematicallyTied: false,
    status: "review_required",
    varianceCount: 1,
    reviewedAt: null,
  },
];

const reconciliationVariances: readonly ReconciliationVariance[] = [
  {
    caseId: demoOperatorIds.variance,
    accountId: demoOperatorIds.account,
    objectType: "invoice",
    objectId: "INV-2026-0781",
    status: "open",
    openedAt: "2026-07-31T14:35:00.000Z",
    targetAt: "2026-08-01T14:35:00.000Z",
    ownerUserId: demoOperatorIds.operator,
    ownerEmail: "commerce-operations@clockwork.test",
    backupUserId: null,
    rowVersion: 1,
    latestClassification: null,
    latestClassificationReason: null,
    latestClassificationAt: null,
    expectedClearingPeriod: null,
  },
];

const incidents: readonly DemoIncident[] = [
  {
    auditEventId: demoOperatorIds.incident,
    eventType: "lifecycle.provider_effect.dead_lettered",
    aggregateType: "provider_operation",
    aggregateId: demoOperatorIds.order,
    accountId: demoOperatorIds.account,
    requestId: "experience:demo:provider-operation:ORD-2026-0098",
    occurredAt: "2026-07-31T14:08:00.000Z",
    boundary: "provisioning",
    safeCode: "PROVIDER_TIMEOUT",
    taskIdentifier: "activate_subscription",
    outboxMessageId: demoOperatorIds.incidentOutbox,
    diagnosis: {
      kind: "provider_message",
      message: demoText({
        en: "The activation provider did not answer before its deadline.",
        es: "El proveedor de activación no respondió antes del plazo límite.",
        fr: "Le prestataire d’activation n’a pas répondu avant l’échéance.",
        de: "Der Aktivierungsanbieter hat nicht vor Ablauf der Frist geantwortet.",
        ja: "アクティベーションのプロバイダーが期限までに応答しませんでした。",
        pt: "O provedor de ativação não respondeu antes do prazo.",
        zh: "开通服务商未在截止时间前响应。",
        ar: "لم يستجب مزوّد التفعيل قبل انقضاء المهلة.",
      }),
      provenance: "operationAttempt",
    },
    decisionCount: 0,
    latestDecision: null,
    latestDecisionReason: null,
    latestDecisionAt: null,
  },
];

const prefixes = {
  recovery: "demo-operator-recovery:",
  webhook: "demo-operator-webhook:",
  reconciliation: "demo-operator-reconciliation:",
  incident: "demo-operator-incident:",
  migration: "demo-operator-migration:",
} as const;

export interface DemoMigrationDecision {
  readonly migrationId: string;
  readonly action: "link" | "create";
  readonly targetAccountId: string | null;
  readonly reason: string;
  readonly actorId: string;
  readonly decidedAt: string;
  readonly version: number;
}

function override(
  state: DemoAdapterState,
  key: string,
): DemoProjectionOverride | undefined {
  return state.projectionOverrides[key];
}

function nextState(
  state: DemoAdapterState,
  key: string,
  updatedAt: string,
  data: Readonly<Record<string, unknown>>,
): DemoAdapterState {
  const previous = override(state, key);
  return {
    ...state,
    revision: state.revision + 1,
    projectionOverrides: {
      ...state.projectionOverrides,
      [key]: {
        version: (previous?.version ?? 0) + 1,
        updatedAt,
        data,
      },
    },
  };
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

export async function readDemoDeadLetters(input: {
  sources?: readonly DeadLetterSource[];
  store?: DemoAdapterStateStore;
}): Promise<readonly DeadLetterOperation[]> {
  const state = await (input.store ?? configuredDemoStateStore()).read();
  return deadLetters
    .filter(
      (operation) => !input.sources || input.sources.includes(operation.source),
    )
    .flatMap((operation) => {
      const decision = override(
        state,
        `${prefixes.recovery}${operation.source}:${operation.id}`,
      )?.data;
      if (decision?.kind === "dead_letter_abandoned") return [];
      if (decision?.kind !== "dead_letter_retry") return [operation];
      return [
        {
          ...operation,
          decision: "retry_requested" as const,
          decisionReason: string(decision.reason),
          decidedAt: string(decision.decidedAt),
        },
      ];
    });
}

export async function decideDemoDeadLetter(input: {
  source: DeadLetterSource;
  id: string;
  action: "retry" | "abandon";
  reason: string;
  actorId: string;
  now?: string;
  store?: DemoAdapterStateStore;
}): Promise<{ redriveSubmitted: boolean }> {
  const store = input.store ?? configuredDemoStateStore();
  const candidate = deadLetters.find(
    (operation) =>
      operation.source === input.source && operation.id === input.id,
  );
  if (!candidate) throw new Error("DEAD_LETTER_OPERATION_NOT_FOUND");
  const key = `${prefixes.recovery}${input.source}:${input.id}`;
  const decidedAt = input.now ?? new Date().toISOString();
  let redriveSubmitted = false;
  await store.update((state) => {
    const prior = override(state, key)?.data;
    if (prior?.kind === "dead_letter_abandoned")
      throw new Error("DEAD_LETTER_OPERATION_NOT_FOUND");
    if (prior?.kind === "dead_letter_retry" && input.action === "retry")
      return state;
    redriveSubmitted = input.action === "retry";
    return nextState(state, key, decidedAt, {
      kind:
        input.action === "retry"
          ? "dead_letter_retry"
          : "dead_letter_abandoned",
      reason: input.reason,
      actorId: input.actorId,
      decidedAt,
    });
  });
  return { redriveSubmitted };
}

export async function readDemoWebhookEvents(input: {
  provider?: string;
  limit?: number;
  store?: DemoAdapterStateStore;
}): Promise<readonly ReplayableWebhookEvent[]> {
  const state = await (input.store ?? configuredDemoStateStore()).read();
  return webhookEvents
    .filter((event) => !input.provider || event.provider === input.provider)
    .filter(
      (event) =>
        !override(
          state,
          `${prefixes.webhook}${event.provider}:${event.providerEventId}`,
        ),
    )
    .slice(0, Math.min(Math.max(input.limit ?? 100, 1), 200));
}

export async function replayDemoWebhook(input: {
  provider: string;
  providerEventId: string;
  reason: string;
  actorId: string;
  now?: string;
  store?: DemoAdapterStateStore;
}): Promise<{ started: boolean; workflowRunId: string }> {
  const store = input.store ?? configuredDemoStateStore();
  const candidate = webhookEvents.find(
    (event) =>
      event.provider === input.provider &&
      event.providerEventId === input.providerEventId,
  );
  if (!candidate) throw new Error("WEBHOOK_REPLAY_EVENT_NOT_FOUND");
  const key = `${prefixes.webhook}${input.provider}:${input.providerEventId}`;
  const workflowRunId = demoOperatorIds.workflowReplay;
  const replayedAt = input.now ?? new Date().toISOString();
  let started = false;
  await store.update((state) => {
    started = false;
    if (override(state, key)) return state;
    started = true;
    return nextState(state, key, replayedAt, {
      kind: "webhook_replay_started",
      actorId: input.actorId,
      reason: input.reason,
      replayedAt,
      workflowRunId,
    });
  });
  return { started, workflowRunId };
}

export async function readDemoReconciliationWorkspace(
  input: {
    limit?: number;
    store?: DemoAdapterStateStore;
  } = {},
): Promise<ReconciliationWorkspace> {
  const state = await (input.store ?? configuredDemoStateStore()).read();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const variances = reconciliationVariances.slice(0, limit).map((variance) => {
    const data = override(
      state,
      `${prefixes.reconciliation}${variance.caseId}`,
    )?.data;
    if (data?.kind !== "reconciliation_disposition") return variance;
    const storedClassification = string(data.classification);
    const classification =
      storedClassification && isVarianceClassification(storedClassification)
        ? storedClassification
        : null;
    return {
      ...variance,
      rowVersion: integer(data.rowVersion) ?? variance.rowVersion,
      latestClassification: classification,
      latestClassificationReason: string(data.reason),
      latestClassificationAt: string(data.classifiedAt),
      expectedClearingPeriod: string(data.expectedClearingPeriod),
    };
  });
  return {
    periods: tieOutPeriods.slice(0, limit),
    variances,
    // i18n-exempt: the finance page frame reads this as provenance and does not render it; the finance lane owns ReconciliationWorkspace.source
    source: "Demonstration tie-out and reconciliation ledger",
    readable: true,
  };
}

export async function classifyDemoReconciliationVariance(input: {
  caseId: string;
  expectedRowVersion: number;
  classification: VarianceClassification;
  reason: string;
  expectedClearingPeriod?: string;
  evidenceReference?: string;
  actorId: string;
  now?: string;
  store?: DemoAdapterStateStore;
}): Promise<{ blocksClose: boolean; rowVersion: number }> {
  const store = input.store ?? configuredDemoStateStore();
  const candidate = reconciliationVariances.find(
    (variance) => variance.caseId === input.caseId,
  );
  if (!candidate) throw new Error("RECONCILIATION_CASE_NOT_FOUND");
  const key = `${prefixes.reconciliation}${input.caseId}`;
  const classifiedAt = input.now ?? new Date().toISOString();
  let rowVersion = 0;
  await store.update((state) => {
    const data = override(state, key)?.data;
    const currentVersion = integer(data?.rowVersion) ?? candidate.rowVersion;
    if (currentVersion !== input.expectedRowVersion)
      throw new Error("RECONCILIATION_VERSION_CONFLICT");
    rowVersion = currentVersion + 1;
    return nextState(state, key, classifiedAt, {
      kind: "reconciliation_disposition",
      classification: input.classification,
      reason: input.reason,
      expectedClearingPeriod: input.expectedClearingPeriod ?? null,
      evidenceReference: input.evidenceReference ?? null,
      actorId: input.actorId,
      classifiedAt,
      rowVersion,
    });
  });
  return { blocksClose: blocksClose(input.classification), rowVersion };
}

export async function readDemoRuntimeFailureIncidents(input: {
  /** The reader's interface language, for the demo-authored provider text. */
  locale: Locale;
  limit?: number;
  store?: DemoAdapterStateStore;
}): Promise<IncidentQueue> {
  const state = await (input.store ?? configuredDemoStateStore()).read();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  return {
    incidents: incidents.slice(0, limit).map((seed) => {
      const incident: RuntimeFailureIncident = resolveDemoText(
        seed,
        input.locale,
      );
      const data = override(
        state,
        `${prefixes.incident}${incident.auditEventId}`,
      )?.data;
      if (data?.kind !== "incident_decision") return incident;
      const storedDecision = string(data.decision);
      const latestDecision: IncidentDecision | null =
        storedDecision === "contain" || storedDecision === "release"
          ? storedDecision
          : null;
      return {
        ...incident,
        decisionCount: integer(data.recordVersion) ?? incident.decisionCount,
        latestDecision,
        latestDecisionReason: string(data.reason),
        latestDecisionAt: string(data.decidedAt),
      };
    }),
    source: "demo",
    readable: true,
    state: "read",
  };
}

export async function decideDemoRuntimeFailure(input: {
  auditEventId: string;
  decision: IncidentDecision;
  reason: string;
  containmentReference?: string;
  actorId: string;
  now?: string;
  store?: DemoAdapterStateStore;
}): Promise<{ recordVersion: number }> {
  const store = input.store ?? configuredDemoStateStore();
  const candidate = incidents.find(
    (incident) => incident.auditEventId === input.auditEventId,
  );
  if (!candidate) throw new Error("UNHANDLED_ERROR_NOT_FOUND");
  const key = `${prefixes.incident}${input.auditEventId}`;
  const decidedAt = input.now ?? new Date().toISOString();
  let recordVersion = 0;
  await store.update((state) => {
    const data = override(state, key)?.data;
    recordVersion = (integer(data?.recordVersion) ?? 0) + 1;
    return nextState(state, key, decidedAt, {
      kind: "incident_decision",
      decision: input.decision,
      reason: input.reason,
      containmentReference: input.containmentReference ?? null,
      actorId: input.actorId,
      decidedAt,
      recordVersion,
    });
  });
  return { recordVersion };
}

function migrationDecision(
  data: Readonly<Record<string, unknown>> | undefined,
): DemoMigrationDecision | null {
  if (data?.kind !== "migration_decision") return null;
  const migrationId = string(data.migrationId);
  const action = string(data.action);
  const targetAccountId = data.targetAccountId;
  const reason = string(data.reason);
  const actorId = string(data.actorId);
  const decidedAt = string(data.decidedAt);
  const version = integer(data.version);
  if (
    !migrationId ||
    (action !== "link" && action !== "create") ||
    (targetAccountId !== null && typeof targetAccountId !== "string") ||
    !reason ||
    !actorId ||
    !decidedAt ||
    !version
  )
    // i18n-exempt: an invariant on stored demo state, caught by the caller and never shown
    throw new Error("Demo migration decision is invalid");
  return {
    migrationId,
    action,
    targetAccountId,
    reason,
    actorId,
    decidedAt,
    version,
  };
}

export async function readDemoMigrationDecisions(
  store: DemoAdapterStateStore = configuredDemoStateStore(),
): Promise<readonly DemoMigrationDecision[]> {
  const state = await store.read();
  return illustrativeMigrations.flatMap((record) => {
    const decision = migrationDecision(
      override(state, `${prefixes.migration}${record.id}`)?.data,
    );
    return decision ? [decision] : [];
  });
}

export async function decideDemoMigration(input: {
  migrationId: string;
  action: "link" | "create";
  targetAccountId: string | null;
  reason: string;
  actorId: string;
  now?: string;
  store?: DemoAdapterStateStore;
}): Promise<DemoMigrationDecision> {
  const record = illustrativeMigrations.find(
    (candidate) => candidate.id === input.migrationId,
  );
  if (!record) throw new Error("MIGRATION_RECORD_NOT_FOUND");
  const selected = record.candidates.find(
    (candidate) => candidate.id === input.targetAccountId,
  );
  if (
    (input.action === "link" && !selected) ||
    (input.action === "create" && record.candidates.length > 0) ||
    (input.action === "create" && input.targetAccountId !== null)
  )
    throw new Error("MIGRATION_DECISION_INVALID");
  const store = input.store ?? configuredDemoStateStore();
  const key = `${prefixes.migration}${record.id}`;
  const decidedAt = input.now ?? new Date().toISOString();
  let result: DemoMigrationDecision | undefined;
  await store.update((state) => {
    const existing = migrationDecision(override(state, key)?.data);
    if (existing) {
      result = existing;
      return state;
    }
    result = {
      migrationId: record.id,
      action: input.action,
      targetAccountId: input.targetAccountId,
      reason: input.reason,
      actorId: input.actorId,
      decidedAt,
      version: 1,
    };
    return nextState(state, key, decidedAt, {
      kind: "migration_decision",
      ...result,
    });
  });
  if (!result) throw new Error("MIGRATION_DECISION_FAILED");
  return result;
}
