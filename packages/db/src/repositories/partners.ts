import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  PartnerDealInputSchema,
  PartnerInputSchema,
  addPartnerDays,
  expiringPartnerDealStatuses,
  openPartnerDealStatuses,
  partnerDealIsOpen,
  partnerDefaultProtectionDays,
  partnerExportLimit,
  partnerListLimit,
  trimPartnerDecimal,
  type Actor,
  type PartnerActivity,
  type PartnerDealConflict,
  type PartnerDealRecord,
  type PartnerDealWithConflicts,
  type PartnerInput,
  type PartnerListQuery,
  type PartnerNextStepDue,
  type PartnerOrganizationOption,
  type PartnerOwnerOption,
  type PartnerRecord,
  type PartnerSummary,
  type PartnerTerms,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { auditEvents, organizations } from "../schema";
import { commercePartnerDeals, commercePartners } from "../schema/partners";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

type PartnerRow = typeof commercePartners.$inferSelect;
type DealRow = typeof commercePartnerDeals.$inferSelect;
type UserActor = Actor & { kind: "user" };

/** Who a read is for and which day it is: "mine" and due dates need both. */
export interface PartnerReadScope {
  viewerId: string;
  /** The UTC day, `YYYY-MM-DD`. */
  today: string;
}

export interface PartnerListResult {
  rows: PartnerSummary[];
  /** More partners matched than one page holds. */
  truncated: boolean;
}

export interface PartnerDetail {
  partner: PartnerRecord;
  deals: PartnerDealWithConflicts[];
  activity: PartnerActivity[];
}

/** Next steps for one reader and the team, for the staff home page. */
export interface PartnerNextStepCounts {
  overdue: { mine: number; team: number };
  dueThisWeek: { mine: number; team: number };
}

/** The system actor that marks a registration expired once protection ends. */
export const partnerExpiryActor = {
  kind: "system",
  id: "partner-deal-expiry",
  display: "Commerce",
} as const satisfies Actor;

const termsOf = (row: PartnerRow): PartnerTerms => ({
  commissionPct: trimPartnerDecimal(row.commissionPct),
  commissionSchedule: row.commissionSchedule,
  commissionSteps: row.commissionSteps.map((step) => ({
    fromMonth: step.fromMonth,
    ratePct: trimPartnerDecimal(step.ratePct) ?? step.ratePct,
  })),
  marginPct: trimPartnerDecimal(row.marginPct),
  territory: row.territory,
  exclusivity: row.exclusivity,
  exclusivityNote: row.exclusivityNote,
  currency: row.currency,
  nfrAllowance: row.nfrAllowance,
  trialPeriod: row.trialPeriod,
  trialTargets: row.trialTargets,
  rows: row.termRows,
});

