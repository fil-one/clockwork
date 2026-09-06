import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CustomerAcquisitionCommandSchema,
  ResolveAcquisitionCommandSchema,
  PaygOfferRecordSchema,
  customerAcquisitionOffer,
  effectiveCustomerOffers,
  paygEvidenceHash,
  type CustomerAcquisitionCommand,
  type CustomerAcquisitionRequest,
  type CustomerAcquisitionView,
  type ResolveAcquisitionCommand,
  type PaygOfferRecord,
  type TrialEntitlement,
} from "@clockwork/domain/core";
import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  organizations,
  commerceUsers,
  memberships,
} from "../../schema";
import { paygOfferVersions } from "../../schema/core/payg-offers";
import { paygEnrollments } from "../../schema/core/payg-billing";
import { trialClaims } from "../../schema/core/trials";
import { customerAcquisitionRequests as requests } from "../../schema/core/customer-acquisition";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

type Snapshot = {
  offer: CustomerAcquisitionRequest["offer"];
  terms: PaygOfferRecord["terms"];
  command: CustomerAcquisitionCommand;
};
function offerRow(row: typeof paygOfferVersions.$inferSelect): PaygOfferRecord {
  const { sku: _sku, region: _region, version: _version, ...record } = row;
  void _sku;
  void _region;
  void _version;
  return PaygOfferRecordSchema.parse({
    ...record,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
async function customerMembership(
  tx: RuntimeTransaction,
  userId: string,
  accountId: string,
  organizationId?: string,
  write = false,
) {
  const rows = await tx
    .select({ organization: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(organizations.accountId, accountId),
        ...(organizationId ? [eq(organizations.id, organizationId)] : []),
      ),
    )
    .for("share");
  if (
    !rows.length ||
    (write && !rows.some((row) => ["owner", "admin"].includes(row.role)))
  )
    throw new Error("ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED");
  return rows;
}
async function finance(tx: RuntimeTransaction, userId: string) {
  const [row] = await tx
    .select({ id: commerceUsers.id })
    .from(commerceUsers)
    .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
    .where(
      and(
        eq(commerceUsers.id, userId),
        eq(commerceUsers.isInternalStaff, true),
        eq(commerceUsers.mfaEnrolled, true),
        eq(memberships.role, "finance_approver"),
      ),
    )
    .for("share");
  if (!row) throw new Error("ACQUISITION_FINANCE_REQUIRED");
}
async function mapRequest(
  tx: RuntimeTransaction,
  row: typeof requests.$inferSelect,
): Promise<CustomerAcquisitionRequest> {
  const snapshot = row.snapshot as Snapshot;
  const org = await tx.query.organizations.findFirst({
    where: eq(organizations.id, row.organizationId),
  });
  let result: CustomerAcquisitionRequest["result"] = null;
  if (row.trialId) {
    const trialRow = await tx
      .select()
      .from(trialClaims)
      .where(eq(trialClaims.id, row.trialId))
      .then((rows) => rows[0]);
    const trial = trialRow?.snapshot as TrialEntitlement | undefined;
    if (trial)
      result = {
        kind: "trial",
        id: trial.id,
        startsAt: trial.startsAt,
        endsAt: trial.expiresAt,
        convertedAt: trial.convertedAt ?? null,
        billingAuthority: null,
      };
  }
  if (row.enrollmentId) {
    const enrollment = await tx
      .select()
      .from(paygEnrollments)
      .where(eq(paygEnrollments.id, row.enrollmentId))
      .then((rows) => rows[0]);
    const paid = enrollment?.snapshot as
      | { startsAt: string; endsAt?: string; billingAuthority: string }
      | undefined;
    if (paid)
      result = {
        kind: "payg",
        id: row.enrollmentId,
        startsAt: paid.startsAt,
        endsAt: paid.endsAt ?? null,
        convertedAt: null,
        billingAuthority: paid.billingAuthority,
      };
  }
  return {
    id: row.id,
    accountId: row.accountId,
    organizationId: row.organizationId,
    organizationName: org?.name ?? "Organization",
    kind: row.kind as CustomerAcquisitionRequest["kind"],
    status: row.status as CustomerAcquisitionRequest["status"],
    rowVersion: row.rowVersion,
    acceptedAt: row.createdAt.toISOString(),
    offer: snapshot.offer,
    reason:
      snapshot.command.kind === "cancel_payg" ? snapshot.command.reason : "",
    resolutionReason: row.resolutionReason,
    trialId: row.trialId,
    enrollmentId: row.enrollmentId,
    result,
  };
}

/** Customer assent is a durable request. Only separately verified finance records can resolve it. */
export class DatabaseCustomerAcquisitionRepository {
  constructor(private readonly database: RuntimeDatabase) {}
  public list(input: {
    userId: string;
    accountId: string;
    now: string;
  }): Promise<CustomerAcquisitionView> {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      const member = await customerMembership(
        tx,
        input.userId,
        input.accountId,
      );
      const offers = await tx
        .select()
        .from(paygOfferVersions)
        .where(eq(paygOfferVersions.status, "approved"));
      const rows = await tx
        .select()
        .from(requests)
        .where(eq(requests.accountId, input.accountId))
        .orderBy(desc(requests.createdAt))
        .limit(200);
      return {
        offers: effectiveCustomerOffers(offers.map(offerRow), input.now),
        organizations: member.map(({ organization, role }) => ({
          id: organization.id,
          name: organization.name,
          canRequest: ["owner", "admin"].includes(role),
          providerMapped: Boolean(organization.externalProvisioningId),
        })),
        requests: await Promise.all(rows.map((row) => mapRequest(tx, row))),
      };
    });
  }
  public listInternal(userId: string): Promise<CustomerAcquisitionRequest[]> {
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      await finance(tx, userId);
      const rows = await tx
        .select()
        .from(requests)
        .orderBy(desc(requests.createdAt))
        .limit(200);
      return Promise.all(rows.map((row) => mapRequest(tx, row)));
    });
  }
  public request(input: {
    command: CustomerAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    const command = CustomerAcquisitionCommandSchema.parse(input.command);
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      await customerMembership(
        tx,
        input.userId,
        command.accountId,
        command.organizationId,
        true,
      );
      const [account] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, command.accountId))
        .for("share");
      if (
        !account ||
        (account.screeningStatus === "blocked" &&
          command.kind !== "cancel_payg")
      )
        throw new Error("ACQUISITION_ACCOUNT_BLOCKED");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`acquisition:${command.organizationId}`},0))`,
      );
      const requestHash = paygEvidenceHash({ command, userId: input.userId });
      const [prior] = await tx
        .select()
        .from(requests)
        .where(eq(requests.id, command.id));
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new Error("ACQUISITION_REPLAY_CONFLICT");
        return mapRequest(tx, prior);
      }
      let offer: PaygOfferRecord;
      let trialId: string | null = null;
      let enrollmentId: string | null = null;
      if (command.kind === "cancel_payg") {
        const [enrollment] = await tx
          .select()
          .from(paygEnrollments)
          .where(eq(paygEnrollments.id, command.enrollmentId))
          .for("share");
        const org = await tx.query.organizations.findFirst({
          where: eq(organizations.id, command.organizationId),
        });
        const snapshot = enrollment?.snapshot as
          { binding?: { tenantId?: string }; endsAt?: string } | undefined;
        if (
          !enrollment ||
          enrollment.accountId !== command.accountId ||
          !org?.externalProvisioningId ||
          snapshot?.binding?.tenantId !== org.externalProvisioningId ||
          snapshot.endsAt
        )
          throw new Error("ACQUISITION_ENROLLMENT_MISMATCH");
        const [row] = await tx
          .select()
          .from(paygOfferVersions)
          .where(eq(paygOfferVersions.id, enrollment.offerVersionId))
          .for("share");
        if (!row) throw new Error("ACQUISITION_OFFER_UNAVAILABLE");
        offer = offerRow(row);
        enrollmentId = enrollment.id;
      } else {
        const [row] = await tx
          .select()
          .from(paygOfferVersions)
          .where(eq(paygOfferVersions.id, command.offerVersionId))
          .for("share");
        if (!row) throw new Error("ACQUISITION_OFFER_UNAVAILABLE");
        offer = offerRow(row);
        const approved = await tx
          .select()
          .from(paygOfferVersions)
          .where(eq(paygOfferVersions.status, "approved"));
        const current = effectiveCustomerOffers(
          approved.map(offerRow),
          input.now,
        ).find((candidate) => candidate.id === offer.id);
        if (
          !current ||
          row.rowVersion !== command.offerRowVersion ||
          current.fingerprint !== command.offerFingerprint
        )
          throw new Error("ACQUISITION_OFFER_CHANGED");
        if (
          command.kind === "trial"
            ? !current.notices.trialRequestsEnabled
            : !current.notices.paygRequestsEnabled
        )
          throw new Error("ACQUISITION_KIND_UNAVAILABLE");
        if (command.kind === "trial") {
          const [used] = await tx
            .select({ id: trialClaims.id })
            .from(trialClaims)
            .where(eq(trialClaims.organizationId, command.organizationId));
          if (used) throw new Error("ACQUISITION_TRIAL_ALREADY_USED");
        }
        if (command.kind === "convert_to_payg") {
          const [trial] = await tx
            .select()
            .from(trialClaims)
            .where(eq(trialClaims.id, command.trialId))
            .for("share");
          if (
            !trial ||
            trial.accountId !== command.accountId ||
            trial.organizationId !== command.organizationId ||
            (trial.snapshot as TrialEntitlement).convertedAt
          )
            throw new Error("ACQUISITION_TRIAL_MISMATCH");
          trialId = trial.id;
        }
      }
      const publicOffer = customerAcquisitionOffer(offer, {
        includeDisabled: command.kind === "cancel_payg",
      });
      if (!publicOffer) throw new Error("ACQUISITION_OFFER_UNAVAILABLE");
      const pending = await tx
        .select({ id: requests.id, kind: requests.kind })
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, command.organizationId),
            eq(requests.status, "pending"),
          ),
        );
      if (
        pending.some(
          (row) =>
            row.kind === command.kind ||
            (command.kind !== "cancel_payg" && row.kind !== "cancel_payg"),
        )
      )
        throw new Error("ACQUISITION_REQUEST_PENDING");
      const [row] = await tx
        .insert(requests)
        .values({
          id: command.id,
          accountId: command.accountId,
          organizationId: command.organizationId,
          requestedBy: input.userId,
          kind: command.kind,
          offerVersionId: offer.id,
          requestHash,
          snapshot: { offer: publicOffer, terms: offer.terms, command },
          trialId,
          enrollmentId,
          createdAt: new Date(input.now),
          updatedAt: new Date(input.now),
        })
        .returning();
      if (!row) throw new Error("ACQUISITION_SAVE_FAILED");
      await appendAuditAndOutbox(tx, {
        accountId: row.accountId,
        aggregateType: "customer_acquisition",
        aggregateId: row.id,
        aggregateVersion: 1,
        eventType: "customer.acquisition.requested",
        eventVersion: 1,
        actor: { kind: "user", id: input.userId },
        requestId: randomUUID(),
        occurredAt: new Date(input.now),
        after: row.snapshot as Record<string, unknown>,
        metadata: { providerActivated: false, billingActivated: false },
      });
      return mapRequest(tx, row);
    });
  }
  public resolve(input: {
    command: ResolveAcquisitionCommand;
    userId: string;
    now: string;
  }): Promise<CustomerAcquisitionRequest> {
    const command = ResolveAcquisitionCommandSchema.parse(input.command);
    return withInternalTransaction(this.database, randomUUID(), async (tx) => {
      await finance(tx, input.userId);
      const [prior] = await tx
        .select()
        .from(requests)
        .where(eq(requests.id, command.id))
        .for("update");
      if (
        !prior ||
        prior.rowVersion !== command.expectedRowVersion ||
        prior.status !== "pending"
      )
        throw new Error("ACQUISITION_REQUEST_CHANGED");
      let trialId = prior.trialId;
      let enrollmentId = prior.enrollmentId;
      if (command.decision === "fulfilled") {
        const [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, prior.organizationId))
          .for("share");
        if (!org?.externalProvisioningId || org.accountId !== prior.accountId)
          throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
        if (prior.kind === "trial") {
          const [trial] = await tx
            .select()
            .from(trialClaims)
            .where(
              eq(
                trialClaims.id,
                command.trialId ?? "00000000-0000-0000-0000-000000000000",
              ),
            )
            .for("share");
          if (
            !trial ||
            trial.accountId !== prior.accountId ||
            trial.organizationId !== prior.organizationId ||
            trial.offerVersionId !== prior.offerVersionId ||
            Date.parse((trial.snapshot as TrialEntitlement).startsAt) <
              prior.createdAt.getTime() ||
            (trial.snapshot as TrialEntitlement).tenantId !==
              org.externalProvisioningId
          )
            throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
          trialId = trial.id;
        } else {
          const [enrollment] = await tx
            .select()
            .from(paygEnrollments)
            .where(
              eq(
                paygEnrollments.id,
                command.enrollmentId ??
                  prior.enrollmentId ??
                  "00000000-0000-0000-0000-000000000000",
              ),
            )
            .for("share");
          const paid = enrollment?.snapshot as
            | {
                binding?: { tenantId?: string };
                billingAuthority?: string;
                cutoverEvidenceId?: string;
                startsAt?: string;
                endsAt?: string;
              }
            | undefined;
          if (
            !enrollment ||
            enrollment.accountId !== prior.accountId ||
            enrollment.offerVersionId !== prior.offerVersionId ||
            paid?.binding?.tenantId !== org.externalProvisioningId ||
            !paid.startsAt ||
            Date.parse(paid.startsAt) > Date.parse(input.now) ||
            paid.billingAuthority !== "clockwork" ||
            !paid.cutoverEvidenceId ||
            (prior.kind !== "cancel_payg" &&
              Date.parse(paid.startsAt) < prior.createdAt.getTime()) ||
            (prior.kind === "cancel_payg"
              ? !paid.endsAt ||
                Date.parse(paid.endsAt) > Date.parse(input.now) ||
                enrollment.id !== prior.enrollmentId
              : Boolean(paid.endsAt))
          )
            throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
          if (prior.kind === "convert_to_payg") {
            const [trial] = await tx
              .select()
              .from(trialClaims)
              .where(
                eq(
                  trialClaims.id,
                  prior.trialId ?? "00000000-0000-0000-0000-000000000000",
                ),
              )
              .for("share");
            const snapshot = trial?.snapshot as TrialEntitlement | undefined;
            if (
              !trial ||
              trial.accountId !== prior.accountId ||
              trial.organizationId !== prior.organizationId ||
              snapshot?.paidPaygEnrollmentId !== enrollment.id ||
              !snapshot.convertedAt ||
              Date.parse(snapshot.convertedAt) < prior.createdAt.getTime()
            )
              throw new Error("ACQUISITION_VERIFIED_RESULT_REQUIRED");
          }
          enrollmentId = enrollment.id;
        }
      }
      const [row] = await tx
        .update(requests)
        .set({
          status: command.decision,
          resolvedBy: input.userId,
          resolutionReason: command.reason,
          trialId,
          enrollmentId,
          rowVersion: prior.rowVersion + 1,
          updatedAt: new Date(input.now),
        })
        .where(eq(requests.id, prior.id))
        .returning();
      if (!row) throw new Error("ACQUISITION_SAVE_FAILED");
      await appendAuditAndOutbox(tx, {
        accountId: row.accountId,
        aggregateType: "customer_acquisition",
        aggregateId: row.id,
        aggregateVersion: row.rowVersion,
        eventType: `customer.acquisition.${command.decision}`,
        eventVersion: 1,
        actor: { kind: "user", id: input.userId },
        requestId: randomUUID(),
        occurredAt: new Date(input.now),
        before: prior,
        after: row,
      });
      return mapRequest(tx, row);
    });
  }
}
