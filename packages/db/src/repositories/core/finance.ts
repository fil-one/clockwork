import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { Actor, EntityName } from "@clockwork/contracts";

import type { RuntimeTransaction } from "../../client";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  accountCommercialProfiles,
  accountingExportEntries,
  accountingExports,
  collectionActions,
  commitmentLedgerCorrections,
  commitmentPeriods,
  marketplaceEvents,
  orderCommercialProfiles,
  orderLineSnapshots,
  priceBookActivationEvents,
  quoteCommercialProfiles,
  quoteSnapshots,
} from "../../schema/core";

export interface CoreMutationAudit {
  accountId?: string;
  aggregateType: EntityName;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  actor: Actor;
  requestId: string;
  before?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function coreSnapshotHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function appendMutation(
  transaction: RuntimeTransaction,
  audit: CoreMutationAudit,
  after: Record<string, unknown>,
) {
  return appendAuditAndOutbox(transaction, {
    ...audit,
    after,
    topic: audit.eventType,
  });
}

/**
 * Transaction-scoped persistence for commercial operations. Callers supply the
 * authorized transaction so the state write and audit/outbox append commit or
 * roll back together.
 */
export class CoreFinanceRepository {
  public constructor(private readonly transaction: RuntimeTransaction) {}

  public async createAccountCommercialProfile(
    input: typeof accountCommercialProfiles.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [profile] = await this.transaction
      .insert(accountCommercialProfiles)
      .values(input)
      .returning();
    if (!profile) throw new Error("Account commercial profile was not created");
    await appendMutation(this.transaction, audit, {
      accountId: profile.accountId,
      billingModel: profile.billingModel,
      creditStatus: profile.creditStatus,
      newServiceBlocked: profile.newServiceBlocked,
      rowVersion: profile.rowVersion,
    });
    return profile;
  }

  public async updateAccountCredit(
    accountId: string,
    expectedRowVersion: number,
    changes: Pick<
      typeof accountCommercialProfiles.$inferInsert,
      | "approvedCreditLimitMinor"
      | "currentExposureMinor"
      | "creditStatus"
      | "newServiceBlocked"
      | "blockReason"
    >,
    audit: CoreMutationAudit,
  ) {
    const [profile] = await this.transaction
      .update(accountCommercialProfiles)
      .set(changes)
      .where(
        and(
          eq(accountCommercialProfiles.accountId, accountId),
          eq(accountCommercialProfiles.rowVersion, expectedRowVersion),
        ),
      )
      .returning();
    if (!profile) throw new Error("STALE_ACCOUNT_COMMERCIAL_PROFILE_VERSION");
    await appendMutation(this.transaction, audit, {
      accountId,
      creditStatus: profile.creditStatus,
      approvedCreditLimitMinor: profile.approvedCreditLimitMinor.toString(),
      currentExposureMinor: profile.currentExposureMinor.toString(),
      newServiceBlocked: profile.newServiceBlocked,
      blockReason: profile.blockReason,
      rowVersion: profile.rowVersion,
    });
    return profile;
  }

  public async recordPriceBookActivation(
    input: typeof priceBookActivationEvents.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [event] = await this.transaction
      .insert(priceBookActivationEvents)
      .values(input)
      .returning();
    if (!event) throw new Error("Price book activation was not recorded");
    await appendMutation(this.transaction, audit, {
      priceBookId: event.priceBookId,
      action: event.action,
      resultingStatus: event.resultingStatus,
      effectiveAt: event.effectiveAt.toISOString(),
      activationEventId: event.id,
    });
    return event;
  }

  public async recordIssuedQuote(input: {
    commercial: typeof quoteCommercialProfiles.$inferInsert;
    snapshot: unknown;
    snapshotRevision: number;
    issuedAt: Date;
    createdBy: string;
    audit: CoreMutationAudit;
  }) {
    const snapshotHash = coreSnapshotHash(input.snapshot);
    const [commercial] = await this.transaction
      .insert(quoteCommercialProfiles)
      .values(input.commercial)
      .returning();
    const [snapshot] = await this.transaction
      .insert(quoteSnapshots)
      .values({
        quoteId: input.commercial.quoteId,
        revision: input.snapshotRevision,
        snapshot: input.snapshot,
        snapshotHash,
        issuedAt: input.issuedAt,
        createdBy: input.createdBy,
      })
      .returning();
    if (!commercial || !snapshot)
      throw new Error("Issued quote evidence was not recorded");
    await appendMutation(this.transaction, input.audit, {
      quoteId: commercial.quoteId,
      channelShape: commercial.channelShape,
      merchantOfRecord: commercial.merchantOfRecord,
      pricingAuthority: commercial.pricingAuthority,
      snapshotId: snapshot.id,
      snapshotHash,
      revision: snapshot.revision,
    });
    return { commercial, snapshot };
  }

  public async recordAcceptedOrder(input: {
    commercial: typeof orderCommercialProfiles.$inferInsert;
    lineSnapshots: ReadonlyArray<{
      orderLineId: string;
      snapshot: unknown;
    }>;
    audit: CoreMutationAudit;
  }) {
    const [commercial] = await this.transaction
      .insert(orderCommercialProfiles)
      .values(input.commercial)
      .returning();
    if (!commercial)
      throw new Error("Order commercial profile was not created");
    const snapshots = await this.transaction
      .insert(orderLineSnapshots)
      .values(
        input.lineSnapshots.map((line) => ({
          orderLineId: line.orderLineId,
          snapshot: line.snapshot,
          snapshotHash: coreSnapshotHash(line.snapshot),
        })),
      )
      .returning();
    await appendMutation(this.transaction, input.audit, {
      orderId: commercial.orderId,
      merchantOfRecord: commercial.merchantOfRecord,
      billingShape: commercial.billingShape,
      governingAgreementVersion: commercial.governingAgreementVersion,
      provisioningIdempotencyKey: commercial.provisioningIdempotencyKey,
      lineSnapshotHashes: snapshots.map((line) => line.snapshotHash),
    });
    return { commercial, snapshots };
  }

