import { MoneySchema } from "@clockwork/contracts";
import {
  paygEvidenceHash,
  paygInstant,
  paygPeriodBounds,
  ratePaygPeriod,
  type PaygBinding,
  type PaygMeasurement,
  type PaygPeriod,
  type PaygPolicySnapshot,
  type PaygRating,
} from "@clockwork/domain/core";

export interface PaygEnrollmentSnapshot {
  id: string;
  binding: PaygBinding;
  policy: PaygPolicySnapshot;
  startsAt: string;
  /** Confirmed service end, not merely the time a cancellation was requested. */
  endsAt?: string;
  billingAuthority: "fil_one" | "clockwork";
  cutoverEvidenceId?: string;
  supplierLegalEntityId?: string;
  stripeCustomerId?: string;
}

export interface PaygPeriodRevision {
  enrollmentId: string;
  revision: number;
  rating: PaygRating;
  previousEvidenceHash?: string;
  createdAt: string;
}

export interface PaygInvoiceEffect {
  idempotencyKey: string;
  kind: "invoice" | "debit_adjustment" | "credit_adjustment";
  enrollmentId: string;
  accountId: string;
  month: string;
  revision: number;
  /** Positive magnitude. Credit effects never become negative invoice items. */
  amount: PaygRating["total"];
  ratingEvidenceHash: string;
  /** All revisions of one month reconcile against this original billing object. */
  originalInvoiceKey: string;
}

/**
 * A production implementation must lock enrollment + month, enforce unique
 * enrollment/month/revision and effect keys, and commit revision + outbox in
 * one transaction. Source records must be authenticated and durably retained
 * before this boundary. No provider call belongs inside the transaction.
 */
export interface PaygBillingTransaction {
  enrollment(): Promise<PaygEnrollmentSnapshot>;
  source(
    period: PaygPeriod,
    asOf: string,
  ): Promise<{
    measurements: readonly PaygMeasurement[];
    closedThrough: string;
    completeCountMeters?: readonly ("egress_bytes" | "api_operations")[];
  }>;
  latestRevision(): Promise<PaygPeriodRevision | undefined>;
  appendRevision(revision: PaygPeriodRevision): Promise<void>;
  enqueueEffect(effect: PaygInvoiceEffect): Promise<void>;
}

export interface PaygBillingRepository {
  transaction<T>(
    enrollmentId: string,
    month: string,
    run: (transaction: PaygBillingTransaction) => Promise<T>,
  ): Promise<T>;
}

function assertPreviousRevision(
  previous: PaygPeriodRevision,
  enrollment: PaygEnrollmentSnapshot,
  period: PaygPeriod,
): void {
  if (
    previous.enrollmentId !== enrollment.id ||
    !Number.isSafeInteger(previous.revision) ||
    previous.revision < 1 ||
    paygEvidenceHash(previous.rating.binding) !==
      paygEvidenceHash(enrollment.binding) ||
    paygEvidenceHash(previous.rating.policy) !==
      paygEvidenceHash(enrollment.policy) ||
    paygEvidenceHash(previous.rating.period) !== paygEvidenceHash(period)
  )
    throw new Error("PAYG_CONTRACT_SNAPSHOT_CHANGED");
}

/**
 * Rates complete closed periods from the retained source ledger. Replaying an
 * unchanged period does nothing; corrections append evidence and emit only the
 * difference against the last revision, including a credit when appropriate.
 * This workflow intentionally has no scheduler or production activation until
 * a verified Fil One boundary and approved billing cutover are installed.
 */
