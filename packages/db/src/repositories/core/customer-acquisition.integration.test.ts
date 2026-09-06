import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  PaygOfferTermsSchema,
  type PaygOfferRecord,
  paygEvidenceHash,
} from "@clockwork/domain/core";
import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import {
  accounts,
  organizations,
  commerceUsers,
  memberships,
  auditEvents,
  outboxMessages,
} from "../../schema";
import { customerAcquisitionRequests } from "../../schema/core/customer-acquisition";
import { paygEnrollments } from "../../schema/core/payg-billing";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { DatabasePaygOfferRepository } from "./payg-offers";
import { DatabaseTrialRepository } from "./trials";
import { DatabaseCustomerAcquisitionRepository } from "./customer-acquisition";
const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCustomerAcquisitionRepository(db),
  policies = new DatabasePaygOfferRepository(db),
  trials = new DatabaseTrialRepository(db);
const run = randomUUID(),
  accountId = randomUUID(),
  organizationId = randomUUID(),
  owner = randomUUID(),
  creator = randomUUID(),
  approver = randomUUID(),
  domainId = randomUUID();
const tenantId = `acquisition-${run}`,
  now = "2026-09-01T06:00:00.000Z";
let offer: PaygOfferRecord;
let trialId: string;
let paidId: string;
beforeAll(async () => {
  await withInternalTransaction(db, randomUUID(), async (tx) => {
    const [template] = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.id, "10000000-0000-4000-8000-000000000001"));
    if (!template) throw new Error("Missing account fixture");
    await tx.insert(accounts).values({
      ...template,
      id: accountId,
      legalName: `Acquisition ${run}`,
      domain: `${run}.test`,
      stripeCustomerId: `cus_acquisition_${run}`,
    });
    await tx.insert(organizations).values({
      id: organizationId,
      accountId,
      name: `Acquisition ${run}`,
      externalProvisioningId: tenantId,
    });
    await tx.insert(lifecyclePartnerDomains).values({
      id: domainId,
      accountId,
      domain: `${run}.test`,
      verificationTokenHash: "a".repeat(64),
      verifiedAt: new Date(now),
      brandName: "Verified fixture",
      logoUrl: null,
      primaryColor: "#123456",
      communicationOwner: "fil_one",
    });
    for (const id of [owner, creator, approver]) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `acquisition-${id}`,
        email: `${id}@clockwork.test`,
        name: "Acquisition fixture",
        isInternalStaff: id !== owner,
        mfaEnrolled: true,
      });
      await tx.insert(memberships).values({
        userId: id,
        organizationId:
          id === owner
            ? organizationId
            : "30000000-0000-4000-8000-000000000008",
        role: id === owner ? "owner" : "finance_approver",
      });
    }
  });
  const reference = {
    documentId: "test-terms",
    version: "1",
    uri: "https://example.test/terms",
    sha256: "a".repeat(64),
  };
  const terms = PaygOfferTermsSchema.parse({
    name: `Acquisition ${run}`,
    sku: `ACQ-${run}`,
    region: "test",
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://example.test/evidence",
    sourceCheckedAt: now,
    sourceDocumentId: "fixture",
    owner: "Finance",
    customerAcquisition: {
      paygRequestsEnabled: true,
      trialRequestsEnabled: true,
      serviceNotice: "Service requires separately verified provider handoff.",
      cancellationNotice:
        "Cancellation requires a confirmed provider service end.",
      trialNotice:
        "A trial requires verified lifetime organization eligibility.",
      terms: reference,
      retention: { ...reference, documentId: "retention" },
    },
    payg: {
      currency: "USD",
      storageTbMonthMinor: "499",
      monthlyMinimumMinor: "499",
      partialMonthMinimum: "full",
      correctionWindowDays: 30,
      aggregation: "hourly_average_daily_utc",
      egressRateMinor: "0",
      apiRateMinor: "0",
      stripeTaxCode: "txcd_demo",
      qboIncomeAccount: "4000",
    },
    trial: {
      durationDays: 30,
      gracePeriodDays: 7,
      storageLimitBytes: "1000000000000",
      cumulativeEgressLimitBytes: "2000000000000",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  });
  offer = await policies.command({
    command: { action: "create", terms },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now,
  });
  offer = await policies.command({
    command: {
      action: "propose",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Propose test qualification",
    },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now,
  });
  offer = await policies.command({
    command: {
      action: "approve",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Approve test qualification",
      approvalEvidenceId: "verified-test-policy",
    },
    actor: { kind: "user", id: approver },
    requestId: randomUUID(),
    now,
  });
});
afterAll(() => client.end());
async function consent(
  kind: "payg" | "trial" | "convert_to_payg",
  id = randomUUID(),
) {
  const view = await repository.list({ userId: owner, accountId, now });
  const publicOffer = view.offers.find((row) => row.id === offer.id);
  if (!publicOffer) throw new Error("Missing customer offer fixture");
  const common = {
    id,
    accountId,
    organizationId,
    offerVersionId: offer.id,
    offerRowVersion: offer.rowVersion,
    offerFingerprint: publicOffer.fingerprint,
    acceptedTerms: true as const,
  };
  return kind === "convert_to_payg"
    ? { ...common, kind, trialId }
    : { ...common, kind };
}

