import "server-only";

import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import {
  FileDemoAdapterStateStore,
  findDemoProductionMarker,
  type DemoAdapterState,
  type DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { commercialRecords } from "@/src/features/customer-partner/commercial/model";
import { customerCollections } from "@/src/features/customer-partner/customer/customer-data";
import { partnerSurfaces } from "@/src/features/customer-partner/partner/partner-data";
import { formatMoney } from "@/src/features/shared/format";

import { resolveScopedAccount } from "./authorization";
import {
  demoInvoiceFigures,
  demoRecordArtifacts,
  demoUuid,
} from "./demo-artifact-catalog";
import {
  demoAdditionalRecords,
  demoCreatedOrderRecord,
  demoRecordAccounts,
  demoTaxedBillingRecords,
  DEMO_DEFAULT_CUSTOMER_ACCOUNT,
  DEMO_DEFAULT_PARTNER_ACCOUNT,
  type DemoCreatedOrder,
} from "./demo-portal-records";
import { configuredDemoStateStore } from "./demo-state-store";
import { DatabaseExperienceRepository } from "./repository";
import {
  ExperienceProblem,
  type ExperienceAudience,
  type ProjectionActionInput,
  type ProjectionActionReceipt,
  type ProjectionChannel,
  type ProjectionListInput,
  type ProjectionOrder,
  type ProjectionPage,
  type ProjectionRecord,
} from "./model";

export interface ProjectionSource {
  list(input: ProjectionListInput): Promise<ProjectionPage>;
  find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord>;
  action(input: ProjectionActionInput): Promise<ProjectionActionReceipt>;
  receipt(input: {
    session: SessionClaims;
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    accountId: string | null;
    recordKey: string;
    actionRequestId: string;
    requestId: string;
  }): Promise<ProjectionActionReceipt>;
}

export class DatabaseProjectionSource implements ProjectionSource {
  public constructor(
    private readonly repository = new DatabaseExperienceRepository(),
  ) {}

  public list(input: ProjectionListInput) {
    return this.repository.listProjections(input);
  }

  public find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ) {
    return this.repository.findProjection(input);
  }

  public action(input: ProjectionActionInput) {
    return this.repository.queueProjectionAction(input);
  }

  public receipt(input: Parameters<ProjectionSource["receipt"]>[0]) {
    return this.repository.getProjectionAction(input);
  }
}

interface DemoRecord {
  id: string;
  key: string;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  /**
   * The account the record belongs to, mirroring `audience_account_id`. Null
   * only for the internal audience, which the persisted query scopes with
   * `audience_account_id is null`.
   */
  accountId: string | null;
  version: number;
  updatedAt: string;
  data: Readonly<Record<string, unknown>>;
}

function ownerOf(
  audience: ExperienceAudience,
  channel: string,
  key: string,
  fallback: string,
): string {
  return demoRecordAccounts[`${audience}:${channel}:${key}`] ?? fallback;
}

function customerRecords(): DemoRecord[] {
  return commercialRecords.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    key: record.id,
    audience: "customer" as const,
    channel: record.kind,
    accountId: ownerOf(
      "customer",
      record.kind,
      record.id,
      DEMO_DEFAULT_CUSTOMER_ACCOUNT,
    ),
    version: Number(record.version ?? "1"),
    updatedAt: record.updatedAt,
    data: {
      ...record,
      ...(record.kind === "orders"
        ? { authoritative: { status: record.status } }
        : {}),
      allowedActions:
        record.kind === "quotes" && record.status === "open"
          ? ["accept", "expire"]
          : [],
    },
  }));
}

function partnerRecords(): DemoRecord[] {
  const records: DemoRecord[] = [];
  let index = 1000;
  for (const [channel, surface] of Object.entries(partnerSurfaces)) {
    for (const record of surface.records) {
      index += 1;
      records.push({
        id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        key: record.id,
        audience: "partner",
        channel: channel as ProjectionChannel,
        accountId: ownerOf(
          "partner",
          channel,
          record.id,
          DEMO_DEFAULT_PARTNER_ACCOUNT,
        ),
        version: 1,
        updatedAt: "2026-07-31T16:00:00.000Z",
        data: { ...record, allowedActions: [] },
      });
    }
  }
  return records;
}

function customerCollectionRecords(): DemoRecord[] {
  const records: DemoRecord[] = [];
  let index = 2000;
  for (const [channel, collection] of Object.entries(customerCollections)) {
    for (const record of collection.records) {
      index += 1;
      records.push({
        id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        key: record.id,
        audience: "customer",
        channel: channel as ProjectionChannel,
        accountId: ownerOf(
          "customer",
          channel,
          record.id,
          DEMO_DEFAULT_CUSTOMER_ACCOUNT,
        ),
        version: record.recordVersion ?? 1,
        updatedAt: record.updatedAt,
        data: { ...record, allowedActions: [] },
      });
    }
  }
  return records;
}