  public async createCommitmentPeriod(
    input: typeof commitmentPeriods.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [period] = await this.transaction
      .insert(commitmentPeriods)
      .values(input)
      .returning();
    if (!period) throw new Error("Commitment period was not created");
    await appendMutation(this.transaction, audit, {
      periodId: period.id,
      ledgerId: period.ledgerId,
      sequence: period.sequence,
      startsAt: period.startsAt.toISOString(),
      endsAt: period.endsAt.toISOString(),
      allowanceQuantity: period.allowanceQuantity,
      contractedOverageRateMinor: period.contractedOverageRateMinor.toString(),
    });
    return period;
  }

  public async appendLedgerCorrection(
    input: typeof commitmentLedgerCorrections.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [correction] = await this.transaction
      .insert(commitmentLedgerCorrections)
      .values(input)
      .returning();
    if (!correction) throw new Error("Ledger correction was not appended");
    await appendMutation(this.transaction, audit, {
      correctionId: correction.id,
      ledgerId: correction.ledgerId,
      periodId: correction.periodId,
      reversesEntryId: correction.reversesEntryId,
      quantityDelta: correction.quantityDelta,
      overageDelta: correction.overageDelta,
      reasonCode: correction.reasonCode,
      sourceReference: correction.sourceReference,
    });
    return correction;
  }

  public async appendCollectionAction(
    input: typeof collectionActions.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [action] = await this.transaction
      .insert(collectionActions)
      .values(input)
      .returning();
    if (!action) throw new Error("Collection action was not appended");
    await appendMutation(this.transaction, audit, {
      collectionActionId: action.id,
      collectionCaseId: action.collectionCaseId,
      action: action.action,
      outcome: action.outcome,
      occurredAt: action.occurredAt.toISOString(),
    });
    return action;
  }

  public async claimMarketplaceEvent(
    input: typeof marketplaceEvents.$inferInsert,
    audit: CoreMutationAudit,
  ) {
    const [inserted] = await this.transaction
      .insert(marketplaceEvents)
      .values(input)
      .onConflictDoNothing({
        target: [marketplaceEvents.provider, marketplaceEvents.providerEventId],
      })
      .returning();
    if (inserted) {
      await appendMutation(this.transaction, audit, {
        marketplaceEventId: inserted.id,
        provider: inserted.provider,
        providerEventId: inserted.providerEventId,
        eventType: inserted.eventType,
        payloadHash: inserted.payloadHash,
      });
      return { kind: "claimed" as const, event: inserted };
    }
    const existing = await this.transaction.query.marketplaceEvents.findFirst({
      where: and(
        eq(marketplaceEvents.provider, input.provider),
        eq(marketplaceEvents.providerEventId, input.providerEventId),
      ),
    });
    if (!existing) throw new Error("MARKETPLACE_EVENT_CLAIM_RACE");
    if (existing.payloadHash !== input.payloadHash)
      throw new Error("MARKETPLACE_EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD");
    return { kind: "duplicate" as const, event: existing };
  }

  public async createAccountingExport(input: {
    export: typeof accountingExports.$inferInsert;
    entries: ReadonlyArray<
      Omit<typeof accountingExportEntries.$inferInsert, "exportId">
    >;
    audit: CoreMutationAudit;
  }) {
    const [header] = await this.transaction
      .insert(accountingExports)
      .values(input.export)
      .returning();
    if (!header) throw new Error("Accounting export was not created");
    const entries = await this.transaction
      .insert(accountingExportEntries)
      .values(input.entries.map((entry) => ({ ...entry, exportId: header.id })))
      .returning();
    await appendMutation(this.transaction, input.audit, {
      accountingExportId: header.id,
      exportType: header.exportType,
      adapter: header.adapter,
      currency: header.currency,
      totalDebitMinor: header.totalDebitMinor.toString(),
      totalCreditMinor: header.totalCreditMinor.toString(),
      entryCount: entries.length,
    });
    return { header, entries };
  }

  public async readInternalReport(
    report:
      | "revenue_forecast"
      | "capacity"
      | "renewal_churn"
      | "partner_performance"
      | "funnel_cycle"
      | "margin_poc"
      | "three_way_tie_out"
      | "weekly_scorecard",
    limit = 100,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const views = {
      revenue_forecast: sql.identifier("core_revenue_forecast"),
      capacity: sql.identifier("core_capacity_planning"),
      renewal_churn: sql.identifier("core_renewal_churn_exposure"),
      partner_performance: sql.identifier("core_partner_performance"),
      funnel_cycle: sql.identifier("core_funnel_cycle_time"),
      margin_poc: sql.identifier("core_margin_poc_cost"),
      three_way_tie_out: sql.identifier("core_three_way_tie_out"),
      weekly_scorecard: sql.identifier("core_weekly_scorecard"),
    } as const;
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await this.transaction.execute(
      sql`select * from ${views[report]} limit ${safeLimit}`,
    );
    return result;
  }
}
