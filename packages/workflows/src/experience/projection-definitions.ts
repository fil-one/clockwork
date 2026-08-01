import type {
  AuthoritativeOutboxEvent,
  AuthoritativeProjectionState,
  PortalProjectionMutation,
  ProjectionDefinition,
} from "./projection-materializer";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const aggregateConfiguration = {
  account: { channel: "dashboard", resource: "accounts" },
  quote: { channel: "quotes", resource: "quotes" },
  order: { channel: "orders", resource: "orders" },
  amendment: { channel: "amendments", resource: "amendments" },
  invoice: { channel: "billing", resource: "invoices" },
} as const;

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
    "price",
    "approve_exception",
    "reject_exception",
    "prepare_artifact",
    "issue",
    "expire",
    "accept",
    "revise",
  ],
  orders: ["prepare_artifact", "create"],
  amendments: ["prepare_artifact", "create", "accept", "apply"],
  invoices: [
    "create",
    "issue",
    "open",
    "pay",
    "void",
    "mark_uncollectible",
    "consolidate",
    "evaluate_dunning",
  ],
} as const;

function title(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function publicStatus(value: unknown): string {
  if (typeof value !== "string") return "pending";
  if (value === "issued") return "open";
  if (["expired", "rejected", "superseded", "void"].includes(value))
    return "canceled";
  if (
    ["active", "draft", "accepted", "pending", "paid", "blocked"].includes(
      value,
    )
  )
    return value;
  if (["complete", "completed", "succeeded"].includes(value)) return "complete";
  return "attention";
}

function amount(state: AuthoritativeProjectionState): string {
  for (const key of ["totalMinor", "amountMinor", "partnerResaleTotalMinor"]) {
    const value = state.data[key];
    if (typeof value === "string") return value;
  }
  return "—";
}

function customerActions(
  state: AuthoritativeProjectionState,
): readonly string[] {
  return state.aggregateType === "quote" && state.data.status === "issued"
    ? ["expire"]
    : [];
}

function presentation(
  state: AuthoritativeProjectionState,
  actions: readonly string[],
) {
  const label = `${title(state.aggregateType)} ${state.aggregateId.slice(0, 8)}`;
  const status = publicStatus(state.data.status);
  const value = amount(state);
  return {
    authoritative: state.data,
    id: state.aggregateId,
    kind: aggregateConfiguration[
      state.aggregateType as keyof typeof aggregateConfiguration
    ].channel,
    title: label,
    name: label,
    description: "Current authoritative commerce state",
    context: [{ label: "Authoritative version", value: String(state.version) }],
    status,
    statusLabel: title(status),
    tone: status === "blocked" ? "danger" : "neutral",
    risk: status === "blocked" ? "high" : "low",
    owner: "Clockwork",
    value,
    valueSort: 0,
    valueLabel: "Minor units",
    secondary: `Version ${state.version}`,
    updatedLabel: state.sourceUpdatedAt,
    dateLabel: state.sourceUpdatedAt,
    term: "Authoritative",
    nextAction: actions.length > 0 ? "Review available action" : "Read only",
    allowedActions: actions,
  } as const;
}

function projectAuthoritativeState(input: {
  event: AuthoritativeOutboxEvent;
  state: AuthoritativeProjectionState;
}): Promise<readonly PortalProjectionMutation[]> {
  const configuration =
    aggregateConfiguration[
      input.state.aggregateType as keyof typeof aggregateConfiguration
    ];
  if (!configuration) return Promise.resolve([]);
  const recordKey = `${input.state.aggregateType}-${input.state.aggregateId}`;
  const mutations: PortalProjectionMutation[] = [
    {
      audience: "internal",
      audienceAccountId: null,
      subjectAccountId: input.state.accountId,
      channel: configuration.channel,
      recordKey,
      commandResource: null,
      payload: presentation(input.state, []),
    },
  ];
  if (input.state.accountId) {
    const actions = customerActions(input.state);
    mutations.push({
      audience: "customer",
      audienceAccountId: input.state.accountId,
      subjectAccountId: input.state.accountId,
      channel: configuration.channel,
      recordKey,
      commandResource:
        actions.length > 0 ? `core:${configuration.resource}` : null,
      payload: presentation(input.state, actions),
    });
  }
  const partnerAccountId = input.state.data.partnerAccountId;
  if (
    typeof partnerAccountId === "string" &&
    uuidPattern.test(partnerAccountId) &&
    partnerAccountId !== input.state.accountId
  )
    mutations.push({
      audience: "partner",
      audienceAccountId: partnerAccountId,
      subjectAccountId: input.state.accountId,
      channel:
        input.state.aggregateType === "quote"
          ? "quotes"
          : input.state.aggregateType === "account"
            ? "portfolio"
            : configuration.channel,
      recordKey,
      commandResource: null,
      payload: presentation(input.state, []),
    });
  return Promise.resolve(mutations);
}

function eventDefinitions(): ProjectionDefinition[] {
  const definitions: ProjectionDefinition[] = [];
  for (const [aggregateType, configuration] of Object.entries(
    aggregateConfiguration,
  )) {
    for (const action of actionsByResource[configuration.resource]) {
      const topic = `core.${configuration.resource}.${action}`;
      definitions.push({
        topic,
        eventTypes: [topic],
        aggregateTypes: [aggregateType],
        project: projectAuthoritativeState,
      });
    }
  }
  return definitions;
}

/** Exact authoritative topics only; experience events are excluded to avoid recursion. */
export function createCanonicalPortalProjectionDefinitions(): readonly ProjectionDefinition[] {
  return eventDefinitions();
}
