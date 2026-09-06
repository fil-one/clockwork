import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Actor } from "@clockwork/contracts";
import {
  convertTrial,
  enrollTrial,
  evaluateTrialOperation,
  paygEvidenceHash,
  paygInstant,
  type TrialCounters,
  type TrialEntitlement,
  type TrialPolicySnapshot,
} from "@clockwork/domain/core";
import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  entitlements,
  memberships,
  organizations,
  orders,
} from "../../schema";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { paygEnrollments } from "../../schema/core/payg-billing";
import { paygOfferVersions } from "../../schema/core/payg-offers";
import {
  trialClaims,
  trialCounterReceipts,
  trialReservations,
  trialReservationSettlements,
} from "../../schema/core/trials";
import { withInternalTransaction } from "../../transaction";

type Operation = Parameters<typeof evaluateTrialOperation>[0]["operation"];
interface Settlement {
  reservationId: string;
  outcome: "completed" | "rejected";
  actualBytes: string;
}
function bytes(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 38)
    throw new Error("TRIAL_COUNTER_INVALID");
  return BigInt(value);
}
const OperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("write"),
      additionalBytes: z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .max(38),
    })
    .strict(),
  z
    .object({
      kind: z.literal("egress"),
      bytes: z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .max(38),
    })
    .strict(),
  z.object({ kind: z.literal("api") }).strict(),
]);
function operationBytes(operation: Operation): bigint {
  OperationSchema.parse(operation);
  return operation.kind === "write"
    ? bytes(operation.additionalBytes)
    : operation.kind === "egress"
      ? bytes(operation.bytes)
      : 0n;
}
async function requireFinance(tx: RuntimeTransaction, actor: Actor) {
  if (
    actor.kind !== "user" ||
    actor.effectiveUserId ||
    actor.impersonatedAccountId
  )
    throw new Error("TRIAL_FINANCE_ACTOR_REQUIRED");
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
  if (!staff) throw new Error("TRIAL_FINANCE_AUTHORITY_REQUIRED");
}
async function lockedTrial(tx: RuntimeTransaction, id: string) {
  const [row] = await tx
    .select()
    .from(trialClaims)
    .where(eq(trialClaims.id, id))
    .for("update");
  if (!row) throw new Error("TRIAL_NOT_FOUND");
  return { row, trial: row.snapshot as TrialEntitlement };
}

/** Persisted authorization boundary; no method invents provider signature verification. */
export class DatabaseTrialRepository {
  public constructor(private readonly database: RuntimeDatabase) {}
  public list() {
    return withInternalTransaction(this.database, randomUUID(), async (tx) =>
      (
        await tx
          .select()
          .from(trialClaims)
          .orderBy(desc(trialClaims.createdAt))
          .limit(200)
      ).map((row) => ({
        accountId: row.accountId,
        trial: row.snapshot as TrialEntitlement,
      })),
    );
  }

