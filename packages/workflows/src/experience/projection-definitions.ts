import type {
  AuthoritativeOutboxEvent,
  AuthoritativeProjectionState,
  PortalProjectionAudience,
  PortalProjectionMutation,
  ProjectionDefinition,
} from "./projection-materializer";
import {
  describeAggregate,
  publicStatus,
  riskFor,
  titleCase,
  toneFor,
} from "./projection-presentation";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Channel routing for every aggregate the authoritative state loader can read.
 *
 * `resource` is non-null only where `resourceByAggregate` in the portal command
 * executor can actually run a command. Aggregates without one project as
 * read-only records; their actions run through the dedicated lifecycle
 * endpoints rather than the projection action pipeline.
 */
const aggregateConfiguration = {
  account: {
    customer: "dashboard",
    partner: "portfolio",
    internal: "dashboard",
    resource: "accounts",
  },
  agreement: {
    customer: "agreements",
    partner: "agreements",
    internal: "agreements",
    resource: null,
  },
  quote: {
    customer: "quotes",
    partner: "quotes",
    internal: "quotes",
    resource: "quotes",
  },
  order: {
    customer: "orders",
    partner: "orders",
    internal: "orders",
    resource: "orders",
  },
  amendment: {
    customer: "amendments",
    partner: "amendments",
    internal: "amendments",
    resource: "amendments",
  },
  poc: {
    customer: "pocs",
    partner: "pocs",
    internal: "pocs",
    resource: null,
  },
  invoice: {
    customer: "billing",
    partner: "billing",
    internal: "collections",
    resource: "invoices",
  },
  termination: {
    customer: "services",
    partner: "services",
    internal: "provisioning",
    resource: null,
  },
  exception_case: {
    customer: null,
    partner: null,
    internal: "queues",
    resource: null,
  },
  approval: {
    customer: null,
    partner: null,
    internal: "approvals",
    resource: null,
  },
  provider_operation: {
    customer: null,
    partner: null,
    internal: "provisioning",
    resource: null,
  },
  report_export: {
    customer: null,
    partner: null,
    internal: "reports",
    resource: null,
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      customer: string | null;
      partner: string | null;
      internal: string | null;
      resource: string | null;
    }
  >
>;

type AggregateKey = keyof typeof aggregateConfiguration;

/**
 * What the portal may offer, per resource the command executor can reach.
 *
 * This is the same set the core repository implements for these five
 * resources -- `databaseCoreCommands` in `@clockwork/db/core` -- and
 * `command-catalogue.test.ts` in `@clockwork/api` holds the two lists equal. A
 * verb offered here that no branch implements renders as a button whose click
 * returns an unsupported-transition error, which is what `price` on a draft
 * quote and `void` on an open invoice used to do.
 *
 * Equality with that list is drift protection, not proof: agreeing lists once
 * admitted a verb invented in all of them. Whether a verb offered here reaches
 * a branch that can do anything is settled by
 * `command-catalogue.integration.test.ts`, which invokes it against the running
 * repository and fails only if the repository answers that no branch
 * implements it. Every verb below is invoked there by name.
 *
 * One weakness in that binding is worth knowing about here, because it is these
 * five verbs: `mutateAccount` branches on `create` and then stops, so `update`,
 * `add_role`, `add_contact`, `set_payment_terms` and `set_partner_credit` all
 * reach the same shared three-key patch. They do reach a branch, so they pass
 * honestly -- but a role, a contact, payment terms and a credit limit are
 * audited under their own event and never written, and no test here can see
 * that. `actionsFor` offers none of the five as a button, so no operator can
 * click one; if that changes, per-verb branches in `mutateAccount` are what has
 * to come first.
 */
const actionsByResource = {
  accounts: [
    "create",
    "update",
    "add_role",
    "add_contact",
    "set_payment_terms",
    "set_partner_credit",
  ],
  quotes: [
    "create",
    "approve_exception",
    "reject_exception",
    "prepare_artifact",
    "issue",
    "expire",
    "revise",
  ],
  orders: ["prepare_artifact", "create"],
  amendments: ["prepare_artifact", "create"],
  invoices: ["create", "evaluate_dunning"],
} as const;

/** Exported so the catalogue test can bind this list to the two others. */
export const portalCommandActions: Readonly<Record<string, readonly string[]>> =
  actionsByResource;

type ResourceKey = keyof typeof actionsByResource;

function status(state: AuthoritativeProjectionState): string {
  const value = state.data.status;
  return typeof value === "string" ? value : "";
}

/**
 * Actions a given audience may take directly on a record.
 *
 * Only transitions that are complete on their own belong here. Anything that
 * legally or financially requires more input is deliberately absent and runs
 * through its own surface instead:
 *
 * - quote acceptance needs the signatory title and attestation that
 *   `orders.authority_title` / `authority_attested` enforce, so it belongs to
 *   the order acceptance form, not a one-click action;
 * - invoice payment moves money through the provider payment session, so a
 *   local `pay` transition would mark an invoice settled without a receipt;
 * - amendment acceptance carries the same attestation requirement as an order.
 *
 * Every action returned here also appears in `actionsByResource`, so the
 * command executor and the database action guard agree with what the portal
 * renders. Role authorization is still enforced when the command runs; this set
 * bounds what is offered, not who may run it.
 */
function actionsFor(
  audience: PortalProjectionAudience,
  aggregateType: AggregateKey,
  state: AuthoritativeProjectionState,
): readonly string[] {
  const current = status(state);
  if (audience === "customer")
    return aggregateType === "quote" && current === "issued" ? ["expire"] : [];
  if (audience === "partner")
    return aggregateType === "quote" && current === "issued"
      ? ["prepare_artifact"]
      : [];
  switch (aggregateType) {
    case "quote":
      // Revision is absent for the same reason creation is: it needs a whole
      // quote configuration, so it belongs to the builder rather than a button.
      if (current === "draft") return ["issue"];
      if (current === "issued") return ["expire", "prepare_artifact"];
      if (current === "pending_exception")
        return ["approve_exception", "reject_exception"];
      return [];
    case "invoice":
      // Issuance is the billing workflow's, and void, uncollectible and paid
      // arrive on the Stripe webhook (§10). Dunning evaluation is ours: it
      // writes a collection case, never the invoice.
      if (["open", "issued"].includes(current)) return ["evaluate_dunning"];
      return [];
    case "order":
      return ["prepare_artifact"];
    // Acceptance and application are the amendment create command, which
    // carries the acceptance evidence the portal cannot collect on a click.
    case "amendment":
      return current === "draft" ? ["prepare_artifact"] : [];
    default:
      return [];
  }
}

/** Rejects any action the command layer would not accept for the resource. */
function supportedActions(
  resource: string | null,
  actions: readonly string[],
): readonly string[] {
  if (!resource) return [];
  const allowed = actionsByResource[resource as ResourceKey];
  if (!allowed) return [];
  return actions.filter((action) =>
    (allowed as readonly string[]).includes(action),
  );
}

function presentation(
  state: AuthoritativeProjectionState,
  channel: string,
  actions: readonly string[],
  now: Date,
) {
  const display = describeAggregate(state, now);
  const publicState = publicStatus(state.data.status);
  return {
    authoritative: state.data,
    id: state.aggregateId,
    kind: channel,
    reference: display.reference,
    title: display.title,
    name: display.title,
    description: display.description,
    context: display.context,
    status: publicState,
    statusLabel: titleCase(publicState),
    tone: toneFor(publicState, display.overdue),
    risk: riskFor(publicState, display.overdue),
    owner: display.reference,
    value: display.value,
    valueSort: display.valueSort,
    valueLabel: display.valueLabel,
    secondary: display.secondary,
    updatedLabel: state.sourceUpdatedAt,
    dateLabel: display.dateLabel,
    term: display.term,
    nextAction:
      actions.length > 0
        ? titleCase(actions[0] as string)
        : display.overdue
          ? "Needs review"
          : "Read only",
    allowedActions: actions,
  } as const;
}

function mutationFor(input: {
  audience: PortalProjectionAudience;
  audienceAccountId: string | null;
  subjectAccountId: string | null;
  channel: string;
  recordKey: string;
  resource: string | null;
  aggregateType: AggregateKey;
  state: AuthoritativeProjectionState;
  now: Date;
}): PortalProjectionMutation {
  const actions = supportedActions(
    input.resource,
    actionsFor(input.audience, input.aggregateType, input.state),
  );
  return {
    audience: input.audience,
    audienceAccountId: input.audienceAccountId,
    subjectAccountId: input.subjectAccountId,
    channel: input.channel,
    recordKey: input.recordKey,
    commandResource:
      actions.length > 0 && input.resource ? `core:${input.resource}` : null,
    payload: presentation(input.state, input.channel, actions, input.now),
  };
}

function projectAuthoritativeState(input: {
  event: AuthoritativeOutboxEvent;
  state: AuthoritativeProjectionState;
}): Promise<readonly PortalProjectionMutation[]> {
  const aggregateType = input.state.aggregateType as AggregateKey;
  const configuration = aggregateConfiguration[aggregateType];
  if (!configuration) return Promise.resolve([]);
  const recordKey = `${input.state.aggregateType}-${input.state.aggregateId}`;
  const now = new Date(input.event.occurredAt);
  const mutations: PortalProjectionMutation[] = [];

  if (configuration.internal)
    mutations.push(
      mutationFor({
        audience: "internal",
        audienceAccountId: null,
        subjectAccountId: input.state.accountId,
        channel: configuration.internal,
        recordKey,
        resource: configuration.resource,
        aggregateType,
        state: input.state,
        now,
      }),
    );

  if (input.state.accountId && configuration.customer)
    mutations.push(
      mutationFor({
        audience: "customer",
        audienceAccountId: input.state.accountId,
        subjectAccountId: input.state.accountId,
        channel: configuration.customer,
        recordKey,
        resource: configuration.resource,
        aggregateType,
        state: input.state,
        now,
      }),
    );

  const partnerAccountId = input.state.data.partnerAccountId;
  if (
    configuration.partner &&
    typeof partnerAccountId === "string" &&
    uuidPattern.test(partnerAccountId) &&
    partnerAccountId !== input.state.accountId
  )
    mutations.push(
      mutationFor({
        audience: "partner",
        audienceAccountId: partnerAccountId,
        subjectAccountId: input.state.accountId,
        channel: configuration.partner,
        recordKey,
        resource: configuration.resource,
        aggregateType,
        state: input.state,
        now,
      }),
    );

  return Promise.resolve(mutations);
}

/**
 * Core resources whose `core.<resource>.<action>` events resolve to an
 * aggregate the authoritative state loader can read.
 *
 * `entityByResource` in the core finance repository maps sixteen resources to
 * aggregate types, but `authoritativeQueries` only implements a subset. A topic
 * registered for an aggregate the loader cannot read would throw
 * `PROJECTION_AUTHORITATIVE_STATE_NOT_FOUND` on a real event, so this list is
 * the intersection rather than either side alone.
 */
const projectableResources = {
  accounts: "account",
  quotes: "quote",
  orders: "order",
  amendments: "amendment",
  invoices: "invoice",
  reports: "report_export",
  accounting_exports: "report_export",
  marketplace_reconciliations: "report_export",
} as const satisfies Readonly<Record<string, AggregateKey>>;

const reportActions = ["create", "issue", "prepare_artifact"] as const;

/**
 * Lifecycle and workflow topics that carry an aggregate the state loader reads.
 *
 * Every entry is an event type the write path already appends, and the outbox
 * topic equals it. Topics whose audit row binds to a satellite table (agreement
 * drafts, signature envelopes, provisioning attempts, roster entries) are
 * absent on purpose: the loader cannot resolve those ids, so registering them
 * would dead-letter the delivery instead of populating a channel.
 */
const lifecycleEventTopics = {
  agreement: ["agreement.executed"],
  poc: [
    "poc.qualification_submitted",
    "poc.approved",
    "poc.rejected",
    "poc.activated",
    "poc.success_recorded",
    "poc.converted",
    "poc.expired",
  ],
  termination: [
    "termination.requested",
    "termination.approved",
    "termination.rejected",
    "termination.teardown_confirmed",
  ],
  exception_case: [
    "exception_case.opened",
    "exception_case.decided",
    "exception_case.reassigned",
    "exception_case.absence_escalated",
  ],
  approval: ["approval.decided"],
  provider_operation: [
    "lifecycle.provider_effect.succeeded",
    "lifecycle.provider_effect.retry_scheduled",
    "lifecycle.provider_effect.dead_lettered",
    "lifecycle.effect.committed",
    "lifecycle.effect.retry_scheduled",
    "lifecycle.effect.dead_lettered",
  ],
} as const satisfies Readonly<Partial<Record<AggregateKey, readonly string[]>>>;

function eventDefinitions(): ProjectionDefinition[] {
  const definitions: ProjectionDefinition[] = [];
  const seen = new Set<string>();
  const add = (topic: string, aggregateType: string) => {
    if (seen.has(topic)) return;
    seen.add(topic);
    definitions.push({
      topic,
      eventTypes: [topic],
      aggregateTypes: [aggregateType],
      project: projectAuthoritativeState,
    });
  };

  for (const [resource, aggregateType] of Object.entries(
    projectableResources,
  )) {
    const actions =
      (actionsByResource[resource as ResourceKey] as
        readonly string[] | undefined) ?? reportActions;
    for (const action of actions)
      add(`core.${resource}.${action}`, aggregateType);
  }
  for (const [aggregateType, topics] of Object.entries(lifecycleEventTopics))
    for (const topic of topics) add(topic, aggregateType);
  return definitions;
}

export function createCanonicalPortalProjectionDefinitions(): readonly ProjectionDefinition[] {
  return eventDefinitions();
}

export { aggregateConfiguration, actionsFor, supportedActions };