const partnerView = (
  row: PartnerRow,
  organizationName: string | null,
): PartnerRecord => ({
  id: row.id,
  name: row.name,
  website: row.website,
  region: row.region,
  models: [...row.models],
  status: row.status,
  ownerId: row.ownerId,
  ownerName: row.ownerName,
  organizationId: row.organizationId,
  organizationName,
  contacts: row.contacts,
  nextStep: row.nextStep,
  nextStepDue: row.nextStepDue,
  notes: row.notes,
  terms: termsOf(row),
  createdById: row.createdById,
  createdByName: row.createdByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

const dealView = (
  row: DealRow,
  organizationName: string | null,
): PartnerDealRecord => ({
  id: row.id,
  partnerId: row.partnerId,
  endClient: row.endClient,
  organizationId: row.organizationId,
  organizationName,
  registeredOn: row.registeredOn,
  protectedUntil: row.protectedUntil,
  estimatedSize: trimPartnerDecimal(row.estimatedSize),
  sizeUnit: row.sizeUnit,
  model: row.model,
  status: row.status,
  notes: row.notes,
  createdByName: row.createdByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

/** The columns a partner input writes, in the stored shape. */
function partnerColumns(input: PartnerInput, ownerName: string | null) {
  const { terms } = input;
  return {
    name: input.name,
    website: input.website,
    region: input.region,
    models: input.models,
    status: input.status,
    ownerId: input.ownerId,
    ownerName,
    organizationId: input.organizationId,
    contacts: input.contacts,
    nextStep: input.nextStep,
    nextStepDue: input.nextStepDue,
    notes: input.notes,
    commissionPct: terms.commissionPct,
    commissionSchedule: terms.commissionSchedule,
    commissionSteps: terms.commissionSteps,
    marginPct: terms.marginPct,
    territory: terms.territory,
    exclusivity: terms.exclusivity,
    exclusivityNote: terms.exclusivityNote,
    currency: terms.currency,
    nfrAllowance: terms.nfrAllowance,
    trialPeriod: terms.trialPeriod,
    trialTargets: terms.trialTargets,
    termRows: terms.rows,
  };
}

/** What a partner record holds, flattened for comparing two versions. */
function comparable(record: PartnerRecord): Record<string, unknown> {
  const { terms, ...rest } = record;
  return {
    name: rest.name,
    website: rest.website,
    region: rest.region,
    models: rest.models,
    status: rest.status,
    ownerName: rest.ownerName,
    organizationId: rest.organizationId,
    contacts: rest.contacts,
    nextStep: rest.nextStep,
    nextStepDue: rest.nextStepDue,
    notes: rest.notes,
    commissionPct: terms.commissionPct,
    commissionSchedule: terms.commissionSchedule,
    commissionSteps: terms.commissionSteps,
    marginPct: terms.marginPct,
    territory: terms.territory,
    exclusivity: terms.exclusivity,
    exclusivityNote: terms.exclusivityNote,
    currency: terms.currency,
    nfrAllowance: terms.nfrAllowance,
    trialPeriod: terms.trialPeriod,
    trialTargets: terms.trialTargets,
    termRows: terms.rows,
  };
}

/** What an input would store, in the same shape as {@link comparable}. */
function inputComparable(
  input: PartnerInput,
  ownerName: string | null,
): Record<string, unknown> {
  const { terms } = input;
  return {
    name: input.name,
    website: input.website,
    region: input.region,
    models: input.models,
    status: input.status,
    ownerName,
    organizationId: input.organizationId,
    contacts: input.contacts,
    nextStep: input.nextStep,
    nextStepDue: input.nextStepDue,
    notes: input.notes,
    commissionPct: trimPartnerDecimal(terms.commissionPct),
    commissionSchedule: terms.commissionSchedule,
    commissionSteps: terms.commissionSteps.map((step) => ({
      fromMonth: step.fromMonth,
      ratePct: trimPartnerDecimal(step.ratePct),
    })),
    marginPct: trimPartnerDecimal(terms.marginPct),
    territory: terms.territory,
    exclusivity: terms.exclusivity,
    exclusivityNote: terms.exclusivityNote,
    currency: terms.currency,
    nfrAllowance: terms.nfrAllowance,
    trialPeriod: terms.trialPeriod,
    trialTargets: terms.trialTargets,
    termRows: terms.rows,
  };
}

const dealComparable = (deal: PartnerDealRecord): Record<string, unknown> => ({
  endClient: deal.endClient,
  organizationId: deal.organizationId,
  registeredOn: deal.registeredOn,
  protectedUntil: deal.protectedUntil,
  estimatedSize: deal.estimatedSize,
  sizeUnit: deal.sizeUnit,
  model: deal.model,
  status: deal.status,
  notes: deal.notes,
});

/** The fields that differ, with the value before and after. */
/** JSON with object keys sorted, since jsonb does not keep key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : item,
  );
}

export function partnerChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => canonical(before[key]) !== canonical(after[key]))
      .map((key) => [
        key,
        { from: before[key] ?? null, to: after[key] ?? null },
      ]),
  );
}

/** `%` and `_` in a search are literal text, not wildcards. */
function contains(value: string) {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The database refuses with an upper-case code (001466); Drizzle wraps the
 * driver error, so the code is looked for on the error and its cause.
 */
function databaseRefusal(error: unknown): string | undefined {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 4;
    current = current.cause, depth += 1
  ) {
    const match = /\b(PARTNER_[A-Z_]+)\b/.exec(current.message);
    if (match) return match[1];
  }
  return undefined;
}

const openStatuses = [...openPartnerDealStatuses];

/**
 * Staff partner records and their registered deals (001466). Holders of
 * `sales:read` read them and `contract:write` changes them; the web layer
 * checks both, because the service role does not narrow rows. Every change
 * writes one `partner.*` audit event in the same transaction, and a read
 * first marks registrations whose protection has ended as expired.
 */
export class PartnerRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private async tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    try {
      return await withInternalTransaction(this.db, randomUUID(), fn);
    } catch (error) {
      const code = databaseRefusal(error);
      if (code) throw new Error(code);
      throw error;
    }
  }

  /** Partners matching the filters, most recently changed first. */
  list(query: PartnerListQuery, scope: PartnerReadScope) {
    return this.tx(async (tx) => {
      await expireLapsedDeals(tx, scope.today);
      const rows = await summaries(tx, query, scope, partnerListLimit + 1);
      return {
        rows: rows.slice(0, partnerListLimit),
        truncated: rows.length > partnerListLimit,
      } satisfies PartnerListResult;
    });
  }

  /** The same rows as the list, up to the export limit, for the CSV. */
  exportRows(query: PartnerListQuery, scope: PartnerReadScope) {
    return this.tx(async (tx) => {
      await expireLapsedDeals(tx, scope.today);
      const rows = await summaries(tx, query, scope, partnerExportLimit + 1);
      const ids = rows.slice(0, partnerExportLimit).map((row) => row.id);
      const records = ids.length
        ? await tx
            .select()
            .from(commercePartners)
            .where(inArray(commercePartners.id, ids))
        : [];
      const byId = new Map(records.map((row) => [row.id, row]));
      return {
        rows: rows.slice(0, partnerExportLimit).map((summary) => {
          const row = byId.get(summary.id);
          return {
            ...summary,
            website: row?.website ?? "",
            terms: row ? termsOf(row) : null,
          };
        }),
        truncated: rows.length > partnerExportLimit,
      };
    });
  }

  /** One partner with its deals, overlaps with other partners and history. */
  get(id: string, today: string): Promise<PartnerDetail> {
    return this.tx(async (tx) => {
      await expireLapsedDeals(tx, today);
      const [row] = await tx
        .select({
          partner: commercePartners,
          organizationName: organizations.name,
        })
        .from(commercePartners)
        .leftJoin(
          organizations,
          eq(organizations.id, commercePartners.organizationId),
        )
        .where(eq(commercePartners.id, id));
      if (!row) throw new Error("PARTNER_NOT_FOUND");
      const dealRows = await tx
        .select({
          deal: commercePartnerDeals,
          organizationName: organizations.name,
        })
        .from(commercePartnerDeals)
        .leftJoin(
          organizations,
          eq(organizations.id, commercePartnerDeals.organizationId),
        )
        .where(eq(commercePartnerDeals.partnerId, id))
        .orderBy(
          desc(commercePartnerDeals.registeredOn),
          desc(commercePartnerDeals.id),
        );
      const deals = dealRows.map(({ deal, organizationName }) =>
        dealView(deal, organizationName),
      );
      const conflicts = await conflictsFor(
        tx,
        dealRows
          .filter(({ deal }) => partnerDealIsOpen(deal, today))
          .map(({ deal }) => deal.normalizedEndClient ?? "")
          .filter(Boolean),
        id,
        today,
      );
      const normalizedById = new Map(
        dealRows.map(({ deal }) => [deal.id, deal.normalizedEndClient ?? ""]),
      );
      return {
        partner: partnerView(row.partner, row.organizationName),
        deals: deals.map((deal) => ({
          ...deal,
          conflicts: partnerDealIsOpen(deal, today)
            ? (conflicts.get(normalizedById.get(deal.id) ?? "") ?? [])
            : [],
        })),
        activity: await activity(
          tx,
          id,
          new Map(deals.map((deal) => [deal.id, deal.endClient])),
        ),
      };
    });
  }

  /**
   * Records a partner, or overwrites one when the input carries the version
   * it was opened at. A retried first save with the same id returns the
   * stored record.
   */
  save(raw: unknown, actor: UserActor): Promise<PartnerRecord> {
    const input = PartnerInputSchema.parse(raw);
    return this.tx(async (tx) => {
      const [current] = await tx
        .select()
        .from(commercePartners)
        .where(eq(commercePartners.id, input.id))
        .for("update");
      // An owner who has since left the sales workspace stays on the record
      // until someone picks another; only a newly chosen owner is checked.
      const ownerName =
        current && input.ownerId !== null && input.ownerId === current.ownerId
          ? current.ownerName
          : await resolveOwner(tx, input.ownerId);
      await assertOrganization(tx, input.organizationId);
      if (!current) {
        if (input.expectedVersion !== undefined)
          throw new Error("PARTNER_NOT_FOUND");
        const [inserted] = await tx
          .insert(commercePartners)
          .values({
            id: input.id,
            ...partnerColumns(input, ownerName),
            createdById: actor.id,
            createdByName: actor.display ?? actor.id,
          })
          .returning();
        if (!inserted) throw new Error("PARTNER_INSERT_FAILED");
        const record = partnerView(inserted, null);
        await appendAuditAndOutbox(tx, {
          aggregateType: "partner",
          aggregateId: record.id,
          aggregateVersion: record.version,
          eventType: "partner.created",
          actor,
          requestId: randomUUID(),
          after: { changes: partnerChanges({}, comparable(record)) },
        });
        return record;
      }
      if (input.expectedVersion === undefined) {
        // A retried first save: the same person, the record already stored.
        if (current.createdById !== actor.id || current.version !== 1)
          throw new Error("PARTNER_IDEMPOTENCY_CONFLICT");
        return partnerView(current, null);
      }
      if (current.version !== input.expectedVersion)
        throw new Error("PARTNER_VERSION_CONFLICT");
      const before = partnerView(current, null);
      const changes = partnerChanges(
        comparable(before),
        inputComparable(input, ownerName),
      );
      // Saving an unchanged form changes nothing and records nothing.
      if (Object.keys(changes).length === 0) return before;
      const [updated] = await tx
        .update(commercePartners)
        .set({
          ...partnerColumns(input, ownerName),
          updatedAt: sql`now()`,
          version: current.version + 1,
        })
        .where(eq(commercePartners.id, input.id))
        .returning();
      if (!updated) throw new Error("PARTNER_UPDATE_FAILED");
      const record = partnerView(updated, null);
      await appendAuditAndOutbox(tx, {
        aggregateType: "partner",
        aggregateId: record.id,
        aggregateVersion: record.version,
        eventType: "partner.updated",
        actor,
        requestId: randomUUID(),
        after: { changes },
      });
      return record;
    });
  }

  /**
   * Registers a deal for a partner, or overwrites one when the input carries
   * its version. An empty protection date takes the channel policy's default
   * protection from the registration day. Overlaps with other partners are
   * returned for the page to warn about; they never block.
   */
  saveDeal(
    raw: unknown,
    actor: UserActor,
    today: string,
  ): Promise<{ deal: PartnerDealRecord; conflicts: PartnerDealConflict[] }> {
    const input = PartnerDealInputSchema.parse(raw);
    return this.tx(async (tx) => {
      const [partner] = await tx
        .select({ id: commercePartners.id })
        .from(commercePartners)
        .where(eq(commercePartners.id, input.partnerId));
      if (!partner) throw new Error("PARTNER_NOT_FOUND");
      await assertOrganization(tx, input.organizationId);
      const protectedUntil =
        input.protectedUntil ??
        addPartnerDays(input.registeredOn, await protectionDays(tx));
      const columns = {
        endClient: input.endClient,
        organizationId: input.organizationId,
        registeredOn: input.registeredOn,
        protectedUntil,
        estimatedSize: input.estimatedSize,
        sizeUnit: input.sizeUnit,
        model: input.model,
        status: input.status,
        notes: input.notes,
      };
      const [current] = await tx
        .select()
        .from(commercePartnerDeals)
        .where(eq(commercePartnerDeals.id, input.id))
        .for("update");
      let saved: DealRow;
      if (!current) {
        if (input.expectedVersion !== undefined)
          throw new Error("PARTNER_DEAL_NOT_FOUND");
        const [inserted] = await tx
          .insert(commercePartnerDeals)
          .values({
            id: input.id,
            partnerId: input.partnerId,
            ...columns,
            createdById: actor.id,
            createdByName: actor.display ?? actor.id,
          })
          .returning();
        if (!inserted) throw new Error("PARTNER_DEAL_INSERT_FAILED");
        saved = inserted;
        await auditDeal(
          tx,
          saved,
          actor,
          "partner.deal_registered",
          partnerChanges({}, dealComparable(dealView(saved, null))),
        );
      } else {
        if (current.partnerId !== input.partnerId)
          throw new Error("PARTNER_DEAL_PARTNER_MISMATCH");
        if (input.expectedVersion === undefined) {
          if (current.createdById !== actor.id || current.version !== 1)
            throw new Error("PARTNER_IDEMPOTENCY_CONFLICT");
          saved = current;
        } else {
          if (current.version !== input.expectedVersion)
            throw new Error("PARTNER_DEAL_VERSION_CONFLICT");
          const changes = partnerChanges(
            dealComparable(dealView(current, null)),
            {
              ...columns,
              estimatedSize: trimPartnerDecimal(columns.estimatedSize),
            },
          );
          saved = current;
          if (Object.keys(changes).length) {
            const [updated] = await tx
              .update(commercePartnerDeals)
              .set({
                ...columns,
                updatedAt: sql`now()`,
                version: current.version + 1,
              })
              .where(eq(commercePartnerDeals.id, input.id))
              .returning();
            if (!updated) throw new Error("PARTNER_DEAL_UPDATE_FAILED");
            saved = updated;
            await auditDeal(tx, saved, actor, "partner.deal_updated", changes);
          }
        }
      }
      const conflicts = partnerDealIsOpen(saved, today)
        ? ((
            await conflictsFor(
              tx,
              [saved.normalizedEndClient ?? ""],
              saved.partnerId,
              today,
            )
          ).get(saved.normalizedEndClient ?? "") ?? [])
        : [];
      return { deal: dealView(saved, null), conflicts };
    });
  }

  /**
   * Other partners' open registrations for an end client, by the MNDA
   * register's company normalizer, for the warning shown while a seller
   * types. `excludePartnerId` leaves out the partner being worked on.
   */
  dealConflicts(
    endClient: string,
    options: { excludePartnerId?: string; today: string },
  ): Promise<PartnerDealConflict[]> {
    return this.tx(async (tx) => {
      const [normalized] = await tx.execute<{ value: string }>(
        sql`select public.commerce_mnda_normalize_company(${endClient}) as value`,
      );
      if (!normalized?.value) return [];
      return (
        (
          await conflictsFor(
            tx,
            [normalized.value],
            options.excludePartnerId,
            options.today,
          )
        ).get(normalized.value) ?? []
      );
    });
  }

  /** Staff who may own a partner: anyone with the sales workspace. */
  owners(): Promise<PartnerOwnerOption[]> {
    return this.tx((tx) => staffOwners(tx));
  }

  /** Customer and partner organizations a record or deal can link to. */
  organizations(): Promise<PartnerOrganizationOption[]> {
    return this.tx((tx) =>
      tx
        .select({
          id: organizations.id,
          name: organizations.name,
          side: organizations.side,
        })
        .from(organizations)
        .where(ne(organizations.side, "fil_one"))
        .orderBy(asc(organizations.name))
        .limit(1000),
    );
  }

  /** The protection a new registration gets: the channel policy in force,
   * or 90 days without one. */
  protectionDays(): Promise<number> {
    return this.tx((tx) => protectionDays(tx));
  }

  /**
   * Partners whose next step is due on or before `through`, earliest first,
   * optionally one owner's. Ended partners have no next step. This is the
   * query a reminder reads: `overdue` is relative to `today`.
   */
  nextStepsDue(input: {
    through: string;
    today: string;
    ownerId?: string;
  }): Promise<PartnerNextStepDue[]> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          partnerId: commercePartners.id,
          partnerName: commercePartners.name,
          ownerId: commercePartners.ownerId,
          ownerName: commercePartners.ownerName,
          nextStep: commercePartners.nextStep,
          nextStepDue: commercePartners.nextStepDue,
        })
        .from(commercePartners)
        .where(
          and(
            isNotNull(commercePartners.nextStepDue),
            lte(commercePartners.nextStepDue, input.through),
            ne(commercePartners.status, "ended"),
            input.ownerId
              ? eq(commercePartners.ownerId, input.ownerId)
              : undefined,
          ),
        )
        .orderBy(asc(commercePartners.nextStepDue), asc(commercePartners.name))
        .limit(partnerListLimit);
      return rows.map((row) => ({
        ...row,
        nextStepDue: row.nextStepDue ?? input.through,
        overdue: (row.nextStepDue ?? input.through) < input.today,
      }));
    });
  }

  /** Records who exported the partner list, with its filters and size. */
  recordExport(
    actor: Actor,
    event: { filters: PartnerListQuery; rows: number; truncated: boolean },
  ) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: "report_export",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "partner.list_exported",
        actor,
        requestId: randomUUID(),
        after: {
          filters: event.filters,
          rows: event.rows,
          truncated: event.truncated,
        },
      }),
    );
  }
}

