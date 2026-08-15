import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, documents, providerOperations } from "../../schema";
import {
  lifecycleAgreementDrafts,
  lifecycleProvisioningAttempts,
  lifecycleSignatureEnvelopes,
} from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

/*
 * `create_signature_envelope` could not run. Seven merged pull requests and an
 * independent audit passed over it because nothing drove the command: the
 * repository unit tests use doubles, and the one integration test that needed
 * the resulting row state -- `esign-provider-binding.integration.test.ts` --
 * had to reproduce the command's writes by hand on the service pool precisely
 * because the command itself was refused.
 *
 * The command is neither a `providerCommand` nor a `staffServiceCommand`, so it
 * opens `withAuthorizedTransaction` as `clockwork_runtime`, and its
 * `provider_operations` insert met `provider_operations_internal`
 * (`app_is_internal()`, i.e. `current_user = 'clockwork_service'`). Against the
 * code before 001399 the assertions below fail with
 *
 *   42501 new row violates row-level security policy for table
 *   "provider_operations"
 *
 * `decide_poc` is here for the same reason and is a second instance rather than
 * a second symptom: on approval it claims a `provisioning`/`sandbox` operation
 * in the same table from the same tenant pool, so the approving half of that
 * command was dead too while the rejecting half -- which claims nothing -- kept
 * the command looking alive.
 *
 * These drive the real `executeInTransaction` entry point under a real signed
 * authorization context. The handle authenticates as the local `postgres`
 * login, which is a member of both roles, but `withAuthorizedTransaction` still
 * issues `set local role clockwork_runtime` and every policy table is `force
 * row level security`, so the row policies bind here exactly as they do in
 * production.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const NORTHSTAR_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const NORTHSTAR_OWNER_ID = "20000000-0000-4000-8000-000000000002";
const JUNIPER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000004";
const JUNIPER_OWNER_ID = "20000000-0000-4000-8000-000000000004";
const JUNIPER_EVIDENCE_DOCUMENT_ID = "40000000-0000-4000-8000-000000000007";
const SUPPORT_OWNER_ID = "20000000-0000-4000-8000-000000000001";
const occurredAt = "2026-07-31T16:00:00.000Z";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});

const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
    exceptionQueues: exceptionQueues.map((queue) => ({
      queue,
      ownerId: SUPPORT_OWNER_ID,
      backupId: "20000000-0000-4000-8000-000000000005",
      targetBusinessHours: 8,
      escalationOwnerId: "20000000-0000-4000-8000-000000000006",
      separationRequired: true,
    })),
  },
});

function authorization(
  userId: string,
  accountId: string,
): AuthorizationContext {
  return {
    userId: ids.user.parse(userId),
    accountIds: [ids.account.parse(accountId)],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
}

function tenantContext(input: {
  requestId: string;
  idempotencyKey: string;
  userId: string;
  accountId: string;
}) {
  return {
    requestId: input.requestId,
    actor: { kind: "user" as const, id: input.userId },
    idempotencyKey: input.idempotencyKey,
    ip: "192.0.2.30",
    userAgent: "Clockwork provider operation claim integration",
    occurredAt,
    authorization: authorization(input.userId, input.accountId),
  };
}

/** Customer paper has to be immutable evidence before a draft can cite it. */
function seedCustomerPaper(label: string): Promise<string> {
  const unique = randomUUID();
  return withInternalTransaction(db, `claim-doc-${label}`, async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        accountId: NORTHSTAR_ACCOUNT_ID,
        kind: "agreement",
        storageKey: `provider-operation-claims/${unique}.pdf`,
        contentHash: createHash("sha256").update(unique).digest("hex"),
        mimeType: "application/pdf",
        byteLength: 4096n,
        objectLockMode: "COMPLIANCE",
        retainUntil: new Date("2033-07-31T16:00:00.000Z"),
        storageVersionId: `v-${unique.slice(0, 8)}`,
      })
      .returning({ id: documents.id });
    if (!row) throw new Error("document insert expected");
    return row.id;
  });
}

function claimFor(aggregateId: string) {
  return withInternalTransaction(db, `claim-read-${aggregateId}`, (tx) =>
    tx.query.providerOperations.findFirst({
      where: eq(providerOperations.aggregateId, aggregateId),
    }),
  );
}

function label(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await client.end();
});