async function enrollment(startsAt: string) {
  const id = randomUUID();
  const snapshot = {
    id,
    binding: {
      mappingVersionId: "mapping",
      accountId,
      filOneOrganizationId: organizationId,
      tenantId,
      entitlementId: `paid-${id}`,
      sku: offer.terms.sku,
      region: offer.terms.region,
      source: "acquisition-fixture",
      meters: ["storage_bytes", "egress_bytes", "api_operations"],
      status: "active",
    },
    policy: {
      ...offer.terms.payg,
      id: offer.id,
      version: offer.terms.version,
      approvalEvidenceId: offer.approvalEvidenceId,
    },
    startsAt,
    billingAuthority: "clockwork",
    cutoverEvidenceId: "verified-cutover",
    supplierLegalEntityId: "97000000-0000-4000-8000-000000000002",
    stripeCustomerId: `cus_acquisition_${run}`,
  };
  await withInternalTransaction(db, randomUUID(), (tx) =>
    tx.insert(paygEnrollments).values({
      id,
      accountId,
      offerVersionId: offer.id,
      source: "acquisition-fixture",
      sourceEntitlementId: `paid-${id}`,
      bindingEvidenceId: "verified-provider",
      snapshot,
    }),
  );
  return { id, snapshot };
}
describe.sequential("customer assent and verified service handoff", () => {
  it("retains exact assent, rejects cross-account/stale requests, and requires verified trial proof", async () => {
    const command = await consent("trial");
    await expect(
      repository.request({
        command: { ...command, accountId: randomUUID() },
        userId: owner,
        now,
      }),
    ).rejects.toThrow("ACCOUNT_AUTHORITY");
    await expect(
      repository.request({
        command: { ...command, offerFingerprint: "a".repeat(64) },
        userId: owner,
        now,
      }),
    ).rejects.toThrow("OFFER_CHANGED");
    const saved = await repository.request({
      command: command,
      userId: owner,
      now,
    });
    expect(saved.status).toBe("pending");
    expect(saved.result).toBeNull();
    expect(
      await repository.request({
        command: command,
        userId: owner,
        now,
      }),
    ).toEqual(saved);
    await expect(
      repository.resolve({
        command: {
          id: saved.id,
          expectedRowVersion: 1,
          decision: "fulfilled",
          reason: "Try fabricated trial proof",
          trialId: randomUUID(),
        },
        userId: approver,
        now,
      }),
    ).rejects.toThrow("VERIFIED_RESULT");
    const [source] = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select()
        .from(customerAcquisitionRequests)
        .where(eq(customerAcquisitionRequests.id, saved.id)),
    );
    if (!source) throw new Error("Missing request");
    const tamperedId = randomUUID();
    const snapshot = structuredClone(source.snapshot) as {
      offer: { monthlyMinimumMinor: string };
      command: Record<string, unknown>;
    };
    snapshot.command.id = tamperedId;
    snapshot.offer.monthlyMinimumMinor = "0";
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx.insert(customerAcquisitionRequests).values({
          ...source,
          id: tamperedId,
          requestHash: paygEvidenceHash({
            command: snapshot.command,
            userId: owner,
          }),
          snapshot,
        }),
      ),
    ).rejects.toThrow();
    trialId = randomUUID();
    await trials.claim({
      id: trialId,
      organizationId,
      offerVersionId: offer.id,
      verificationEvidenceId: `dns:${domainId}`,
      actor: { kind: "user", id: approver },
      now,
    });
    const resolved = await repository.resolve({
      command: {
        id: saved.id,
        expectedRowVersion: 1,
        decision: "fulfilled",
        reason: "Verified trial claim recorded",
        trialId,
      },
      userId: approver,
      now,
    });
    expect(resolved.result?.id).toBe(trialId);
    const deliveries = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select({
          eventType: auditEvents.eventType,
          aggregateType: auditEvents.aggregateType,
          aggregateVersion: auditEvents.aggregateVersion,
          actor: auditEvents.actor,
          topic: outboxMessages.topic,
          payload: outboxMessages.payload,
        })
        .from(auditEvents)
        .innerJoin(outboxMessages, eq(outboxMessages.eventId, auditEvents.id))
        .where(eq(auditEvents.aggregateId, saved.id))
        .orderBy(auditEvents.aggregateVersion),
    );
    // The replay and rejected resolution create no extra delivery records.
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toMatchObject([
      {
        eventType: "customer.acquisition.requested",
        aggregateType: "customer_acquisition",
        aggregateVersion: 1,
        actor: { kind: "user", id: owner },
        topic: "customer.acquisition.requested",
        payload: {
          aggregateId: saved.id,
          aggregateVersion: 1,
          data: source.snapshot,
        },
      },
      {
        eventType: "customer.acquisition.fulfilled",
        aggregateType: "customer_acquisition",
        aggregateVersion: 2,
        actor: { kind: "user", id: approver },
        topic: "customer.acquisition.fulfilled",
        payload: {
          aggregateId: saved.id,
          aggregateVersion: 2,
          data: { status: "fulfilled", trialId },
        },
      },
    ]);
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx
          .update(customerAcquisitionRequests)
          .set({ snapshot: {} })
          .where(eq(customerAcquisitionRequests.id, saved.id)),
      ),
    ).rejects.toThrow();
  });
  it("refuses backdated authorization and requires the confirmed paid conversion", async () => {
    const requestAt = "2026-09-01T08:00:00.000Z";
    const command = await consent("convert_to_payg");
    const saved = await repository.request({
      command: command,
      userId: owner,
      now: requestAt,
    });
    const old = await enrollment(now);
    await expect(
      repository.resolve({
        command: {
          id: saved.id,
          expectedRowVersion: 1,
          decision: "fulfilled",
          reason: "Prior service is not new assent",
          enrollmentId: old.id,
        },
        userId: approver,
        now: "2026-09-01T10:00:00.000Z",
      }),
    ).rejects.toThrow("VERIFIED_RESULT");
    const paid = await enrollment("2026-09-01T08:00:00.000Z");
    paidId = paid.id;
    await expect(
      repository.resolve({
        command: {
          id: saved.id,
          expectedRowVersion: 1,
          decision: "fulfilled",
          reason: "Missing confirmed conversion",
          enrollmentId: paid.id,
        },
        userId: approver,
        now: "2026-09-01T10:00:00.000Z",
      }),
    ).rejects.toThrow("VERIFIED_RESULT");
    await trials.convert({
      trialId,
      paygEnrollmentId: paid.id,
      actor: { kind: "user", id: approver },
      now: "2026-09-01T10:00:00.000Z",
    });
    const result = await repository.resolve({
      command: {
        id: saved.id,
        expectedRowVersion: 1,
        decision: "fulfilled",
        reason: "Verified conversion now confirmed",
        enrollmentId: paid.id,
      },
      userId: approver,
      now: "2026-09-01T10:00:00.000Z",
    });
    expect(result.result?.id).toBe(paid.id);
  });
  it("allows a blocked account to request cancellation, then waits for confirmed service end", async () => {
    await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .update(accounts)
        .set({ screeningStatus: "blocked" })
        .where(eq(accounts.id, accountId)),
    );
    const saved = await repository.request({
      command: {
        id: randomUUID(),
        accountId,
        organizationId,
        kind: "cancel_payg",
        enrollmentId: paidId,
        reason: "Customer no longer needs this service",
      },
      userId: owner,
      now: "2026-09-01T11:00:00.000Z",
    });
    expect(saved.status).toBe("pending");
    await expect(
      repository.resolve({
        command: {
          id: saved.id,
          expectedRowVersion: 1,
          decision: "fulfilled",
          reason: "Not yet confirmed by provider",
          enrollmentId: paidId,
        },
        userId: approver,
        now: "2026-09-01T12:00:00.000Z",
      }),
    ).rejects.toThrow("VERIFIED_RESULT");
    await withInternalTransaction(db, randomUUID(), async (tx) => {
      const [paid] = await tx
        .select()
        .from(paygEnrollments)
        .where(eq(paygEnrollments.id, paidId));
      if (!paid) throw new Error("Missing paid enrollment");
      await tx
        .update(paygEnrollments)
        .set({
          snapshot: {
            ...(paid.snapshot as Record<string, unknown>),
            endsAt: "2026-09-01T12:00:00.000Z",
          },
          cancellationEvidenceId: "verified-service-end",
        })
        .where(eq(paygEnrollments.id, paidId));
    });
    const resolved = await repository.resolve({
      command: {
        id: saved.id,
        expectedRowVersion: 1,
        decision: "fulfilled",
        reason: "Provider service end confirmed",
        enrollmentId: paidId,
      },
      userId: approver,
      now: "2026-09-01T12:00:00.000Z",
    });
    expect(resolved.result?.endsAt).toBe("2026-09-01T12:00:00.000Z");
  });
});