  public claim(input: {
    id: string;
    organizationId: string;
    offerVersionId: string;
    verificationEvidenceId: string;
    actor: Actor;
    now: string;
  }) {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      await requireFinance(tx, input.actor);
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .for("update");
      if (!organization?.externalProvisioningId)
        throw new Error("TRIAL_VERIFIED_TENANT_REQUIRED");
      const [account] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, organization.accountId))
        .for("share");
      const [offer] = await tx
        .select()
        .from(paygOfferVersions)
        .where(eq(paygOfferVersions.id, input.offerVersionId))
        .for("share");
      if (!account || !offer) throw new Error("TRIAL_APPROVED_POLICY_REQUIRED");
      const [existing] = await tx
        .select()
        .from(trialClaims)
        .where(eq(trialClaims.organizationId, organization.id));
      if (existing) {
        if (
          existing.id !== input.id ||
          existing.offerVersionId !== input.offerVersionId ||
          existing.verificationEvidenceId !== input.verificationEvidenceId
        )
          throw new Error("TRIAL_ALREADY_USED");
        return existing.snapshot as TrialEntitlement;
      }
      if (offer.status !== "approved" || !offer.approvalEvidenceId)
        throw new Error("TRIAL_APPROVED_POLICY_REQUIRED");
      const [kind, evidenceId] = input.verificationEvidenceId.split(":");
      if (!evidenceId)
        throw new Error("TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED");
      let verifiedDomain: string | undefined;
      if (kind === "registration") {
        const [event] = await tx
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.id, evidenceId),
              eq(auditEvents.accountId, account.id),
              eq(auditEvents.eventType, "account.registered"),
            ),
          );
        const evidence = event?.after as
          | {
              verifiedDomain?: string;
              organizationId?: string;
              domainVerifiedAt?: string;
            }
          | undefined;
        if (
          evidence?.organizationId === organization.id &&
          evidence.domainVerifiedAt &&
          paygInstant(evidence.domainVerifiedAt) <= paygInstant(input.now)
        )
          verifiedDomain = evidence.verifiedDomain;
      } else if (kind === "dns") {
        const [domain] = await tx
          .select()
          .from(lifecyclePartnerDomains)
          .where(
            and(
              eq(lifecyclePartnerDomains.id, evidenceId),
              eq(lifecyclePartnerDomains.accountId, account.id),
            ),
          );
        if (domain && domain.verifiedAt.getTime() <= paygInstant(input.now))
          verifiedDomain = domain.domain;
      }
      if (!verifiedDomain || verifiedDomain !== account.domain.toLowerCase())
        throw new Error("TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED");
      const terms = offer.terms as {
        effectiveFrom: string;
        trial: Omit<
          TrialPolicySnapshot,
          "id" | "version" | "approvalEvidenceId"
        >;
      };
      if (terms.effectiveFrom > input.now.slice(0, 10))
        throw new Error("TRIAL_POLICY_NOT_EFFECTIVE");
      const previous = await tx
        .select({
          organizationId: trialClaims.organizationId,
          verifiedDomain: trialClaims.verifiedDomain,
        })
        .from(trialClaims)
        .where(eq(trialClaims.verifiedDomain, verifiedDomain));
      const trial = enrollTrial({
        id: input.id,
        organizationId: organization.id,
        tenantId: organization.externalProvisioningId,
        domain: verifiedDomain,
        domainVerificationEvidenceId: input.verificationEvidenceId,
        previousTrials: previous,
        policy: {
          ...terms.trial,
          id: offer.id,
          version: offer.version,
          approvalEvidenceId: offer.approvalEvidenceId,
        },
        now: input.now,
      });
      await tx.insert(trialClaims).values({
        id: trial.id,
        accountId: account.id,
        organizationId: organization.id,
        verifiedDomain,
        offerVersionId: offer.id,
        verificationEvidenceId: input.verificationEvidenceId,
        snapshot: trial,
        createdAt: new Date(input.now),
      });
      await tx.insert(auditEvents).values({
        accountId: account.id,
        aggregateType: "trial",
        aggregateId: trial.id,
        aggregateVersion: 1,
        eventType: "trial.claimed",
        eventVersion: 1,
        actor: input.actor,
        requestId: randomUUID(),
        occurredAt: new Date(input.now),
        after: trial,
      });
      return trial;
    });
  }

  /** Caller verifies provider signature and maps completion IDs before calling. */
  public ingestVerifiedCounters(input: {
    trialId: string;
    receiptId: string;
    verificationEvidenceId: string;
    counters: TrialCounters;
    settlements: readonly Settlement[];
    now: string;
  }) {
    const now = paygInstant(input.now);
    const measured = paygInstant(input.counters.measuredAt);
    bytes(input.counters.storedBytes);
    bytes(input.counters.cumulativeEgressBytes);
    if (
      measured > now ||
      !input.verificationEvidenceId.trim() ||
      !input.receiptId.trim()
    )
      throw new Error("TRIAL_VERIFIED_COUNTERS_REQUIRED");
    const payloadHash = paygEvidenceHash({
      trialId: input.trialId,
      counters: input.counters,
      settlements: input.settlements,
    });
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const { trial } = await lockedTrial(tx, input.trialId);
      if (
        trial.organizationId !== input.counters.organizationId ||
        trial.tenantId !== input.counters.tenantId ||
        measured < paygInstant(trial.startsAt)
      )
        throw new Error("TRIAL_COUNTER_BINDING_MISMATCH");
      const [replay] = await tx
        .select()
        .from(trialCounterReceipts)
        .where(eq(trialCounterReceipts.id, input.receiptId));
      if (replay) {
        if (replay.trialId !== trial.id || replay.payloadHash !== payloadHash)
          throw new Error("TRIAL_RECEIPT_CONFLICT");
        return { replay: true };
      }
      const [latest] = await tx
        .select()
        .from(trialCounterReceipts)
        .where(eq(trialCounterReceipts.trialId, trial.id))
        .orderBy(desc(trialCounterReceipts.measuredAt))
        .limit(1);
      if (
        latest &&
        (measured <= latest.measuredAt.getTime() ||
          bytes(input.counters.cumulativeEgressBytes) <
            bytes((latest.counters as TrialCounters).cumulativeEgressBytes))
      )
        throw new Error("TRIAL_COUNTER_WATERMARK_REGRESSION");
      await tx.insert(trialCounterReceipts).values({
        id: input.receiptId,
        trialId: trial.id,
        payloadHash,
        payload: {
          trialId: input.trialId,
          counters: input.counters,
          settlements: input.settlements,
        },
        verificationEvidenceId: input.verificationEvidenceId,
        counters: input.counters,
        measuredAt: new Date(measured),
        recordedAt: new Date(now),
      });
      for (const settlement of input.settlements) {
        const [reservation] = await tx
          .select()
          .from(trialReservations)
          .where(eq(trialReservations.id, settlement.reservationId));
        if (
          !reservation ||
          reservation.trialId !== trial.id ||
          reservation.authorizedAt.getTime() > measured ||
          bytes(settlement.actualBytes) >
            operationBytes(reservation.operation as Operation) ||
          (settlement.outcome === "rejected" && settlement.actualBytes !== "0")
        )
          throw new Error("TRIAL_SETTLEMENT_BINDING_INVALID");
        const [prior] = await tx
          .select()
          .from(trialReservationSettlements)
          .where(
            eq(
              trialReservationSettlements.reservationId,
              settlement.reservationId,
            ),
          );
        if (prior) {
          if (
            prior.outcome !== settlement.outcome ||
            prior.actualBytes !== settlement.actualBytes
          )
            throw new Error("TRIAL_SETTLEMENT_CONFLICT");
          continue;
        }
        await tx
          .insert(trialReservationSettlements)
          .values({ ...settlement, receiptId: input.receiptId });
      }
      const settled = await tx
        .select({
          settlement: trialReservationSettlements,
          operation: trialReservations.operation,
        })
        .from(trialReservationSettlements)
        .innerJoin(
          trialReservations,
          eq(trialReservations.id, trialReservationSettlements.reservationId),
        )
        .where(eq(trialReservations.trialId, trial.id));
      const observedEgress = settled.reduce(
        (sum, row) =>
          (row.operation as Operation).kind === "egress"
            ? sum + bytes(row.settlement.actualBytes)
            : sum,
        0n,
      );
      if (bytes(input.counters.cumulativeEgressBytes) < observedEgress)
        throw new Error("TRIAL_EGRESS_BELOW_CONFIRMED_OPERATIONS");
      return { replay: false };
    });
  }

  /** Must run before the provider operation; provider must honor idempotency and validUntil. */
  public reserve(input: {
    trialId: string;
    reservationId: string;
    organizationId: string;
    tenantId: string;
    operation: Operation;
    now: string;
  }) {
    operationBytes(input.operation);
    const now = paygInstant(input.now);
    if (!input.reservationId.trim())
      return Promise.reject(new Error("TRIAL_RESERVATION_ID_REQUIRED"));
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const { row, trial } = await lockedTrial(tx, input.trialId);
      const [account] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, row.accountId))
        .for("share");
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, trial.organizationId))
        .for("share");
      if (
        !account ||
        organization?.accountId !== row.accountId ||
        organization.externalProvisioningId !== trial.tenantId
      )
        throw new Error("TRIAL_OPERATION_BINDING_MISMATCH");
      if (account.screeningStatus === "blocked")
        return { allowed: false, reason: "account_blocked" as const };

      if (
        trial.organizationId !== input.organizationId ||
        trial.tenantId !== input.tenantId
      )
        throw new Error("TRIAL_OPERATION_BINDING_MISMATCH");
      if (trial.convertedAt && paygInstant(trial.convertedAt) <= now)
        return { allowed: false, reason: "converted" as const };
      const [existing] = await tx
        .select()
        .from(trialReservations)
        .where(eq(trialReservations.id, input.reservationId));
      if (
        existing &&
        (existing.trialId !== trial.id ||
          paygEvidenceHash(existing.operation) !==
            paygEvidenceHash(input.operation))
      )
        throw new Error("TRIAL_RESERVATION_REPLAY_CONFLICT");
      const [settled] = await tx
        .select()
        .from(trialReservationSettlements)
        .where(
          eq(trialReservationSettlements.reservationId, input.reservationId),
        );
      if (settled)
        return { allowed: false, reason: "already_settled" as const };
      const [latest] = await tx
        .select()
        .from(trialCounterReceipts)
        .where(eq(trialCounterReceipts.trialId, trial.id))
        .orderBy(desc(trialCounterReceipts.measuredAt))
        .limit(1);
      if (!latest || latest.recordedAt.getTime() > now)
        return { allowed: false, reason: "stale_usage" as const };
      const pending = await tx
        .select({
          id: trialReservations.id,
          operation: trialReservations.operation,
        })
        .from(trialReservations)
        .leftJoin(
          trialReservationSettlements,
          eq(trialReservationSettlements.reservationId, trialReservations.id),
        )
        .where(
          and(
            eq(trialReservations.trialId, trial.id),
            isNull(trialReservationSettlements.reservationId),
          ),
        );
      const counters = structuredClone(latest.counters as TrialCounters);
      for (const held of pending) {
        if (held.id === input.reservationId) continue;
        const operation = held.operation as Operation;
        if (operation.kind === "write")
          counters.storedBytes = (
            bytes(counters.storedBytes) + bytes(operation.additionalBytes)
          ).toString();
        if (operation.kind === "egress")
          counters.cumulativeEgressBytes = (
            bytes(counters.cumulativeEgressBytes) + bytes(operation.bytes)
          ).toString();
      }
      const decision = evaluateTrialOperation({
        trial,
        counters,
        operation: input.operation,
        now: input.now,
      });
      if (!decision.allowed) return decision;
      const policyDeadline =
        paygInstant(trial.expiresAt) +
        (input.operation.kind === "write"
          ? 0
          : trial.policy.gracePeriodDays * 86_400_000);
      if (
        Math.min(
          latest.measuredAt.getTime() +
            trial.policy.maximumCounterAgeSeconds * 1000,
          policyDeadline,
        ) <= now
      )
        return { allowed: false, reason: "stale_usage" as const };
      if (!existing)
        await tx.insert(trialReservations).values({
          id: input.reservationId,
          trialId: trial.id,
          operation: input.operation,
          authorizedAt: new Date(now),
          counterReceiptId: latest.id,
        });
      return {
        ...decision,
        reservationId: input.reservationId,
        validUntil: new Date(
          Math.min(
            latest.measuredAt.getTime() +
              trial.policy.maximumCounterAgeSeconds * 1000,
            policyDeadline,
          ),
        ).toISOString(),
        replay: Boolean(existing),
      };
    });
  }

  public convert(input: {
    trialId: string;
    entitlementId?: string;
    paygEnrollmentId?: string;
    actor: Actor;
    now: string;
  }) {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      await requireFinance(tx, input.actor);
      const { row, trial } = await lockedTrial(tx, input.trialId);
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, trial.organizationId))
        .for("share");
      if (
        organization?.accountId !== row.accountId ||
        organization.externalProvisioningId !== trial.tenantId
      )
        throw new Error("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
      if (trial.convertedAt) {
        if (
          (input.paygEnrollmentId &&
            input.paygEnrollmentId === trial.paidPaygEnrollmentId &&
            !input.entitlementId) ||
          (input.entitlementId &&
            input.entitlementId === trial.paidEntitlementId &&
            !input.paygEnrollmentId &&
            trial.paidOrderId)
        )
          return trial;
        throw new Error("TRIAL_ALREADY_CONVERTED");
      }
      if (Boolean(input.entitlementId) === Boolean(input.paygEnrollmentId))
        throw new Error("TRIAL_PAID_BINDING_REQUIRED");
      let paid: Parameters<typeof convertTrial>[0]["paid"];
      if (input.entitlementId) {
        const [paidEntitlement] = await tx
          .select()
          .from(entitlements)
          .where(eq(entitlements.id, input.entitlementId))
          .for("share");
        if (
          !paidEntitlement ||
          paidEntitlement.organizationId !== trial.organizationId ||
          paidEntitlement.status !== "active" ||
          !paidEntitlement.activatedAt ||
          !paidEntitlement.provisionedResourceId ||
          paidEntitlement.activatedAt.getTime() > paygInstant(input.now)
        )
          throw new Error("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, paidEntitlement.orderId))
          .for("share");
        if (
          !order ||
          order.accountId !== row.accountId ||
          order.status !== "active"
        )
          throw new Error("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
        paid = {
          entitlementId: paidEntitlement.id,
          organizationId: trial.organizationId,
          tenantId: trial.tenantId,
          status: "active",
          acceptedOrderId: order.id,
          provisioningEvidenceId: `entitlement:${paidEntitlement.id}:${paidEntitlement.rowVersion}`,
        };
      } else {
        const [enrollment] = await tx
          .select()
          .from(paygEnrollments)
          .where(eq(paygEnrollments.id, input.paygEnrollmentId ?? ""))
          .for("share");
        const snapshot = enrollment?.snapshot as
          | {
              binding?: { tenantId: string; entitlementId: string };
              billingAuthority?: string;
              cutoverEvidenceId?: string;
              startsAt?: string;
              endsAt?: string;
            }
          | undefined;
        if (
          !enrollment ||
          enrollment.accountId !== row.accountId ||
          snapshot?.binding?.tenantId !== trial.tenantId ||
          snapshot.billingAuthority !== "clockwork" ||
          !snapshot.cutoverEvidenceId ||
          !snapshot.startsAt ||
          paygInstant(snapshot.startsAt) > paygInstant(input.now) ||
          snapshot.endsAt
        )
          throw new Error("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
        paid = {
          entitlementId: snapshot.binding.entitlementId,
          organizationId: trial.organizationId,
          tenantId: trial.tenantId,
          status: "active",
          paygEnrollmentId: enrollment.id,
          provisioningEvidenceId: enrollment.bindingEvidenceId,
        };
      }
      const converted = convertTrial({ trial, paid, now: input.now });
      if (trial.convertedAt) return converted;
      await tx
        .update(trialClaims)
        .set({ snapshot: converted })
        .where(eq(trialClaims.id, trial.id));
      await tx.insert(auditEvents).values({
        accountId: row.accountId,
        aggregateType: "trial",
        aggregateId: trial.id,
        aggregateVersion: 2,
        eventType: "trial.converted",
        eventVersion: 1,
        actor: input.actor,
        requestId: randomUUID(),
        occurredAt: new Date(input.now),
        before: trial,
        after: converted,
      });
      return converted;
    });
  }
}