describe.sequential("tenant provider-operation claims", () => {
  it("creates a counter-signed envelope and its e-sign claim in one command", async () => {
    const run = label("envelope");
    const documentId = await seedCustomerPaper(run);
    const uploaded = await repository.executeInTransaction({
      command: "upload_customer_paper",
      payload: {
        accountId: NORTHSTAR_ACCOUNT_ID,
        uploadedDocumentId: documentId,
        negotiationStatus: "agreed",
        jurisdiction: "US-DE",
        keyTerms: { breachNoticeHours: 24 },
      },
      context: tenantContext({
        requestId: `claim-upload-${run}`,
        idempotencyKey: `claim-upload-${run}`,
        userId: NORTHSTAR_OWNER_ID,
        accountId: NORTHSTAR_ACCOUNT_ID,
      }),
    });
    const draftId = uploaded.id;

    const envelopeIdempotencyKey = `claim-envelope-${run}`;
    const created = await repository.executeInTransaction({
      command: "create_signature_envelope",
      payload: {
        accountId: NORTHSTAR_ACCOUNT_ID,
        agreementId: draftId,
        documentId,
        signerEmail: "Owner@Northstar.test",
        mode: "redirect",
        returnUrl: "https://portal.clockwork.test/agreements/return",
      },
      context: tenantContext({
        requestId: `claim-envelope-${run}`,
        idempotencyKey: envelopeIdempotencyKey,
        userId: NORTHSTAR_OWNER_ID,
        accountId: NORTHSTAR_ACCOUNT_ID,
      }),
    });

    expect(created).toMatchObject({
      status: "created",
      eventType: "agreement.envelope_created",
    });

    const envelope = await withInternalTransaction(
      db,
      `claim-envelope-read-${run}`,
      (tx) =>
        tx.query.lifecycleSignatureEnvelopes.findFirst({
          where: eq(lifecycleSignatureEnvelopes.id, created.id),
        }),
    );
    expect(envelope).toMatchObject({
      agreementDraftId: draftId,
      accountId: NORTHSTAR_ACCOUNT_ID,
      documentId,
      signerEmail: "owner@northstar.test",
      signingMode: "redirect",
      state: "created",
    });
    expect(envelope?.providerEnvelopeId).toBe(created.providerEnvelopeId);

    // The row the whole path died on. Its absence is the defect; asserting the
    // envelope alone would pass against a version that dropped the claim.
    expect(await claimFor(draftId)).toMatchObject({
      provider: "esign",
      operation: "create_envelope",
      idempotencyKey: envelopeIdempotencyKey,
      aggregateType: "agreement",
      aggregateId: draftId,
      status: "pending",
      attemptCount: 0,
      providerReference: null,
      lastError: null,
      nextAttemptAt: null,
    });

    // The claim is atomic with the versioned agreement write, so the draft
    // sequence has to show the envelope event and nothing else.
    const draft = await withInternalTransaction(
      db,
      `claim-draft-read-${run}`,
      (tx) =>
        tx.query.lifecycleAgreementDrafts.findFirst({
          where: eq(lifecycleAgreementDrafts.id, draftId),
        }),
    );
    expect(draft?.rowVersion).toBe(2);
    const events = await withInternalTransaction(
      db,
      `claim-events-${run}`,
      (tx) =>
        tx
          .select({
            aggregateVersion: auditEvents.aggregateVersion,
            eventType: auditEvents.eventType,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.aggregateType, "agreement"),
              eq(auditEvents.aggregateId, draftId),
            ),
          )
          .orderBy(asc(auditEvents.aggregateVersion)),
    );
    expect(events).toEqual([
      { aggregateVersion: 1, eventType: "agreement.customer_paper_uploaded" },
      { aggregateVersion: 2, eventType: "agreement.envelope_created" },
    ]);
  });

  it("refuses an envelope for a draft on an account the caller does not hold", async () => {
    const run = label("scope");
    const documentId = await seedCustomerPaper(run);
    const uploaded = await repository.executeInTransaction({
      command: "upload_customer_paper",
      payload: {
        accountId: NORTHSTAR_ACCOUNT_ID,
        uploadedDocumentId: documentId,
        negotiationStatus: "agreed",
        jurisdiction: "US-DE",
        keyTerms: { breachNoticeHours: 24 },
      },
      context: tenantContext({
        requestId: `claim-scope-upload-${run}`,
        idempotencyKey: `claim-scope-upload-${run}`,
        userId: NORTHSTAR_OWNER_ID,
        accountId: NORTHSTAR_ACCOUNT_ID,
      }),
    });

    // The admission the fix adds is account-scoped, not blanket. A caller
    // holding a different account must still be refused, and must be refused
    // before any row is written.
    await expect(
      repository.executeInTransaction({
        command: "create_signature_envelope",
        payload: {
          accountId: NORTHSTAR_ACCOUNT_ID,
          agreementId: uploaded.id,
          documentId,
          signerEmail: "owner@juniper.test",
          mode: "redirect",
          returnUrl: "https://portal.clockwork.test/agreements/return",
        },
        context: tenantContext({
          requestId: `claim-scope-${run}`,
          idempotencyKey: `claim-scope-${run}`,
          userId: JUNIPER_OWNER_ID,
          accountId: JUNIPER_ACCOUNT_ID,
        }),
      }),
    ).rejects.toThrow("ACCOUNT_SCOPE");
    expect(await claimFor(uploaded.id)).toBeUndefined();
  });

  it("claims sandbox provisioning when a POC is approved", async () => {
    const run = label("poc");
    const created = await repository.executeInTransaction({
      command: "create_poc",
      payload: {
        accountId: JUNIPER_ACCOUNT_ID,
        partnerAccountId: null,
        workload: `Provider operation claim evaluation ${run}`,
        buyerUserId: JUNIPER_OWNER_ID,
        permittedDataClass: "confidential",
        successTests: [
          {
            id: `retention-${run}`,
            description: "Retention proof succeeds",
            target: "All retained objects remain verifiable",
          },
        ],
        capacityCap: "10",
        egressCap: "1",
        expiresAt: "2026-08-31T16:00:00.000Z",
        supportOwnerId: SUPPORT_OWNER_ID,
      },
      context: tenantContext({
        requestId: `claim-poc-create-${run}`,
        idempotencyKey: `claim-poc-create-${run}`,
        userId: JUNIPER_OWNER_ID,
        accountId: JUNIPER_ACCOUNT_ID,
      }),
    });
    expect(created).toMatchObject({ status: "proposed" });

    const decided = await repository.executeInTransaction({
      command: "decide_poc",
      payload: {
        pocId: created.id,
        accountId: JUNIPER_ACCOUNT_ID,
        decision: "approved",
        reason: "Success criteria met in the qualification review",
        evidenceDocumentId: JUNIPER_EVIDENCE_DOCUMENT_ID,
      },
      context: tenantContext({
        requestId: `claim-poc-decide-${run}`,
        idempotencyKey: `claim-poc-decide-${run}`,
        userId: JUNIPER_OWNER_ID,
        accountId: JUNIPER_ACCOUNT_ID,
      }),
    });
    expect(decided).toMatchObject({
      status: "approved",
      eventType: "poc.approved",
    });

    // The provisioning attempt was always admitted -- 000200 gave
    // `lifecycle_provisioning_attempts` a tenant insert policy. Its sibling
    // claim in `provider_operations` was not, so the approval died between the
    // two writes and the attempt was never enqueued either.
    const attempt = await withInternalTransaction(
      db,
      `claim-poc-attempt-${run}`,
      (tx) =>
        tx.query.lifecycleProvisioningAttempts.findFirst({
          where: eq(lifecycleProvisioningAttempts.pocId, created.id),
        }),
    );
    expect(attempt).toMatchObject({
      accountId: JUNIPER_ACCOUNT_ID,
      operation: "sandbox",
    });
    expect(await claimFor(created.id)).toMatchObject({
      provider: "provisioning",
      operation: "sandbox",
      aggregateType: "poc",
      aggregateId: created.id,
      status: "pending",
      attemptCount: 0,
    });
  });

  it("still records a POC rejection without claiming provisioning", async () => {
    const run = label("reject");
    const created = await repository.executeInTransaction({
      command: "create_poc",
      payload: {
        accountId: JUNIPER_ACCOUNT_ID,
        partnerAccountId: null,
        workload: `Provider operation claim rejection ${run}`,
        buyerUserId: JUNIPER_OWNER_ID,
        permittedDataClass: "confidential",
        successTests: [
          {
            id: `retention-${run}`,
            description: "Retention proof succeeds",
            target: "All retained objects remain verifiable",
          },
        ],
        capacityCap: "10",
        egressCap: "1",
        expiresAt: "2026-08-31T16:00:00.000Z",
        supportOwnerId: SUPPORT_OWNER_ID,
      },
      context: tenantContext({
        requestId: `claim-reject-create-${run}`,
        idempotencyKey: `claim-reject-create-${run}`,
        userId: JUNIPER_OWNER_ID,
        accountId: JUNIPER_ACCOUNT_ID,
      }),
    });

    // The control. This is the half of `decide_poc` that already worked, and a
    // fix that started claiming provisioning on rejection would be a new defect.
    const decided = await repository.executeInTransaction({
      command: "decide_poc",
      payload: {
        pocId: created.id,
        accountId: JUNIPER_ACCOUNT_ID,
        decision: "rejected",
        reason: "Qualification review did not clear the data class",
        evidenceDocumentId: JUNIPER_EVIDENCE_DOCUMENT_ID,
      },
      context: tenantContext({
        requestId: `claim-reject-decide-${run}`,
        idempotencyKey: `claim-reject-decide-${run}`,
        userId: JUNIPER_OWNER_ID,
        accountId: JUNIPER_ACCOUNT_ID,
      }),
    });
    expect(decided).toMatchObject({
      status: "closed",
      eventType: "poc.rejected",
    });
    expect(await claimFor(created.id)).toBeUndefined();
  });
});
