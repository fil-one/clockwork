import { createHash, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import {
  auditEvents,
  outboxMessages,
  payments,
  reportExports,
} from "../../schema";
import { collectionCases } from "../../schema/core/finance";
import { commercialArtifactRequests } from "../../schema/core/commercial-artifacts";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import {
  CommercialArtifactRequestSchema,
  DatabaseCommercialArtifactStore,
} from "./commercial-artifacts";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * The four core commands 001401 unblocks, each driven as the command and not as
 * a statement, on the tenant pool, under a real signed authorization context.
 *
 * Every assertion below was measured against the tree before 001401 existed.
 * `supabase/tests/1401_core_command_row_policies.test.sql` re-states the row
 * policies directly; this file is the half that proves the COMMANDS run, which
 * is the only thing that found any of them. Three of the four defects were
 * reported with a diagnosis that did not survive being driven:
 *
 *   * `reports:create` was reported dead for a finance-approver-only caller. It
 *     was dead for every internal caller, because a report export has no
 *     account and no permissive policy admitted an account-less audit row from
 *     the tenant pool. Fixing only the finance guard would have left the
 *     command dead.
 *   * `orders:*` was reported to fail on the signer lookup. It cannot:
 *     `mutateOrder` refuses unless the signer IS the acting user, so the lookup
 *     always finds the caller's own row. Only the AMENDMENT artifact reads a
 *     signer chosen by someone other than the caller, and only that one is
 *     asserted here.
 *   * `invoices:evaluate_dunning` was reported to give a second approver a
 *     VERSION_CONFLICT. It gave a raw `23505 duplicate key`, because the prior
 *     case was invisible so the command took the INSERT branch.
 */
const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});
const artifactStore = new DatabaseCommercialArtifactStore(db);

const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const key = (label: string) => `core-row-policy-${label}-${runId}`;

const directAccountId = "10000000-0000-4000-8000-000000000001";
const directOwnerUserId = "20000000-0000-4000-8000-000000000002";
const opsUserId = "20000000-0000-4000-8000-000000000001";
const secondApproverUserId = "20000000-0000-4000-8000-000000000006";
const internalAccountId = "10000000-0000-4000-8000-000000000009";
const referralPartnerId = "10000000-0000-4000-8000-000000000002";
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const referralInvoiceId = "90000000-0000-4000-8000-000000000002";
const overdueInvoiceId = "90000000-0000-4000-8000-000000000001";
const distributorAccountId = "10000000-0000-4000-8000-000000000005";
const distributorUserId = "20000000-0000-4000-8000-000000000005";
const endClientAccountId = "10000000-0000-4000-8000-000000000004";
const usdPriceBookId = "60000000-0000-4000-8000-000000000001";
const occurredAt = "2026-07-31T16:00:00.000Z";

const staff = (
  userId: string,
  roles: AuthorizationContext["roles"],
  accountIds: string[],
): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: accountIds.map((accountId) => ids.account.parse(accountId)),
  roles,
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});
const tenant = (
  userId: string,
  roles: AuthorizationContext["roles"],
  accountIds: string[],
): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: accountIds.map((accountId) => ids.account.parse(accountId)),
  roles,
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

afterAll(async () => client.end());

async function persistArtifact(
  result: Awaited<ReturnType<typeof repository.mutate>>,
  label: string,
): Promise<string> {
  const request = CommercialArtifactRequestSchema.parse(
    result.record.data.artifactRequest,
  );
  const documentId = randomUUID();
  await artifactStore.issue({
    request,
    artifact: {
      documentId,
      storageKey: `row-policy/${request.requestId}.pdf`,
      storageVersionId: `version-${label}`,
      contentHash: createHash("sha256")
        .update(request.requestHash)
        .digest("hex"),
      byteLength: 1024,
      mimeType: "application/pdf",
      retainUntil: request.retainUntil,
      legalHold: false,
    },
    requestId: key(`persist-${label}`),
  });
  return documentId;
}

