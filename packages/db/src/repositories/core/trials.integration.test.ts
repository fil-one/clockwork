import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createRuntimeDatabase } from "../../client";
import { withInternalTransaction } from "../../transaction";
import {
  accounts,
  auditEvents,
  commerceUsers,
  memberships,
  organizations,
} from "../../schema";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { paygEnrollments } from "../../schema/core/payg-billing";
import { trialClaims, trialReservations } from "../../schema/core/trials";
import {
  PaygOfferTermsSchema,
  type PaygOfferRecord,
  type TrialCounters,
} from "@clockwork/domain/core";
import { DatabasePaygOfferRepository } from "./payg-offers";
import { DatabaseTrialRepository } from "./trials";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseTrialRepository(db);
const policies = new DatabasePaygOfferRepository(db);
const run = randomUUID();
const accountId = randomUUID();
const organizationId = randomUUID();
const trialId = randomUUID();
const creator = randomUUID();
const approver = randomUUID();
const domainEvidenceId = randomUUID();
const start = "2026-09-01T00:00:00.000Z";
const tenantId = `trial-tenant-${run}`;
let offer: PaygOfferRecord;
const actor = { kind: "user" as const, id: approver };
const claim = () =>
  repository.claim({
    id: trialId,
    organizationId,
    offerVersionId: offer.id,
    verificationEvidenceId: `dns:${domainEvidenceId}`,
    actor,
    now: start,
  });
const operation = (
  reservationId: string,
  request: Parameters<DatabaseTrialRepository["reserve"]>[0]["operation"],
  now = start,
) =>
  repository.reserve({
    trialId,
    reservationId,
    organizationId,
    tenantId,
    operation: request,
    now,
  });
