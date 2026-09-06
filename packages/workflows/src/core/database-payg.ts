import type { Actor } from "@clockwork/contracts";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import {
  accounts,
  auditEvents,
  commerceUsers,
  memberships,
  prospectiveSupplierEntity,
  withInternalTransaction,
  type RuntimeDatabase,
  type RuntimeTransaction,
} from "@clockwork/db";
import {
  paygEnrollments,
  paygOfferVersions,
  paygPendingInvoiceEffects,
  paygPeriodRevisions,
  paygSourceMeasurements,
  paygSourceReceipts,
} from "@clockwork/db/schema";
import {
  PaygOfferRecordSchema,
  paygEvidenceHash,
  paygInstant,
  validatePaygBinding,
  validatePaygMeasurement,
  validatePaygPolicy,
  type PaygBinding,
  type PaygMeasurement,
  type PaygPolicySnapshot,
} from "@clockwork/domain/core";

import {
  closePaygPeriod,
  type PaygBillingRepository,
  type PaygBillingTransaction,
  type PaygEnrollmentSnapshot,
  type PaygInvoiceEffect,
  type PaygPeriodRevision,
} from "./payg";

async function lockedEnrollment(
  tx: RuntimeTransaction,
  enrollmentId: string,
): Promise<PaygEnrollmentSnapshot> {
  const [row] = await tx
    .select()
    .from(paygEnrollments)
    .where(eq(paygEnrollments.id, enrollmentId))
    .for("update");
  if (!row) throw new Error("PAYG_ENROLLMENT_NOT_FOUND");
  const snapshot = row.snapshot as PaygEnrollmentSnapshot;
  if (
    snapshot.id !== row.id ||
    snapshot.binding.accountId !== row.accountId ||
    snapshot.binding.entitlementId !== row.sourceEntitlementId ||
    snapshot.binding.source !== row.source
  )
    throw new Error("PAYG_ENROLLMENT_BINDING_MISMATCH");
  validatePaygBinding(snapshot.binding);
  validatePaygPolicy(snapshot.policy);
  return snapshot;
}

/**
 * Service-only persisted boundary. The integration caller must first verify the
 * Fil One signature and retain raw verification evidence; receipt IDs and
 * payload hashes are atomically deduplicated again here. No browser API can
 * create enrollment, transfer authority, or inject source measurements.
 */