export async function closePaygPeriod(input: {
  repository: PaygBillingRepository;
  enrollmentId: string;
  month: string;
  now: string;
}): Promise<{
  revision: PaygPeriodRevision;
  replay: boolean;
  effect?: PaygInvoiceEffect;
}> {
  const now = paygInstant(input.now);
  return input.repository.transaction(
    input.enrollmentId,
    input.month,
    async (transaction) => {
      const enrollment = await transaction.enrollment();
      if (enrollment.id !== input.enrollmentId)
        throw new Error("PAYG_ENROLLMENT_BINDING_MISMATCH");
      if (
        enrollment.billingAuthority !== "clockwork" ||
        !enrollment.cutoverEvidenceId?.trim()
      )
        throw new Error("PAYG_BILLING_AUTHORITY_NOT_TRANSFERRED");
      // Validate the month before using its value to construct calendar dates.
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
        throw new Error("PAYG_MONTH_INVALID");
      const monthStart = Date.parse(`${input.month}-01T00:00:00.000Z`);
      const next = new Date(monthStart);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const monthEnd = next.getTime();
      const confirmedEnd =
        enrollment.endsAt === undefined
          ? undefined
          : paygInstant(enrollment.endsAt);
      const period: PaygPeriod = {
        month: input.month,
        serviceStartsAt: new Date(
          Math.max(monthStart, paygInstant(enrollment.startsAt)),
        ).toISOString(),
        serviceEndsAt: new Date(
          Math.min(monthEnd, confirmedEnd ?? monthEnd),
        ).toISOString(),
        final: confirmedEnd !== undefined && confirmedEnd <= monthEnd,
      };
      const bounds = paygPeriodBounds(period);
      if (now < bounds.endsAt) throw new Error("PAYG_PERIOD_NOT_ENDED");
      const source = await transaction.source(period, input.now);
      if (paygInstant(source.closedThrough) > now)
        throw new Error("PAYG_FUTURE_SOURCE_WATERMARK");
      if (
        source.measurements.some((event) => paygInstant(event.recordedAt) > now)
      )
        throw new Error("PAYG_FUTURE_RECORDED_MEASUREMENT");
      const rating = ratePaygPeriod({
        binding: enrollment.binding,
        policy: enrollment.policy,
        period,
        measurements: source.measurements,
        sourceClosedThrough: source.closedThrough,
        ...(source.completeCountMeters
          ? { sourceCompleteCountMeters: source.completeCountMeters }
          : {}),
      });
      const previous = await transaction.latestRevision();
      if (previous) {
        assertPreviousRevision(previous, enrollment, period);
        const fingerprints = new Map(
          rating.sourceMeasurementFingerprints.map((entry) => [
            entry.id,
            entry.hash,
          ]),
        );
        if (
          previous.rating.sourceMeasurementFingerprints.some(
            (entry) => fingerprints.get(entry.id) !== entry.hash,
          )
        )
          throw new Error("PAYG_RETAINED_SOURCE_HISTORY_CHANGED");
        if (previous.rating.evidenceHash === rating.evidenceHash)
          return { revision: previous, replay: true };
      }
      const revision: PaygPeriodRevision = {
        enrollmentId: enrollment.id,
        revision: (previous?.revision ?? 0) + 1,
        rating,
        ...(previous
          ? { previousEvidenceHash: previous.rating.evidenceHash }
          : {}),
        createdAt: input.now,
      };
      const delta =
        BigInt(rating.total.minor) -
        BigInt(previous?.rating.total.minor ?? "0");
      const originalInvoiceKey = `payg:${paygEvidenceHash({ enrollmentId: enrollment.id, month: input.month })}:invoice`;
      const effect: PaygInvoiceEffect | undefined =
        !previous || delta !== 0n
          ? {
              idempotencyKey: previous
                ? `${originalInvoiceKey}:revision:${revision.revision}`
                : originalInvoiceKey,
              originalInvoiceKey,
              kind: previous
                ? delta < 0n
                  ? "credit_adjustment"
                  : "debit_adjustment"
                : "invoice",
              enrollmentId: enrollment.id,
              accountId: enrollment.binding.accountId,
              month: input.month,
              revision: revision.revision,
              amount: MoneySchema.parse({
                ...rating.total,
                minor: (delta < 0n ? -delta : delta).toString(),
              }),
              ratingEvidenceHash: rating.evidenceHash,
            }
          : undefined;
      await transaction.appendRevision(revision);
      if (effect) await transaction.enqueueEffect(effect);
      return { revision, replay: false, ...(effect ? { effect } : {}) };
    },
  );
}