const counters = (
  measuredAt: string,
  storedBytes: string,
  cumulativeEgressBytes: string,
): TrialCounters => ({
  organizationId,
  tenantId,
  measuredAt,
  storedBytes,
  cumulativeEgressBytes,
});
const receipt = (
  snapshot: TrialCounters,
  settlements: Parameters<
    DatabaseTrialRepository["ingestVerifiedCounters"]
  >[0]["settlements"] = [],
) =>
  repository.ingestVerifiedCounters({
    trialId,
    receiptId: randomUUID(),
    verificationEvidenceId: `verified-source-${run}`,
    counters: snapshot,
    settlements,
    now: snapshot.measuredAt,
  });

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
      legalName: `Trial fixture ${run}`,
      domain: `${run}.clockwork.test`,
      stripeCustomerId: `cus_trial_${run}`,
    });
    await tx.insert(organizations).values({
      id: organizationId,
      accountId,
      name: `Trial ${run}`,
      externalProvisioningId: tenantId,
    });
    await tx.insert(lifecyclePartnerDomains).values({
      id: domainEvidenceId,
      accountId,
      domain: `${run}.clockwork.test`,
      verificationTokenHash: "a".repeat(64),
      verifiedAt: new Date(start),
      brandName: "Verified test domain",
      logoUrl: null,
      primaryColor: "#123456",
      communicationOwner: "fil_one",
    });
    for (const id of [creator, approver]) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `trial-${id}`,
        email: `${id}@clockwork.test`,
        name: "Trial fixture finance",
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await tx.insert(memberships).values({
        userId: id,
        organizationId: "30000000-0000-4000-8000-000000000008",
        role: "finance_approver",
      });
    }
  });
  const terms = PaygOfferTermsSchema.parse({
    name: "Trial verified fixture",
    sku: `TRIAL-${run}`,
    region: "test",
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://docs.fil.one/billing/trial",
    sourceCheckedAt: start,
    sourceDocumentId: "fixture-source",
    owner: "Fixture finance",
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
      qboIncomeAccount: "4000-Storage",
    },
    trial: {
      durationDays: 1,
      gracePeriodDays: 1,
      storageLimitBytes: "100",
      cumulativeEgressLimitBytes: "200",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  });
  offer = await policies.command({
    command: { action: "create", terms },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now: start,
  });
  offer = await policies.command({
    command: {
      action: "propose",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Test qualification",
    },
    actor: { kind: "user", id: creator },
    requestId: randomUUID(),
    now: start,
  });
  offer = await policies.command({
    command: {
      action: "approve",
      id: offer.id,
      expectedRowVersion: offer.rowVersion,
      reason: "Test qualification",
      approvalEvidenceId: "test-approval",
    },
    actor,
    requestId: randomUUID(),
    now: start,
  });
});
afterAll(async () => client.end());
let writeId = "";
let egressId = "";
describe.sequential("durable trial authorization with provider fixture", () => {
  it("requires persisted domain proof and retains one lifetime claim under concurrency", async () => {
    await expect(
      repository.claim({
        id: randomUUID(),
        organizationId,
        offerVersionId: offer.id,
        verificationEvidenceId: `dns:${randomUUID()}`,
        actor,
        now: start,
      }),
    ).rejects.toThrow("TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED");
    const results = await Promise.all([claim(), claim()]);
    expect(results[0]).toEqual(results[1]);
    await expect(
      repository.claim({
        id: randomUUID(),
        organizationId,
        offerVersionId: offer.id,
        verificationEvidenceId: `dns:${domainEvidenceId}`,
        actor,
        now: start,
      }),
    ).rejects.toThrow("TRIAL_ALREADY_USED");
    const audit = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.aggregateId, trialId)),
    );
    expect(audit).toHaveLength(1);
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx.delete(trialClaims).where(eq(trialClaims.id, trialId)),
      ),
    ).rejects.toThrow();
  });
  it("fails closed without counters and reserves concurrent writes before provider execution", async () => {
    expect(
      await operation(randomUUID(), { kind: "write", additionalBytes: "1" }),
    ).toMatchObject({ allowed: false, reason: "stale_usage" });
    await receipt(counters(start, "0", "0"));
    const requests = [randomUUID(), randomUUID()];
    const decisions = await Promise.all(
      requests.map((id) =>
        operation(id, { kind: "write", additionalBytes: "60" }),
      ),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
    let providerWrites = 0;
    for (const [index, decision] of decisions.entries())
      if (decision.allowed) {
        providerWrites += 1;
        writeId = requests[index] ?? "";
      }
    expect(providerWrites).toBe(1);
    expect(writeId).not.toBe("");
    expect(
      await operation(writeId, { kind: "write", additionalBytes: "60" }),
    ).toMatchObject({ allowed: true, replay: true });
    await expect(
      operation(writeId, { kind: "write", additionalBytes: "1" }),
    ).rejects.toThrow("TRIAL_RESERVATION_REPLAY_CONFLICT");
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx.delete(trialReservations).where(eq(trialReservations.id, writeId)),
      ),
    ).rejects.toThrow();
  });
  it("settles only verified completions and protects cumulative egress independently", async () => {
    const at = "2026-09-01T00:00:01.000Z";
    await receipt(counters(at, "60", "0"), [
      { reservationId: writeId, outcome: "completed", actualBytes: "60" },
    ]);
    expect(
      await operation(writeId, { kind: "write", additionalBytes: "60" }, at),
    ).toMatchObject({ allowed: false, reason: "already_settled" });
    expect(
      await operation(
        randomUUID(),
        { kind: "write", additionalBytes: "41" },
        at,
      ),
    ).toMatchObject({ allowed: false, reason: "storage_limit" });
    egressId = randomUUID();
    expect(
      await operation(egressId, { kind: "egress", bytes: "150" }, at),
    ).toMatchObject({ allowed: true });
    expect(
      await operation(randomUUID(), { kind: "egress", bytes: "51" }, at),
    ).toMatchObject({ allowed: false, reason: "egress_limit" });
    await expect(
      receipt(counters("2026-09-01T00:00:02.000Z", "60", "0"), [
        { reservationId: egressId, outcome: "completed", actualBytes: "150" },
      ]),
    ).rejects.toThrow("TRIAL_EGRESS_BELOW_CONFIRMED_OPERATIONS");
    await receipt(counters("2026-09-01T00:00:02.000Z", "60", "150"), [
      { reservationId: egressId, outcome: "completed", actualBytes: "150" },
    ]);
  });
  it("rejects stale authorization, blocks expiry writes, permits grace reads and disables after grace", async () => {
    expect(
      await operation(
        randomUUID(),
        { kind: "api" },
        "2026-09-01T00:02:00.000Z",
      ),
    ).toMatchObject({ allowed: false, reason: "stale_usage" });
    const expires = "2026-09-02T00:00:00.000Z";
    await receipt(counters(expires, "60", "150"));
    expect(
      await operation(
        randomUUID(),
        { kind: "write", additionalBytes: "1" },
        expires,
      ),
    ).toMatchObject({ allowed: false, reason: "expired" });
    expect(
      await operation(randomUUID(), { kind: "egress", bytes: "49" }, expires),
    ).toMatchObject({ allowed: true });
    expect(
      await operation(
        randomUUID(),
        { kind: "api" },
        "2026-09-03T00:00:00.000Z",
      ),
    ).toMatchObject({ allowed: false, reason: "disabled" });
  });
  it("converts only a retained paid binding without inventing a term order or changing tenant", async () => {
    const paidId = randomUUID();
    await withInternalTransaction(db, randomUUID(), (tx) =>
      tx.insert(paygEnrollments).values({
        id: paidId,
        accountId,
        offerVersionId: offer.id,
        source: "trial-conversion-fixture",
        sourceEntitlementId: `paid-${run}`,
        bindingEvidenceId: "verified-paid-entitlement",
        snapshot: {
          id: paidId,
          binding: {
            mappingVersionId: "mapping",
            accountId,
            filOneOrganizationId: organizationId,
            tenantId,
            entitlementId: `paid-${run}`,
            sku: offer.terms.sku,
            region: offer.terms.region,
            source: "trial-conversion-fixture",
            meters: ["storage_bytes", "egress_bytes", "api_operations"],
            status: "active",
          },
          policy: {
            ...offer.terms.payg,
            id: offer.id,
            version: offer.terms.version,
            approvalEvidenceId: offer.approvalEvidenceId,
          },
          startsAt: start,
          billingAuthority: "clockwork",
          cutoverEvidenceId: "approved-fixture-cutover",
          supplierLegalEntityId: "97000000-0000-4000-8000-000000000002",
          stripeCustomerId: `cus_trial_${run}`,
        },
      }),
    );
    const input = {
      trialId,
      paygEnrollmentId: paidId,
      actor,
      now: "2026-09-03T00:00:01.000Z",
    };
    await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .update(organizations)
        .set({ externalProvisioningId: `remapped-${run}` })
        .where(eq(organizations.id, organizationId)),
    );
    await expect(repository.convert(input)).rejects.toThrow(
      "TRIAL_PAID_CONVERSION_NOT_CONFIRMED",
    );
    await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .update(organizations)
        .set({ externalProvisioningId: tenantId })
        .where(eq(organizations.id, organizationId)),
    );
    const converted = await repository.convert(input);
    expect(converted.tenantId).toBe(tenantId);
    expect(converted.paidPaygEnrollmentId).toBe(paidId);
    expect(converted.paidOrderId).toBeUndefined();
    expect(await repository.convert(input)).toEqual(converted);
    expect(
      await operation(randomUUID(), { kind: "api" }, input.now),
    ).toMatchObject({ allowed: false, reason: "converted" });
  });
});