/**
 * Next steps due for the staff home page: overdue, and due within seven days
 * (overdue included), for the reader and for the team. Ended partners count
 * nothing. The list filter `due=overdue` and `due=week` opens the same rows.
 */
export async function countPartnerNextSteps(
  db: RuntimeDatabase,
  scope: PartnerReadScope,
): Promise<PartnerNextStepCounts> {
  const week = addPartnerDays(scope.today, 7);
  const [row] = await withInternalTransaction(
    db,
    `sales-home:${randomUUID()}`,
    (tx) =>
      tx
        .select({
          overdueMine: sql<number>`count(*) filter (where ${commercePartners.nextStepDue} < ${scope.today}::date and ${commercePartners.ownerId} = ${scope.viewerId}::uuid)::int`,
          overdueTeam: sql<number>`count(*) filter (where ${commercePartners.nextStepDue} < ${scope.today}::date)::int`,
          weekMine: sql<number>`count(*) filter (where ${commercePartners.ownerId} = ${scope.viewerId}::uuid)::int`,
          weekTeam: sql<number>`count(*)::int`,
        })
        .from(commercePartners)
        .where(
          and(
            isNotNull(commercePartners.nextStepDue),
            lte(commercePartners.nextStepDue, week),
            ne(commercePartners.status, "ended"),
          ),
        ),
  );
  return {
    overdue: { mine: row?.overdueMine ?? 0, team: row?.overdueTeam ?? 0 },
    dueThisWeek: { mine: row?.weekMine ?? 0, team: row?.weekTeam ?? 0 },
  };
}