export class DatabasePaygBillingRepository implements PaygBillingRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public billingMonths(now: string): Promise<string[]> {
    const asOf = paygInstant(now);
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const rows = await tx
        .select({ snapshot: paygEnrollments.snapshot })
        .from(paygEnrollments);
      const months = new Set<string>();
      for (const row of rows) {
        const enrollment = row.snapshot as PaygEnrollmentSnapshot;
        const cursor = new Date(
          enrollment.startsAt.slice(0, 7) + "-01T00:00:00.000Z",
        );
        const end = Math.min(
          asOf,
          enrollment.endsAt ? paygInstant(enrollment.endsAt) : asOf,
        );
        while (cursor.getTime() < end) {
          months.add(cursor.toISOString().slice(0, 7));
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      }
      return [...months].sort();
    });
  }

  public listEnrollments() {
    return withInternalTransaction(this.database, randomUUID(), async (tx) =>
      (
        await tx
          .select()
          .from(paygEnrollments)
          .orderBy(desc(paygEnrollments.createdAt))
          .limit(200)
      ).map((row) => row.snapshot as PaygEnrollmentSnapshot),
    );
  }
  private async verifyAdministrator(
    tx: RuntimeTransaction,
    actor: Actor,
  ): Promise<void> {
    if (
      actor.kind !== "user" ||
      actor.effectiveUserId ||
      actor.impersonatedAccountId
    )
      throw new Error("PAYG_FINANCE_ACTOR_REQUIRED");
    const [staff] = await tx
      .select({ id: commerceUsers.id })
      .from(commerceUsers)
      .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
      .where(
        and(
          eq(commerceUsers.id, actor.id),
          eq(commerceUsers.isInternalStaff, true),
          eq(commerceUsers.mfaEnrolled, true),
          eq(memberships.role, "finance_approver"),
        ),
      )
      .limit(1)
      .for("share");
    if (!staff) throw new Error("PAYG_FINANCE_AUTHORITY_REQUIRED");
  }
  public requireAdministrator(actor: Actor): Promise<void> {
    return withInternalTransaction(this.database, randomUUID(), (tx) =>
      this.verifyAdministrator(tx, actor),
    );
  }

  public async enroll(input: {
    actor?: Actor;
    id: string;
    offerVersionId: string;
    binding: PaygBinding;
    bindingEvidenceId: string;
    startsAt: string;
    billingAuthority: "fil_one" | "clockwork";
    cutoverEvidenceId?: string | undefined;
    now: string;
  }): Promise<PaygEnrollmentSnapshot> {
    validatePaygBinding(input.binding);
    if (
      !input.bindingEvidenceId.trim() ||
      (input.billingAuthority === "clockwork" &&
        !input.cutoverEvidenceId?.trim())
    )
      throw new Error("PAYG_VERIFIED_ENROLLMENT_EVIDENCE_REQUIRED");
    const startsAt = paygInstant(input.startsAt);
    if (startsAt % 3_600_000 !== 0 || startsAt > paygInstant(input.now))
      throw new Error("PAYG_ENROLLMENT_START_INVALID");
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      if (input.actor) await this.verifyAdministrator(tx, input.actor);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`payg-enrollment:${input.id}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(paygEnrollments)
        .where(eq(paygEnrollments.id, input.id));
      if (existing) {
        const prior = existing.snapshot as PaygEnrollmentSnapshot;
        if (
          existing.offerVersionId !== input.offerVersionId ||
          paygEvidenceHash(prior.binding) !== paygEvidenceHash(input.binding) ||
          prior.startsAt !== input.startsAt ||
          prior.billingAuthority !== input.billingAuthority ||
          prior.cutoverEvidenceId !== input.cutoverEvidenceId ||
          existing.bindingEvidenceId !== input.bindingEvidenceId
        )
          throw new Error("PAYG_ENROLLMENT_REPLAY_CONFLICT");
        return prior;
      }
      const [row] = await tx
        .select()
        .from(paygOfferVersions)
        .where(eq(paygOfferVersions.id, input.offerVersionId))
        .for("share");
      if (!row) throw new Error("PAYG_APPROVED_POLICY_REQUIRED");
      const record = { ...row };
      Reflect.deleteProperty(record, "sku");
      Reflect.deleteProperty(record, "region");
      Reflect.deleteProperty(record, "version");
      const offer = PaygOfferRecordSchema.parse({
        ...record,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      if (
        offer.status !== "approved" ||
        !offer.approvalEvidenceId ||
        offer.terms.effectiveFrom > input.startsAt.slice(0, 10) ||
        offer.terms.sku !== input.binding.sku ||
        offer.terms.region !== input.binding.region
      )
        throw new Error("PAYG_APPROVED_POLICY_BINDING_MISMATCH");
      const policy: PaygPolicySnapshot = {
        ...offer.terms.payg,
        currency: offer.terms.payg.currency,
        id: offer.id,
        version: offer.terms.version,
        approvalEvidenceId: offer.approvalEvidenceId,
      };
      const supplierLegalEntityId = await prospectiveSupplierEntity(tx, {
        accountId: input.binding.accountId,
        taxPointDate: input.startsAt,
      });
      const account = await tx.query.accounts.findFirst({
        where: eq(accounts.id, input.binding.accountId),
      });
      if (!account?.stripeCustomerId)
        throw new Error("PAYG_STRIPE_CUSTOMER_UNMAPPED");
      const snapshot: PaygEnrollmentSnapshot = {
        id: input.id,
        binding: structuredClone(input.binding),
        policy,
        startsAt: input.startsAt,
        billingAuthority: input.billingAuthority,
        supplierLegalEntityId,
        stripeCustomerId: account.stripeCustomerId,
        ...(input.cutoverEvidenceId
          ? { cutoverEvidenceId: input.cutoverEvidenceId }
          : {}),
      };
      await tx.insert(paygEnrollments).values({
        id: input.id,
        accountId: input.binding.accountId,
        offerVersionId: offer.id,
        source: input.binding.source,
        sourceEntitlementId: input.binding.entitlementId,
        snapshot,
        bindingEvidenceId: input.bindingEvidenceId,
        createdAt: new Date(input.now),
      });
      if (input.actor)
        await tx.insert(auditEvents).values({
          accountId: input.binding.accountId,
          aggregateType: "payg_enrollment",
          aggregateId: input.id,
          aggregateVersion: 1,
          eventType: "payg.enrollment.recorded",
          eventVersion: 1,
          actor: input.actor,
          occurredAt: new Date(input.now),
          requestId: randomUUID(),
          after: snapshot,
        });
      return snapshot;
    });
  }

  public ingestVerifiedReceipt(input: {
    enrollmentId: string;
    receiptId: string;
    verificationEvidenceId: string;
    measurements: readonly PaygMeasurement[];
    closedThrough: string;
    completeCountMeters: readonly ("egress_bytes" | "api_operations")[];
    now: string;
  }): Promise<{ replay: boolean; acceptedMeasurements: number }> {
    if (!input.receiptId.trim() || !input.verificationEvidenceId.trim())
      throw new Error("PAYG_VERIFIED_RECEIPT_REQUIRED");
    const now = paygInstant(input.now);
    if (
      paygInstant(input.closedThrough) > now ||
      input.completeCountMeters.some(
        (meter) => !["egress_bytes", "api_operations"].includes(meter),
      )
    )
      throw new Error("PAYG_SOURCE_COMPLETENESS_INVALID");
    const payloadHash = paygEvidenceHash({
      enrollmentId: input.enrollmentId,
      measurements: input.measurements,
      closedThrough: input.closedThrough,
      completeCountMeters: [...new Set(input.completeCountMeters)].sort(),
    });
    return withInternalTransaction(
      this.database,
      `payg-ingest:${input.receiptId}`,
      async (tx) => {
        const enrollment = await lockedEnrollment(tx, input.enrollmentId);
        const [receipt] = await tx
          .select()
          .from(paygSourceReceipts)
          .where(eq(paygSourceReceipts.receiptId, input.receiptId));
        if (receipt) {
          if (
            receipt.payloadHash !== payloadHash ||
            receipt.enrollmentId !== enrollment.id
          )
            throw new Error("PAYG_RECEIPT_PAYLOAD_CONFLICT");
          return { replay: true, acceptedMeasurements: 0 };
        }
        let acceptedMeasurements = 0;
        for (const event of input.measurements) {
          // Receipt time is local authority. Source timestamps cannot backdate a
          // correction into the automatic correction window.
          validatePaygMeasurement(
            { ...event, recordedAt: input.now },
            enrollment.binding,
          );
          if (
            paygInstant(event.startsAt) < paygInstant(enrollment.startsAt) ||
            (enrollment.endsAt &&
              paygInstant(event.endsAt) > paygInstant(enrollment.endsAt))
          )
            throw new Error("PAYG_MEASUREMENT_OUTSIDE_SERVICE_PERIOD");
          const hash = paygEvidenceHash(event);
          const [prior] = await tx
            .select()
            .from(paygSourceMeasurements)
            .where(
              and(
                eq(paygSourceMeasurements.source, event.source),
                eq(
                  paygSourceMeasurements.sourceMeasurementId,
                  event.sourceMeasurementId,
                ),
              ),
            );
          if (prior) {
            if (
              prior.payloadHash !== hash ||
              prior.enrollmentId !== enrollment.id
            )
              throw new Error("PAYG_SOURCE_ID_PAYLOAD_CONFLICT");
            continue;
          }
          await tx.insert(paygSourceMeasurements).values({
            enrollmentId: enrollment.id,
            source: event.source,
            sourceMeasurementId: event.sourceMeasurementId,
            startsAt: new Date(event.startsAt),
            payload: event,
            payloadHash: hash,
            recordedAt: new Date(input.now),
          });
          acceptedMeasurements += 1;
        }
        await tx.insert(paygSourceReceipts).values({
          receiptId: input.receiptId,
          enrollmentId: enrollment.id,
          payloadHash,
          verificationEvidenceId: input.verificationEvidenceId,
          closedThrough: new Date(input.closedThrough),
          completeCountMeters: [...new Set(input.completeCountMeters)].sort(),
          recordedAt: new Date(input.now),
        });
        return { replay: false, acceptedMeasurements };
      },
    );
  }

  public confirmCancellation(input: {
    actor?: Actor;
    enrollmentId: string;
    serviceEndsAt: string;
    evidenceId: string;
    now: string;
  }): Promise<PaygEnrollmentSnapshot> {
    const end = paygInstant(input.serviceEndsAt);
    if (
      !input.evidenceId.trim() ||
      end % 3_600_000 !== 0 ||
      end > paygInstant(input.now)
    )
      throw new Error("PAYG_CONFIRMED_CANCELLATION_REQUIRED");
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      if (input.actor) await this.verifyAdministrator(tx, input.actor);
      const enrollment = await lockedEnrollment(tx, input.enrollmentId);
      if (enrollment.endsAt) {
        const [retained] = await tx
          .select({ evidenceId: paygEnrollments.cancellationEvidenceId })
          .from(paygEnrollments)
          .where(eq(paygEnrollments.id, enrollment.id));
        if (retained?.evidenceId !== input.evidenceId)
          throw new Error("PAYG_CANCELLATION_REPLAY_CONFLICT");
        if (enrollment.endsAt !== input.serviceEndsAt)
          throw new Error("PAYG_CANCELLATION_REPLAY_CONFLICT");
        return enrollment;
      }
      if (end <= paygInstant(enrollment.startsAt))
        throw new Error("PAYG_SERVICE_PERIOD_INVALID");
      const revisions = await tx
        .select()
        .from(paygPeriodRevisions)
        .where(eq(paygPeriodRevisions.enrollmentId, enrollment.id));
      if (
        revisions.some(
          (row) =>
            paygInstant(
              (row.snapshot as PaygPeriodRevision).rating.period.serviceEndsAt,
            ) > end,
        )
      )
        throw new Error("PAYG_CANCELLATION_PRECEDES_RATED_SERVICE");
      const snapshot = { ...enrollment, endsAt: input.serviceEndsAt };
      await tx
        .update(paygEnrollments)
        .set({ snapshot, cancellationEvidenceId: input.evidenceId })
        .where(eq(paygEnrollments.id, enrollment.id));
      if (input.actor)
        await tx.insert(auditEvents).values({
          accountId: enrollment.binding.accountId,
          aggregateType: "payg_enrollment",
          aggregateId: enrollment.id,
          aggregateVersion: 2,
          eventType: "payg.enrollment.cancellation_confirmed",
          eventVersion: 1,
          actor: input.actor,
          occurredAt: new Date(input.now),
          requestId: randomUUID(),
          before: enrollment,
          after: snapshot,
          metadata: { evidenceId: input.evidenceId },
        });
      return snapshot;
    });
  }

  public transaction<T>(
    enrollmentId: string,
    month: string,
    run: (transaction: PaygBillingTransaction) => Promise<T>,
  ): Promise<T> {
    return withInternalTransaction(
      this.database,
      `payg-close:${enrollmentId}:${month}`,
      async (tx) => {
        const enrollment = await lockedEnrollment(tx, enrollmentId);
        return run({
          enrollment: () => Promise.resolve(enrollment),
          source: async (period, asOf) => {
            const rows = await tx
              .select()
              .from(paygSourceMeasurements)
              .where(
                and(
                  eq(paygSourceMeasurements.enrollmentId, enrollmentId),
                  gte(
                    paygSourceMeasurements.startsAt,
                    new Date(period.serviceStartsAt),
                  ),
                  lt(
                    paygSourceMeasurements.startsAt,
                    new Date(period.serviceEndsAt),
                  ),
                  lte(paygSourceMeasurements.recordedAt, new Date(asOf)),
                ),
              );
            const receipts = await tx
              .select()
              .from(paygSourceReceipts)
              .where(
                and(
                  eq(paygSourceReceipts.enrollmentId, enrollmentId),
                  gte(
                    paygSourceReceipts.closedThrough,
                    new Date(period.serviceEndsAt),
                  ),
                  lte(paygSourceReceipts.recordedAt, new Date(asOf)),
                ),
              )
              .orderBy(desc(paygSourceReceipts.closedThrough));
            if (!receipts.length)
              throw new Error("PAYG_SOURCE_PERIOD_NOT_CLOSED");
            return {
              measurements: rows.map((row) => ({
                ...(row.payload as PaygMeasurement),
                recordedAt: row.recordedAt.toISOString(),
              })),
              closedThrough: receipts
                .reduce(
                  (latest, receipt) =>
                    receipt.closedThrough > latest
                      ? receipt.closedThrough
                      : latest,
                  new Date(0),
                )
                .toISOString(),
              completeCountMeters: [
                ...new Set(
                  receipts.flatMap((receipt) => receipt.completeCountMeters),
                ),
              ] as ("egress_bytes" | "api_operations")[],
            };
          },
          latestRevision: async () => {
            const [row] = await tx
              .select()
              .from(paygPeriodRevisions)
              .where(
                and(
                  eq(paygPeriodRevisions.enrollmentId, enrollmentId),
                  eq(paygPeriodRevisions.month, month),
                ),
              )
              .orderBy(desc(paygPeriodRevisions.revision))
              .limit(1);
            return row?.snapshot as PaygPeriodRevision | undefined;
          },
          appendRevision: async (revision) => {
            await tx.insert(paygPeriodRevisions).values({
              enrollmentId,
              month,
              revision: revision.revision,
              snapshot: revision,
              createdAt: new Date(revision.createdAt),
            });
          },
          enqueueEffect: async (effect) => {
            await tx.insert(paygPendingInvoiceEffects).values({
              idempotencyKey: effect.idempotencyKey,
              enrollmentId,
              payload: effect,
            });
          },
        });
      },
    );
  }

  /** Explicit operator queue. These plans are not represented as issued invoices. */
  public listPendingEffects(): Promise<
    readonly {
      effect: PaygInvoiceEffect;
      rating: PaygPeriodRevision["rating"];
      status: "awaiting_materialization";
    }[]
  > {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const effects = await tx
        .select()
        .from(paygPendingInvoiceEffects)
        .where(
          sql`not exists (select 1 from core_payg_invoice_sources source where source.effect_key = ${paygPendingInvoiceEffects.idempotencyKey}) and not exists (select 1 from core_payg_credit_sources source where source.effect_key = ${paygPendingInvoiceEffects.idempotencyKey})`,
        )
        .orderBy(asc(paygPendingInvoiceEffects.createdAt))
        .limit(200);
      return Promise.all(
        effects.map(async (row) => {
          const effect = row.payload as PaygInvoiceEffect;
          const [revision] = await tx
            .select()
            .from(paygPeriodRevisions)
            .where(
              and(
                eq(paygPeriodRevisions.enrollmentId, row.enrollmentId),
                eq(paygPeriodRevisions.month, effect.month),
                eq(paygPeriodRevisions.revision, effect.revision),
              ),
            );
          if (!revision) throw new Error("PAYG_EFFECT_REVISION_MISSING");
          return {
            effect,
            rating: (revision.snapshot as PaygPeriodRevision).rating,
            status: "awaiting_materialization" as const,
          };
        }),
      );
    });
  }

  /** Recurring scheduler seam: each failed account is reported and can redrive independently. */
  public async closeMonth(input: { month: string; now: string }): Promise<
    readonly {
      enrollmentId: string;
      status: "rated" | "replay" | "blocked";
      reason?: string;
    }[]
  > {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
      throw new Error("PAYG_MONTH_INVALID");
    const monthStart = new Date(`${input.month}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const asOf = paygInstant(input.now);
    const enrollments = await withInternalTransaction(
      this.database,
      randomUUID(),
      (tx) =>
        tx.select().from(paygEnrollments).orderBy(asc(paygEnrollments.id)),
    );
    const results: {
      enrollmentId: string;
      status: "rated" | "replay" | "blocked";
      reason?: string;
    }[] = [];
    for (const row of enrollments) {
      const snapshot = row.snapshot as PaygEnrollmentSnapshot;
      if (
        paygInstant(snapshot.startsAt) >= monthEnd.getTime() ||
        (snapshot.endsAt &&
          paygInstant(snapshot.endsAt) <= monthStart.getTime())
      )
        continue;
      const serviceEnd = snapshot.endsAt
        ? Math.min(paygInstant(snapshot.endsAt), monthEnd.getTime())
        : monthEnd.getTime();
      if (serviceEnd > asOf) continue;
      try {
        const result = await closePaygPeriod({
          repository: this,
          enrollmentId: row.id,
          ...input,
        });
        results.push({
          enrollmentId: row.id,
          status: result.replay ? "replay" : "rated",
        });
      } catch (error) {
        results.push({
          enrollmentId: row.id,
          status: "blocked",
          reason:
            error instanceof Error ? error.message : "PAYG_PERIOD_CLOSE_FAILED",
        });
      }
    }
    return results;
  }
}