function additionalRecords(): DemoRecord[] {
  return demoAdditionalRecords.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(4001 + index).padStart(12, "0")}`,
    key: record.key,
    audience: record.audience,
    channel: record.channel,
    accountId: record.accountId,
    version: record.version,
    updatedAt: record.updatedAt,
    data: record.data,
  }));
}

function internalRecords(): DemoRecord[] {
  const updatedAt = "2026-07-31T16:00:00.000Z";
  const records: ReadonlyArray<{
    channel: ProjectionChannel;
    key: string;
    data: Readonly<Record<string, unknown>>;
  }> = [
    {
      channel: "queues",
      key: "EXC-COL-008",
      data: {
        title: "Collections aging decision",
        statusLabel: "SLA breached · high risk",
        owner: "Amina Cole",
        nextAction: "Verify retention hold before service action",
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "queues",
      key: "EXC-PRV-012",
      data: {
        title: "Provisioning recovery approval",
        statusLabel: "Due today · high risk",
        owner: "James Kurz",
        nextAction: "Review provider evidence and recovery scope",
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "queues",
      key: "EXC-RET-003",
      data: {
        title: "Retention-exclusion deletion approval",
        statusLabel: "Blocked · legal review",
        owner: "Juno Okafor",
        nextAction: "Confirm legal hold and deletion evidence",
        allowedActions: ["review_exception"],
      },
    },
    {
      channel: "approvals",
      key: "APR-DEMO-001",
      data: {
        title: "Pricing exception approval",
        statusLabel: "Awaiting approval",
        owner: "Finance review",
        nextAction: "Compare exception evidence with policy",
        allowedActions: ["approve_exception"],
      },
    },
    {
      channel: "provisioning",
      key: "PRV-DEMO-001",
      data: {
        title: "Madrid replica recovery",
        statusLabel: "Provider recovery queued",
        owner: "Platform operations",
        nextAction: "Reconcile provider event before replay",
        allowedActions: ["replay_provider_event"],
      },
    },
  ];
  return records.map((record, index) => ({
    id: `50000000-0000-4000-8000-${String(3001 + index).padStart(12, "0")}`,
    key: record.key,
    audience: "internal" as const,
    channel: record.channel,
    accountId: null,
    version: 1,
    updatedAt,
    data: record.data,
  }));
}

const demoRecords = [
  ...customerRecords(),
  ...customerCollectionRecords(),
  ...partnerRecords(),
  ...internalRecords(),
  ...additionalRecords(),
];

/**
 * The orders a prospect created during this session, on the orders channel.
 *
 * Read from the demo state on every read rather than folded into the seeded
 * `demoRecords` constant, because they are written after that constant is
 * built. The projection identifier is derived from the order identifier so it
 * is stable across reads -- an identifier that changed between the collection
 * read and the detail read would make the record unopenable.
 *
 * This is the last link in the acceptance chain. Without it the create pass
 * would succeed, the surface would offer "Track this acceptance in orders", and
 * the ledger behind that link would not hold the order -- which is the same
 * dead end this whole change exists to close, moved one step later.
 */
function createdOrderRecords(state: DemoAdapterState): DemoRecord[] {
  const created = (
    state as { createdOrders?: Record<string, DemoCreatedOrder> }
  ).createdOrders;
  if (!created) return [];
  return Object.values(created).map((order) => {
    const record = demoCreatedOrderRecord(order);
    return {
      id: demoUuid(`projection:order:${order.id}`),
      key: record.key,
      audience: record.audience,
      channel: record.channel,
      accountId: record.accountId,
      version: record.version,
      updatedAt: record.updatedAt,
      data: record.data,
    };
  });
}

/**
 * The projection identifier a seeded demo record is served under.
 *
 * The identifiers are positional, assigned by the builders above, and the
 * acceptance surface sends one back as `quoteId` — it is the `aggregateId` the
 * quote row was rendered with. Resolving it here rather than restating the
 * numbering elsewhere is what keeps the two from drifting apart when a fixture
 * is inserted into the middle of one of those arrays.
 */
export function demoProjectionRecordId(
  audience: ExperienceAudience,
  channel: ProjectionChannel,
  recordKey: string,
): string | undefined {
  return demoRecords.find(
    (record) =>
      record.audience === audience &&
      record.channel === channel &&
      record.key === recordKey,
  )?.id;
}

function applyDemoState(
  record: DemoRecord,
  state: DemoAdapterState,
): DemoRecord {
  const override = state.projectionOverrides[record.id];
  if (!override) return record;
  return {
    ...record,
    version: override.version,
    updatedAt: override.updatedAt,
    data: { ...record.data, ...override.data },
  };
}

/**
 * The account test the persisted read applies.
 *
 * `accountScope` in the repository is `audience_account_id = $1` — or
 * `audience_account_id is null` when the caller resolved to no account, which
 * is the internal audience — and the `experience_projection_read` row policy
 * repeats it. This is the same predicate. Before it existed, a customer persona
 * could open another account's quote and the demo would render it under their
 * own account identifier: not a dead end, but the demo showing something the
 * product refuses.
 */
function withinAccount(record: DemoRecord, accountId: string | null): boolean {
  return record.accountId === accountId;
}

/**
 * The determination the money-bearing demo rows read their figures from.
 *
 * An "invoiced amount" is gross of tax. The fixtures state the net, and the
 * gross is whatever the engine says it is under the seeded rule book — so the
 * collection, the detail page and the invoice PDF cannot disagree, because
 * there is only one place the number comes from.
 */
async function taxedBillingData(
  record: DemoRecord,
): Promise<Readonly<Record<string, unknown>>> {
  const figures = await demoInvoiceFigures();
  const gross = formatMoney(figures.grossMinor, figures.currency);
  const tax = formatMoney(figures.taxMinor, figures.currency);
  const net = formatMoney(figures.netMinor, figures.currency);
  return {
    ...record.data,
    value: gross,
    valueLabel: "Invoiced amount (incl. tax)",
    invoicedNetOfTax: net,
    taxDetermined: tax,
    taxTreatment: figures.summary,
  };
}

async function projectionData(
  record: DemoRecord,
): Promise<Readonly<Record<string, unknown>>> {
  const data = demoTaxedBillingRecords.includes(
    `${record.audience}:${record.channel}:${record.key}`,
  )
    ? await taxedBillingData(record)
    : record.data;
  const artifacts = demoRecordArtifacts(
    record.audience,
    record.channel,
    record.key,
  );
  return artifacts.length > 0 ? { ...data, artifacts } : data;
}

function asProjection(
  record: DemoRecord,
  data: Readonly<Record<string, unknown>>,
  now: Date,
): ProjectionRecord {
  return {
    id: record.id,
    recordKey: record.key,
    aggregateType: record.channel,
    aggregateId: record.id,
    // The record's own account, not the caller's. The two are equal after the
    // scope filter; stamping the caller's was how another account's record used
    // to arrive labelled as the reader's own.
    accountId: record.accountId,
    audience: record.audience,
    channel: record.channel,
    version: record.version,
    sourceUpdatedAt: record.updatedAt,
    projectedAt: record.updatedAt,
    stale: now.getTime() - Date.parse(record.updatedAt) > 300_000,
    data,
  };
}

async function projectRecord(
  record: DemoRecord,
  now: Date,
): Promise<ProjectionRecord> {
  return asProjection(record, await projectionData(record), now);
}

/** Deterministic fixtures selected only through CLOCKWORK_EXPERIENCE_ADAPTER=demo. */
export class ExplicitDemoProjectionSource implements ProjectionSource {
  public constructor(
    private readonly stateStore: DemoAdapterStateStore = new FileDemoAdapterStateStore(),
  ) {}

  public async list(input: ProjectionListInput): Promise<ProjectionPage> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ExperienceProblem(
        422,
        "INVALID_CURSOR",
        "Projection cursor is invalid",
      );
    const state = await this.stateStore.read();
    const selected = [...demoRecords, ...createdOrderRecords(state)]
      .filter(
        (record) =>
          record.audience === input.audience &&
          record.channel === input.channel &&
          withinAccount(record, input.accountId),
      )
      .map((record) => applyDemoState(record, state));
    // Only an explicit `orderBy` sorts. The fixtures' own declaration order is
    // what the demo tour and its screenshots were built against, and quietly
    // re-sorting every unordered read to match the database's keyset would
    // change what the demo shows without any caller asking for it.
    const matching = input.orderBy
      ? [...selected].sort((left, right) => {
          const byKeyset =
            Date.parse(left.updatedAt) - Date.parse(right.updatedAt) ||
            left.id.localeCompare(right.id);
          return input.orderBy === "updated_asc" ? byKeyset : -byKeyset;
        })
      : selected;
    const page = matching.slice(offset, offset + input.limit);
    return {
      items: await Promise.all(
        page.map((record) => projectRecord(record, input.now)),
      ),
      nextCursor:
        offset + page.length < matching.length
          ? String(offset + page.length)
          : null,
      generatedAt: input.now.toISOString(),
      freshnessSeconds: 300,
    };
  }

  public find(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord> {
    return this.findWithState(input);
  }

  private async findWithState(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ): Promise<ProjectionRecord> {
    // The account test is part of the match, not a check after it, so a record
    // outside the caller's account is indistinguishable from one that does not
    // exist. The persisted read collapses the two the same way, deliberately:
    // telling them apart would be an enumeration oracle for another tenant's
    // references.
    const state = await this.stateStore.read();
    const record = [...demoRecords, ...createdOrderRecords(state)].find(
      (item) =>
        item.audience === input.audience &&
        item.channel === input.channel &&
        item.key === input.recordKey &&
        withinAccount(item, input.accountId),
    );
    if (!record)
      throw new ExperienceProblem(
        404,
        "PROJECTION_NOT_FOUND",
        "Projection record not found",
      );
    return projectRecord(applyDemoState(record, state), input.now);
  }

  public async action(
    input: ProjectionActionInput,
  ): Promise<ProjectionActionReceipt> {
    const record = await this.find({
      session: input.session,
      audience: input.audience,
      channel: input.channel,
      accountId: input.accountId,
      recordKey: input.recordKey,
      now: new Date(),
    });
    if (record.id !== input.projectionId)
      throw new ExperienceProblem(
        404,
        "PROJECTION_NOT_FOUND",
        "Projection record not found",
      );
    if (record.version !== input.expectedVersion)
      throw new ExperienceProblem(
        409,
        "VERSION_CONFLICT",
        "Projection record changed",
      );
    const allowed = Array.isArray(record.data.allowedActions)
      ? record.data.allowedActions
      : [];
    if (!allowed.includes(input.action))
      throw new ExperienceProblem(
        403,
        "ACTION_FORBIDDEN",
        "Action is not allowed for this record",
      );
    const receipt: ProjectionActionReceipt = {
      id: uuidV7(),
      projectionId: record.id,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      status: "queued",
      resultReference: null,
      resultCode: null,
      authoritativeVersion: null,
      commandReplayed: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      auditEventId: uuidV7(),
      outboxMessageId: uuidV7(),
    };
    await this.stateStore.update((state) => {
      const currentOverride = state.projectionOverrides[record.id];
      const currentVersion = currentOverride?.version ?? record.version;
      if (currentVersion !== input.expectedVersion)
        throw new ExperienceProblem(
          409,
          "VERSION_CONFLICT",
          "Projection record changed",
        );
      return {
        ...state,
        revision: state.revision + 1,
        projectionOverrides: {
          ...state.projectionOverrides,
          [record.id]: {
            version: currentVersion + 1,
            updatedAt: receipt.createdAt,
            data: {
              ...(currentOverride?.data ?? {}),
              status: "pending",
              statusLabel: "Action queued",
              nextAction: `${input.action} queued`,
              allowedActions: [],
            },
          },
        },
        actionReceipts: {
          ...state.actionReceipts,
          [receipt.id]: receipt,
        },
      };
    });
    return receipt;
  }

  public async receipt(
    input: Parameters<ProjectionSource["receipt"]>[0],
  ): Promise<ProjectionActionReceipt> {
    const projection = await this.find({
      session: input.session,
      audience: input.audience,
      channel: input.channel,
      accountId: input.accountId,
      recordKey: input.recordKey,
      now: new Date(),
    });
    const state = await this.stateStore.read();
    const receipt = state.actionReceipts[input.actionRequestId];
    if (!receipt || receipt.projectionId !== projection.id)
      throw new ExperienceProblem(
        404,
        "PROJECTION_ACTION_NOT_FOUND",
        "Projection action receipt not found",
      );
    return receipt;
  }
}

export function configuredProjectionSource(): ProjectionSource {
  const adapter = process.env.CLOCKWORK_EXPERIENCE_ADAPTER?.trim();
  if (adapter === "demo") {
    const productionMarker = findDemoProductionMarker(process.env);
    if (productionMarker)
      throw new ExperienceProblem(
        503,
        "DEMO_ADAPTER_FORBIDDEN",
        `Demo portal data is disabled because ${productionMarker} identifies production`,
      );
    return demoProjectionSource;
  }
  if (adapter && adapter !== "database")
    throw new ExperienceProblem(
      503,
      "PROJECTION_ADAPTER_INVALID",
      "Projection adapter selection is invalid",
    );
  return new DatabaseProjectionSource();
}

export function projectionInput(input: {
  session: SessionClaims;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  requestedAccountId: string | null;
  cursor?: string;
  limit: number;
  orderBy?: ProjectionOrder;
  now?: Date;
}): ProjectionListInput {
  const accountId = resolveScopedAccount(
    input.session,
    input.audience,
    input.requestedAccountId,
  );
  return {
    session: input.session,
    audience: input.audience,
    channel: input.channel,
    accountId,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: input.limit,
    ...(input.orderBy ? { orderBy: input.orderBy } : {}),
    now: input.now ?? new Date(),
  };
}

const demoProjectionSource = new ExplicitDemoProjectionSource(
  configuredDemoStateStore(),
);