/** The list filters as one condition, shared by the list and the export. */
function listWhere(
  query: PartnerListQuery,
  scope: PartnerReadScope,
): SQL | undefined {
  const where: (SQL | undefined)[] = [];
  if (query.status) where.push(eq(commercePartners.status, query.status));
  if (query.model)
    where.push(
      sql`${commercePartners.models} @> array[${query.model}]::text[]`,
    );
  if (query.owner) where.push(eq(commercePartners.ownerId, query.owner));
  if (query.mine) where.push(eq(commercePartners.ownerId, scope.viewerId));
  if (query.due) {
    where.push(isNotNull(commercePartners.nextStepDue));
    where.push(ne(commercePartners.status, "ended"));
    where.push(
      query.due === "overdue"
        ? lt(commercePartners.nextStepDue, scope.today)
        : lte(commercePartners.nextStepDue, addPartnerDays(scope.today, 7)),
    );
  }
  if (query.q) {
    const pattern = contains(query.q);
    where.push(
      or(
        sql`${commercePartners.name} ilike ${pattern}`,
        sql`${commercePartners.region} ilike ${pattern}`,
        sql`${commercePartners.territory} ilike ${pattern}`,
        sql`exists (select 1 from jsonb_array_elements(${commercePartners.contacts}) c
          where c->>'name' ilike ${pattern} or c->>'email' ilike ${pattern}
            or c->>'role' ilike ${pattern})`,
        sql`exists (select 1 from public.commerce_partner_deals d
          where d.partner_id = ${commercePartners.id} and d.end_client ilike ${pattern})`,
      ),
    );
  }
  return where.length ? and(...where) : undefined;
}