/** A quarter far enough out that a second run cannot collide with this one. */
function randomQuarter(): string {
  const entropy = Number.parseInt(randomUUID().slice(0, 4), 16);
  return new Date(
    Date.UTC(2100 + (entropy % 7800), ((entropy % 4) * 3) | 0, 15, 12),
  ).toISOString();
}

describe.sequential("core commands the row policies used to refuse", () => {
  /**
   * `audit_events_finance_insert_guard` was RESTRICTIVE and tested
   * `app_has_role('finance_approver')` together with a seven-entry aggregate
   * allowlist that does not contain `commission_accrual`. Because roles are
   * additive, holding `finance_approver` REMOVED an authority: the third case
   * below is the same command, the same payload and the same actor as the
   * first, with one extra role, and before 001401 it failed on
   * `42501 new row violates row-level security policy for table
   * "audit_events"` while the first succeeded.
   */
  it("accrues a commission for a finance approver, and for a caller holding both roles", async () => {
    const accrueAs = async (
      label: string,
      roles: AuthorizationContext["roles"],
    ) => {
      const paymentId = randomUUID();
      const paidAt = randomQuarter();
      await withInternalTransaction(db, key(`payment-${label}`), async (tx) => {
        await tx.insert(payments).values({
          id: paymentId,
          invoiceId: referralInvoiceId,
          orderId: referralOrderId,
          stripePaymentIntentId: `pi_${key(label)}`,
          currency: "USD",
          amountMinor: 120_000n,
          status: "succeeded",
          receivedAt: new Date(paidAt),
        });
      });
      return repository.mutate({
        resource: "commissions",
        id: randomUUID(),
        accountId: referralPartnerId,
        action: "accrue",
        payload: { sourceType: "payment", sourceId: paymentId },
        actor: { kind: "user", id: opsUserId },
        authorization: staff(opsUserId, roles, [referralPartnerId]),
        requestId: key(`accrue-${label}`),
        idempotencyKey: key(`accrue-${label}`),
        occurredAt: paidAt,
      });
    };

    await expect(accrueAs("ops", ["internal_operator"])).resolves.toMatchObject(
      { record: { data: { status: "accrued" } } },
    );
    await expect(
      accrueAs("finance", ["finance_approver"]),
    ).resolves.toMatchObject({ record: { data: { status: "accrued" } } });
    await expect(
      accrueAs("both", ["internal_operator", "finance_approver"]),
    ).resolves.toMatchObject({ record: { data: { status: "accrued" } } });
  });

  /**
   * A report export carries no account, so its audit row carries
   * `account_id is null` and `audit_events_insert` -- `app_is_internal() or
   * app_has_account(account_id)` -- could not admit it from the tenant pool for
   * ANY caller. Both roles the command itself admits are driven here, and the
   * audit and dispatch rows are read back on the service pool, because a
   * command that reported success while writing no trail is exactly the shape
   * this suite exists to refuse.
   */
  it("creates a report export and its account-less audit trail", async () => {
    const createAs = async (
      label: string,
      roles: AuthorizationContext["roles"],
    ) => {
      const id = randomUUID();
      await repository.mutate({
        resource: "reports",
        id,
        action: "create",
        payload: {
          reportType: "weekly_scorecard",
          asOf: "2026-08-01T00:00:00.000Z",
          retainUntil: "2030-08-01T00:00:00.000Z",
        },
        actor: { kind: "user", id: opsUserId },
        authorization: staff(opsUserId, roles, [internalAccountId]),
        requestId: key(`report-${label}`),
        idempotencyKey: key(`report-${label}`),
        occurredAt: "2026-08-01T00:00:00.000Z",
      });
      return id;
    };

    const financeReportId = await createAs("finance", ["finance_approver"]);
    const opsReportId = await createAs("ops", ["internal_operator"]);

    const trail = await withInternalTransaction(
      db,
      key("report-trail"),
      async (tx) => {
        const rows = await tx
          .select({ id: auditEvents.id, accountId: auditEvents.accountId })
          .from(auditEvents)
          .where(eq(auditEvents.aggregateId, financeReportId));
        const dispatched = rows[0]
          ? await tx
              .select({ id: outboxMessages.id })
              .from(outboxMessages)
              .where(eq(outboxMessages.eventId, rows[0].id))
          : [];
        const exports = await tx
          .select({ id: reportExports.id, status: reportExports.status })
          .from(reportExports)
          .where(eq(reportExports.id, opsReportId));
        return { rows, dispatched, exports };
      },
    );
    expect(trail.rows).toHaveLength(1);
    expect(trail.rows[0]?.accountId).toBeNull();
    expect(trail.dispatched).toHaveLength(1);
    expect(trail.exports[0]).toMatchObject({ status: "pending" });
  });

  /**
   * What the relaxed guard still refuses, stated in full. The aggregate
   * allowlist is gone; the ATTRIBUTION conjunct is the whole remaining control,
   * and it is the one that stops a forged four-eyes trail. The refused set is
   * exactly: an insert into `audit_events` on the tenant pool by a caller
   * holding `finance_approver` whose `actor.id` is not the authenticated user.
   */
  it("still refuses a finance approver an audit row attributed to somebody else", async () => {
    const insertAs = (roles: AuthorizationContext["roles"], actorId: string) =>
      withAuthorizedTransaction(
        db,
        {
          userId: ids.user.parse(opsUserId),
          accountIds: [referralPartnerId],
          roles,
          isInternalStaff: true,
          requestId: key(`forge-${actorId}`),
        },
        { secret: authorizationSecret },
        async (tx) => {
          await tx.execute(sql`
            insert into public.audit_events
              (account_id, aggregate_type, aggregate_id, aggregate_version,
               event_type, event_version, actor, occurred_at, request_id)
            values (${referralPartnerId}, 'invoice', ${randomUUID()}, 1,
                    'core.invoices.create', 1,
                    ${JSON.stringify({ kind: "user", id: actorId })}::jsonb,
                    now(), ${key(`forge-${actorId}`)})
          `);
          throw new Error("ROLLBACK_AFTER_WRITE");
        },
      );

    await expect(
      insertAs(["finance_approver"], secondApproverUserId),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    // The same row under the caller's own name is admitted, so the refusal
    // above is about attribution and not about the caller.
    await expect(insertAs(["finance_approver"], opsUserId)).rejects.toThrow(
      "ROLLBACK_AFTER_WRITE",
    );
  });

  /**
   * `amendmentArtifactDefinition` prints the name of the person who signed the
   * PARENT ORDER, and `commerce_users_read` is `app_is_current_user(id)`, so on
   * the tenant pool the lookup returned nothing for any amender who was not
   * that person and the command died on COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND.
   * The order below is signed by the account owner and amended by a colleague
   * on the same account, which is the ordinary case, not an exotic one.
   */
  it("prepares an amendment artifact for an amender who did not sign the order", async () => {
    const quoteId = randomUUID();
    const orderId = randomUUID();
    const orderLineId = randomUUID();
    const signer = tenant(directOwnerUserId, ["owner"], [directAccountId]);
    const colleague = tenant(opsUserId, ["owner"], [directAccountId]);
    const asSigner = {
      accountId: directAccountId,
      actor: { kind: "user" as const, id: directOwnerUserId },
      authorization: signer,
    };

    await repository.mutate({
      ...asSigner,
      resource: "quotes",
      id: quoteId,
      action: "create",
      payload: {
        priceBookId: usdPriceBookId,
        seriesId: randomUUID(),
        route: "direct",
        lines: [
          {
            lineId: randomUUID(),
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      requestId: key("signer-quote"),
      idempotencyKey: key("signer-quote"),
      occurredAt,
    });
    const quoteArtifact = await repository.mutate({
      ...asSigner,
      resource: "quotes",
      id: quoteId,
      action: "prepare_artifact",
      expectedVersion: 1,
      payload: {
        audience: "end_client",
        issuedAt: occurredAt,
        retainUntil: "2033-07-31T16:00:00.000Z",
      },
      requestId: key("signer-quote-artifact"),
      idempotencyKey: key("signer-quote-artifact"),
      occurredAt,
    });
    const quoteDocumentId = await persistArtifact(quoteArtifact, "signerquote");
    await repository.mutate({
      ...asSigner,
      resource: "quotes",
      id: quoteId,
      action: "issue",
      expectedVersion: 1,
      payload: {
        artifactIssuedAt: occurredAt,
        renderedDocumentId: quoteDocumentId,
      },
      requestId: key("signer-quote-issue"),
      idempotencyKey: key("signer-quote-issue"),
      occurredAt,
    });
    const orderCommand = {
      quoteId,
      signerUserId: directOwnerUserId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [orderLineId],
    };
    const orderArtifact = await repository.mutate({
      ...asSigner,
      resource: "orders",
      id: orderId,
      action: "prepare_artifact",
      payload: { ...orderCommand, retainUntil: "2033-08-01T00:00:00.000Z" },
      requestId: key("signer-order-artifact"),
      idempotencyKey: key("signer-order-artifact"),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const orderDocumentId = await persistArtifact(orderArtifact, "signerorder");
    await repository.mutate({
      ...asSigner,
      resource: "orders",
      id: orderId,
      action: "create",
      payload: { ...orderCommand, orderFormDocumentId: orderDocumentId },
      requestId: key("signer-order"),
      idempotencyKey: key("signer-order"),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });

    const amendmentId = randomUUID();
    const prepared = await repository.mutate({
      resource: "amendments",
      id: amendmentId,
      accountId: directAccountId,
      action: "prepare_artifact",
      payload: {
        amendment: {
          id: amendmentId,
          order: { id: orderId },
          effectiveOn: "2026-09-01",
          kind: "upgrade" as const,
          prorationMethod: "daily" as const,
          deltas: [
            {
              orderLineId,
              sku: "LOCKED-STORAGE-TB",
              quantityDelta: "1",
              fullPeriodPriceDelta: { currency: "USD", minor: "10000" },
            },
          ],
          acceptedAt: "2026-08-15T16:00:00.000Z",
        },
        retainUntil: "2033-08-15T16:00:00.000Z",
      },
      // The amender, and not the signer. This is the whole test.
      actor: { kind: "user", id: opsUserId },
      authorization: colleague,
      requestId: key("colleague-amendment-artifact"),
      idempotencyKey: key("colleague-amendment-artifact"),
      occurredAt: "2026-08-15T16:00:00.000Z",
    });
    const request = CommercialArtifactRequestSchema.parse(
      prepared.record.data.artifactRequest,
    );
    // The printed name is the SIGNER's, resolved by a colleague who cannot
    // read that user's row -- which is the point of returning a name rather
    // than widening `commerce_users`.
    expect(
      (request.sourceDefinition as { acceptedBy?: { name?: string } })
        .acceptedBy?.name,
    ).toBe("Dana Direct");
  });

  /**
   * The refused half of the same accessor. A caller with no relationship to a
   * user gets null, so the artifact builders still raise
   * COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND for a signer they have no claim on.
   */
  it("resolves no signer name for a user the caller has no order or agreement with", async () => {
    const resolved = await withAuthorizedTransaction(
      db,
      {
        userId: ids.user.parse(distributorUserId),
        accountIds: [distributorAccountId],
        roles: ["partner_admin"],
        isInternalStaff: false,
        requestId: key("signer-refusal"),
      },
      { secret: authorizationSecret },
      async (tx) =>
        tx.execute<{ name: string | null }>(
          sql`select public.core_commercial_signer(${directOwnerUserId}::uuid) as name`,
        ),
    );
    expect(resolved[0]?.name ?? null).toBeNull();
  });

  /**
   * `quotes:prepare_artifact` with audience `end_client` on a distributor
   * quote, run by the partner who is merchant of record on it.
   *
   * `core_commercial_artifact_insert` names this caller explicitly; the write
   * was then refused by `core_commercial_artifact_select` on its own
   * `returning`, because the audience is the END CLIENT and the partner does
   * not hold that account. 42501, after the row was accepted -- the same split
   * shape that broke partner quote creation. `quotes:issue` on this quote is
   * still blocked further down and is not asserted here; see the migration.
   */
  it("prepares the end-client artifact for a distributor quote as the partner", async () => {
    const quoteId = randomUUID();
    const asPartner = {
      resource: "quotes" as const,
      id: quoteId,
      accountId: endClientAccountId,
      actor: { kind: "user" as const, id: distributorUserId },
      authorization: tenant(
        distributorUserId,
        ["partner_admin"],
        [distributorAccountId],
      ),
    };
    await repository.mutate({
      ...asPartner,
      action: "create",
      payload: {
        priceBookId: usdPriceBookId,
        seriesId: randomUUID(),
        route: "distributor",
        endClientAccountId,
        partnerAccountId: distributorAccountId,
        partnerTier: "distributor",
        partnerResaleTotal: { currency: "USD", minor: "180000" },
        lines: [
          {
            lineId: randomUUID(),
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      requestId: key("distributor-quote"),
      idempotencyKey: key("distributor-quote"),
      occurredAt,
    });
    const prepared = await repository.mutate({
      ...asPartner,
      action: "prepare_artifact",
      expectedVersion: 1,
      payload: {
        audience: "end_client",
        issuedAt: occurredAt,
        retainUntil: "2033-07-31T16:00:00.000Z",
      },
      requestId: key("distributor-artifact"),
      idempotencyKey: key("distributor-artifact"),
      occurredAt,
    });
    const request = CommercialArtifactRequestSchema.parse(
      prepared.record.data.artifactRequest,
    );
    expect(request).toMatchObject({
      subjectType: "quote",
      subjectId: quoteId,
      audience: "end_client",
      documentKind: "partner_resale_quote",
      audienceAccountId: endClientAccountId,
    });
    const persisted = await withInternalTransaction(
      db,
      key("distributor-artifact-read"),
      async (tx) =>
        tx
          .select({ id: commercialArtifactRequests.id })
          .from(commercialArtifactRequests)
          .where(eq(commercialArtifactRequests.id, request.requestId)),
    );
    expect(persisted).toHaveLength(1);
  });

  /**
   * `invoices:evaluate_dunning` twice, by two different finance approvers.
   *
   * `core_collection_cases_finance_read` required `owner_user_id =
   * app_current_user_id()`, so the second approver could not see the case the
   * first opened, took the insert branch, and hit
   * `23505 duplicate key value violates unique constraint
   * "core_collection_cases_invoice_id_key"` -- a raw driver error, not a
   * refusal. Ownership stays with the approver who opened the case:
   * `core_protect_collection_case_identity` makes it immutable and the command
   * no longer restates it.
   */
  it("lets a second finance approver evaluate dunning without taking the case", async () => {
    const evaluate = (userId: string, label: string) =>
      repository.mutate({
        resource: "invoices",
        id: overdueInvoiceId,
        accountId: directAccountId,
        action: "evaluate_dunning",
        payload: {},
        actor: { kind: "user", id: userId },
        authorization: staff(userId, ["finance_approver"], [internalAccountId]),
        requestId: key(`dunning-${label}`),
        idempotencyKey: key(`dunning-${label}`),
        occurredAt: "2026-07-31T16:00:00.000Z",
      });

    const opened = await evaluate(opsUserId, "first");
    expect(opened.record.data.collectionCase).toMatchObject({
      ownerUserId: opsUserId,
    });
    const advanced = await evaluate(secondApproverUserId, "second");
    expect(advanced.record.data.collectionCase).toMatchObject({
      ownerUserId: opsUserId,
    });

    const persisted = await withInternalTransaction(
      db,
      key("dunning-read"),
      async (tx) =>
        tx
          .select({
            id: collectionCases.id,
            ownerUserId: collectionCases.ownerUserId,
          })
          .from(collectionCases)
          .where(eq(collectionCases.invoiceId, overdueInvoiceId)),
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.ownerUserId).toBe(opsUserId);
  });
});