async function summaries(
  tx: RuntimeTransaction,
  query: PartnerListQuery,
  scope: PartnerReadScope,
  limit: number,
): Promise<PartnerSummary[]> {
  const rows = await tx
    .select({
      id: commercePartners.id,
      name: commercePartners.name,
      region: commercePartners.region,
      models: commercePartners.models,
      status: commercePartners.status,
      ownerId: commercePartners.ownerId,
      ownerName: commercePartners.ownerName,
      nextStep: commercePartners.nextStep,
      nextStepDue: commercePartners.nextStepDue,
      commissionPct: commercePartners.commissionPct,
      marginPct: commercePartners.marginPct,
      currency: commercePartners.currency,
      updatedAt: commercePartners.updatedAt,
      openDeals: sql<number>`(select count(*)::int from public.commerce_partner_deals d
        where d.partner_id = ${commercePartners.id}
          and d.status in ('registered','accepted','disputed')
          and d.protected_until >= ${scope.today}::date)`,
    })
    .from(commercePartners)
    .where(listWhere(query, scope))
    .orderBy(desc(commercePartners.updatedAt), desc(commercePartners.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    models: [...row.models],
    commissionPct: trimPartnerDecimal(row.commissionPct),
    marginPct: trimPartnerDecimal(row.marginPct),
    openDeals: Number(row.openDeals),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Marks registrations whose protection ended before `today` as expired, one
 * audited change each. Rows another reader is already marking are skipped,
 * so two page loads at once never wait on each other or mark a row twice.
 */
export async function expireLapsedDeals(
  tx: RuntimeTransaction,
  today: string,
): Promise<number> {
  const lapsed = await tx
    .select({
      id: commercePartnerDeals.id,
      status: commercePartnerDeals.status,
    })
    .from(commercePartnerDeals)
    .where(
      and(
        inArray(commercePartnerDeals.status, [...expiringPartnerDealStatuses]),
        lt(commercePartnerDeals.protectedUntil, today),
      ),
    )
    .for("update", { skipLocked: true });
  if (!lapsed.length) return 0;
  const before = new Map(lapsed.map((row) => [row.id, row.status]));
  const expired = await tx
    .update(commercePartnerDeals)
    .set({
      status: "expired",
      updatedAt: sql`now()`,
      version: sql`${commercePartnerDeals.version} + 1`,
    })
    .where(
      and(
        inArray(
          commercePartnerDeals.id,
          lapsed.map((row) => row.id),
        ),
        inArray(commercePartnerDeals.status, [...expiringPartnerDealStatuses]),
      ),
    )
    .returning();
  for (const row of expired)
    await auditDeal(tx, row, partnerExpiryActor, "partner.deal_expired", {
      status: { from: before.get(row.id) ?? null, to: "expired" },
    });
  return expired.length;
}

/** Open registrations of other partners, keyed by normalized end client. */
async function conflictsFor(
  tx: RuntimeTransaction,
  normalized: readonly string[],
  excludePartnerId: string | undefined,
  today: string,
): Promise<Map<string, PartnerDealConflict[]>> {
  const keys = [...new Set(normalized.filter(Boolean))];
  const found = new Map<string, PartnerDealConflict[]>();
  if (!keys.length) return found;
  const rows = await tx
    .select({
      dealId: commercePartnerDeals.id,
      partnerId: commercePartnerDeals.partnerId,
      partnerName: commercePartners.name,
      endClient: commercePartnerDeals.endClient,
      normalized: commercePartnerDeals.normalizedEndClient,
      status: commercePartnerDeals.status,
      registeredOn: commercePartnerDeals.registeredOn,
      protectedUntil: commercePartnerDeals.protectedUntil,
    })
    .from(commercePartnerDeals)
    .innerJoin(
      commercePartners,
      eq(commercePartners.id, commercePartnerDeals.partnerId),
    )
    .where(
      and(
        inArray(commercePartnerDeals.normalizedEndClient, keys),
        inArray(commercePartnerDeals.status, openStatuses),
        sql`${commercePartnerDeals.protectedUntil} >= ${today}::date`,
        excludePartnerId
          ? ne(commercePartnerDeals.partnerId, excludePartnerId)
          : undefined,
      ),
    )
    .orderBy(asc(commercePartnerDeals.registeredOn))
    .limit(100);
  for (const { normalized: key, ...conflict } of rows) {
    if (!key) continue;
    found.set(key, [...(found.get(key) ?? []), conflict]);
  }
  return found;
}

/** The partner's audit trail and its deals', newest first. */
async function activity(
  tx: RuntimeTransaction,
  partnerId: string,
  dealClients: ReadonlyMap<string, string>,
): Promise<PartnerActivity[]> {
  const dealIds = [...dealClients.keys()];
  const rows = await tx
    .select({
      id: auditEvents.id,
      aggregateId: auditEvents.aggregateId,
      eventType: auditEvents.eventType,
      actor: auditEvents.actor,
      after: auditEvents.after,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .where(
      or(
        and(
          eq(auditEvents.aggregateType, "partner"),
          eq(auditEvents.aggregateId, partnerId),
        ),
        dealIds.length
          ? and(
              eq(auditEvents.aggregateType, "partner_deal"),
              inArray(auditEvents.aggregateId, dealIds),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(100);
  return rows.map((row) => {
    const actor = row.actor as Partial<Actor>;
    const after = (row.after ?? {}) as {
      changes?: Record<string, { from: unknown; to: unknown }>;
    };
    return {
      id: row.id,
      eventType: row.eventType,
      actorName: actor.display ?? actor.id ?? "",
      dealEndClient: dealClients.get(row.aggregateId) ?? null,
      changes: after.changes ?? {},
      occurredAt: row.occurredAt.toISOString(),
    };
  });
}

function auditDeal(
  tx: RuntimeTransaction,
  row: DealRow,
  actor: Actor,
  eventType: string,
  changes: Record<string, { from: unknown; to: unknown }>,
) {
  return appendAuditAndOutbox(tx, {
    aggregateType: "partner_deal",
    aggregateId: row.id,
    aggregateVersion: row.version,
    eventType,
    actor,
    requestId: randomUUID(),
    after: { partnerId: row.partnerId, changes },
  });
}

async function staffOwners(
  tx: RuntimeTransaction,
  ids?: readonly string[],
): Promise<PartnerOwnerOption[]> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select u.id, u.name
    from public.commerce_users u
    where u.is_internal_staff
      ${
        ids
          ? sql`and u.id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
          : sql``
      }
      and exists (
        select 1 from public.memberships m
        join public.organizations o on o.id = m.organization_id
        where m.user_id = u.id and o.side = 'fil_one'
          and public.member_has_permission(u.id, 'sales:read', m.organization_id))
    order by u.name, u.id
    limit 500`);
  return [...rows].map((row) => ({ id: row.id, name: row.name }));
}

/** The owner's name, checked to be staff with the sales workspace. */
async function resolveOwner(
  tx: RuntimeTransaction,
  ownerId: string | null,
): Promise<string | null> {
  if (!ownerId) return null;
  const [owner] = await staffOwners(tx, [ownerId]);
  if (!owner) throw new Error("PARTNER_OWNER_NOT_STAFF");
  return owner.name;
}

async function assertOrganization(
  tx: RuntimeTransaction,
  organizationId: string | null,
) {
  if (!organizationId) return;
  const [found] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        ne(organizations.side, "fil_one"),
      ),
    );
  if (!found) throw new Error("PARTNER_ORGANIZATION_NOT_FOUND");
}

async function protectionDays(tx: RuntimeTransaction): Promise<number> {
  const [row] = await tx.execute<{ days: number | null }>(
    sql`select (public.core_current_channel_policy()->>'defaultProtectionDays')::int as days`,
  );
  const days = Number(row?.days);
  return Number.isInteger(days) && days > 0
    ? days
    : partnerDefaultProtectionDays;
}
