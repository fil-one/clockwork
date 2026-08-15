import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, documents, outboxMessages } from "../../schema";
import {
  lifecycleAgreementDrafts,
  lifecycleSignatureEnvelopes,
} from "../../schema/lifecycle/platform";
import { providerResourceBindings } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";
import { DatabaseLifecycleCommandRepository } from "../lifecycle/command-repository";
import { DatabaseEsignSigningSessionRepository } from "./providers";

/*
 * P0-51. `persistProviderBinding` published the signature envelope's own
 * `row_version` as the aggregate version of an `agreement` event keyed on the
 * agreement draft. `audit_aggregate_version_unique` in
 * supabase/migrations/000001_foundation.sql sequences that aggregate on one
 * counter, and every other agreement writer takes its number from
 * `lifecycle_agreement_drafts.row_version` through `bumpDraftVersion`. Nothing
 * exercised this method, so two counters fed one sequence unobserved.
 *
 * The precondition these tests build is the counter-signed one: the draft sits
 * at version 2 with `agreement.envelope_created` already occupying version 2,
 * and the envelope row sits at version 1 with its own `touch_versioned_row`
 * trigger about to move it to 2. That is the state
 * `ProductionEsignSigningSessionService` in
 * apps/web/src/providers/composition.ts hands to `persistProviderBinding`.
 * Against the unfixed method the audit insert raises
 * `23505 duplicate key value violates unique constraint
 * "audit_aggregate_version_unique"`.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "20000000-0000-4000-8000-000000000002";
const SIGNER_EMAIL = "owner@northstar.test";
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
      ownerId: "20000000-0000-4000-8000-000000000001",
      backupId: "20000000-0000-4000-8000-000000000005",
      targetBusinessHours: 8,
      escalationOwnerId: "20000000-0000-4000-8000-000000000006",
      separationRequired: true,
    })),
  },
});

const sessions = new DatabaseEsignSigningSessionRepository(db);

function authorization(): AuthorizationContext {
  return {
    userId: ids.user.parse(OWNER_USER_ID),
    accountIds: [ids.account.parse(ACCOUNT_ID)],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
}

function ownerContext(requestId: string, idempotencyKey: string) {
  return {
    requestId,
    actor: { kind: "user" as const, id: OWNER_USER_ID },
    idempotencyKey,
    ip: "192.0.2.20",
    userAgent: "Clockwork esign binding integration",
    occurredAt,
    authorization: authorization(),
  };
}

/** Customer paper has to be immutable evidence before a draft can reference it. */
async function seedCustomerPaper(label: string): Promise<string> {
  const unique = randomUUID();
  return withInternalTransaction(db, `esign-doc-${label}`, async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        accountId: ACCOUNT_ID,
        kind: "agreement",
        storageKey: `esign-binding/${unique}.pdf`,
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

interface CounterSignedFixture {
  draftId: string;
  documentId: string;
  envelopeId: string;
  /** The placeholder the command repository derives; the provider replaces it. */
  placeholderProviderEnvelopeId: string;
}

/**
 * Puts the draft and its envelope in the state a counter-signed agreement holds
 * the moment the signing session calls out to the provider.
 *
 * Both commands are executed for real, so the draft, the envelope, the
 * `provider_operations` claim, both draft versions and both agreement events
 * are the ones production writes. This used to reproduce
 * `createSignatureEnvelope`'s writes statement for statement on the service
 * pool, because the command could not be executed end to end: it is neither a
 * provider command nor a `staffServiceCommand`, so it runs under
 * `withAuthorizedTransaction` as `clockwork_runtime`, and its
 * `provider_operations` insert was refused by `provider_operations_internal`
 * (`app_is_internal()`) with SQLSTATE 42501.
 * supabase/migrations/001399_provider_operations_tenant_claim.sql gave the
 * table the tenant append policy its sibling
 * `lifecycle_provisioning_attempts` already had, so the fixture is now the
 * command itself and the hand-written copy of it is gone.
 */
async function counterSignedEnvelope(
  label: string,
): Promise<CounterSignedFixture> {
  const documentId = await seedCustomerPaper(label);
  const uploaded = await repository.executeInTransaction({
    command: "upload_customer_paper",
    payload: {
      accountId: ACCOUNT_ID,
      uploadedDocumentId: documentId,
      negotiationStatus: "agreed",
      jurisdiction: "US-DE",
      keyTerms: { breachNoticeHours: 24 },
    },
    context: ownerContext(`esign-upload-${label}`, `esign-upload-${label}`),
  });
  const draftId = uploaded.id;
  const created = await repository.executeInTransaction({
    command: "create_signature_envelope",
    payload: {
      accountId: ACCOUNT_ID,
      agreementId: draftId,
      documentId,
      signerEmail: SIGNER_EMAIL,
      mode: "redirect",
      returnUrl: "https://portal.clockwork.test/agreements/return",
    },
    context: ownerContext(`esign-envelope-${label}`, `esign-envelope-${label}`),
  });
  if (typeof created.providerEnvelopeId !== "string")
    throw new Error("PROVIDER_ENVELOPE_ID_MISSING");
  return {
    draftId,
    documentId,
    envelopeId: created.id,
    placeholderProviderEnvelopeId: created.providerEnvelopeId,
  };
}

function draftVersion(draftId: string): Promise<number> {
  return withInternalTransaction(
    db,
    `esign-draft-read-${draftId}`,
    async (tx) => {
      const row = await tx.query.lifecycleAgreementDrafts.findFirst({
        columns: { rowVersion: true },
        where: eq(lifecycleAgreementDrafts.id, draftId),
      });
      if (!row) throw new Error("draft expected");
      return row.rowVersion;
    },
  );
}

function envelopeRow(envelopeId: string) {
  return withInternalTransaction(
    db,
    `esign-envelope-read-${envelopeId}`,
    (tx) =>
      tx.query.lifecycleSignatureEnvelopes.findFirst({
        where: eq(lifecycleSignatureEnvelopes.id, envelopeId),
      }),
  );
}

interface AgreementEvent {
  aggregateVersion: number;
  eventType: string;
}

function agreementEvents(draftId: string): Promise<AgreementEvent[]> {
  return withInternalTransaction(db, `esign-events-${draftId}`, (tx) =>
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
}

/** The outbox payload carries the version consumers key on, so assert it too. */
function outboxVersions(draftId: string): Promise<number[]> {
  return withInternalTransaction(db, `esign-outbox-${draftId}`, async (tx) => {
    const rows = await tx
      .select({ payload: outboxMessages.payload })
      .from(outboxMessages)
      .innerJoin(auditEvents, eq(auditEvents.id, outboxMessages.eventId))
      .where(
        and(
          eq(auditEvents.aggregateType, "agreement"),
          eq(auditEvents.aggregateId, draftId),
        ),
      )
      .orderBy(asc(auditEvents.aggregateVersion));
    return rows.map((row) =>
      Number((row.payload as { aggregateVersion?: unknown }).aggregateVersion),
    );
  });
}

function bindingRow(providerEnvelopeId: string) {
  return withInternalTransaction(
    db,
    `esign-binding-read-${providerEnvelopeId}`,
    (tx) =>
      tx.query.providerResourceBindings.findFirst({
        where: and(
          eq(providerResourceBindings.provider, "esign"),
          eq(providerResourceBindings.providerResourceType, "envelope"),
          eq(providerResourceBindings.providerResourceId, providerEnvelopeId),
        ),
      }),
  );
}

function label(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function providerId(): string {
  return `esign_provider_${randomUUID().slice(0, 12)}`;
}

afterAll(async () => {
  await client.end();
});

describe.sequential("e-sign provider binding aggregate version", () => {
  it("sequences the binding event on the draft after the counter-signed create", async () => {
    const fixture = await counterSignedEnvelope(label("counter"));

    // The precondition the defect needed: the draft is already at 2 and
    // `agreement.envelope_created` occupies version 2, while the envelope row
    // is still at 1 and its own trigger will move it to 2 on the next update.
    expect(await draftVersion(fixture.draftId)).toBe(2);
    expect(await agreementEvents(fixture.draftId)).toEqual([
      { aggregateVersion: 1, eventType: "agreement.customer_paper_uploaded" },
      { aggregateVersion: 2, eventType: "agreement.envelope_created" },
    ]);
    expect((await envelopeRow(fixture.envelopeId))?.rowVersion).toBe(1);

    const provider = providerId();
    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: fixture.placeholderProviderEnvelopeId,
      providerEnvelopeId: provider,
      state: "sent",
      requestId: label("esign-bind"),
    });

    // The envelope's own counter did move to 2. The agreement sequence must not
    // have taken that number from it.
    const envelope = await envelopeRow(fixture.envelopeId);
    expect(envelope?.rowVersion).toBe(2);
    expect(envelope?.providerEnvelopeId).toBe(provider);
    expect(envelope?.state).toBe("sent");

    expect(await draftVersion(fixture.draftId)).toBe(3);
    expect(await agreementEvents(fixture.draftId)).toEqual([
      { aggregateVersion: 1, eventType: "agreement.customer_paper_uploaded" },
      { aggregateVersion: 2, eventType: "agreement.envelope_created" },
      { aggregateVersion: 3, eventType: "agreement.envelope_provider_linked" },
    ]);
    expect(await outboxVersions(fixture.draftId)).toEqual([1, 2, 3]);

    const binding = await bindingRow(provider);
    expect(binding?.aggregateType).toBe("agreement");
    expect(binding?.aggregateId).toBe(fixture.draftId);
  });

  it("keeps the sequence contiguous when the provider reports a second state", async () => {
    const fixture = await counterSignedEnvelope(label("advance"));
    const provider = providerId();
    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: fixture.placeholderProviderEnvelopeId,
      providerEnvelopeId: provider,
      state: "created",
      requestId: label("esign-bind-a"),
    });
    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: provider,
      providerEnvelopeId: provider,
      state: "sent",
      requestId: label("esign-bind-b"),
    });

    // Two envelope updates, two agreement events, no shared version. The
    // envelope counter reached 3 here; the agreement sequence is its own.
    expect((await envelopeRow(fixture.envelopeId))?.rowVersion).toBe(3);
    expect(await draftVersion(fixture.draftId)).toBe(4);
    expect(
      (await agreementEvents(fixture.draftId)).map(
        (event) => event.aggregateVersion,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  /*
   * The ordinary single-signature session: one signer, `redirect` mode, and a
   * provider that echoes back the reference it was handed in the state the
   * envelope already holds. The early return skips the envelope update, so this
   * is the only shape in which the unfixed method ever completed -- and so the
   * case a fix could most easily break by turning a no-op into a version bump.
   */
  it("leaves the draft untouched when the provider echoes the same id and state", async () => {
    const fixture = await counterSignedEnvelope(label("echo"));
    expect((await envelopeRow(fixture.envelopeId))?.state).toBe("created");

    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: fixture.placeholderProviderEnvelopeId,
      providerEnvelopeId: fixture.placeholderProviderEnvelopeId,
      state: "created",
      requestId: label("esign-echo"),
    });

    expect((await envelopeRow(fixture.envelopeId))?.rowVersion).toBe(1);
    expect(await draftVersion(fixture.draftId)).toBe(2);
    expect(
      (await agreementEvents(fixture.draftId)).map(
        (event) => event.aggregateVersion,
      ),
    ).toEqual([1, 2]);
    // The binding row is still recorded; only the versioned write is skipped.
    expect(
      (await bindingRow(fixture.placeholderProviderEnvelopeId))?.aggregateId,
    ).toBe(fixture.draftId);
  });

  it("redelivers the same provider binding without appending a second event", async () => {
    const fixture = await counterSignedEnvelope(label("replay"));
    const provider = providerId();
    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: fixture.placeholderProviderEnvelopeId,
      providerEnvelopeId: provider,
      state: "sent",
      requestId: label("esign-replay-a"),
    });
    await sessions.persistProviderBinding({
      envelopeId: fixture.envelopeId,
      expectedProviderEnvelopeId: provider,
      providerEnvelopeId: provider,
      state: "sent",
      requestId: label("esign-replay-b"),
    });

    // At-least-once delivery must not churn the agreement sequence.
    expect(await draftVersion(fixture.draftId)).toBe(3);
    expect(
      (await agreementEvents(fixture.draftId)).map(
        (event) => event.aggregateVersion,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("still refuses a binding that repoints the envelope at another provider id", async () => {
    const fixture = await counterSignedEnvelope(label("conflict"));
    await expect(
      sessions.persistProviderBinding({
        envelopeId: fixture.envelopeId,
        expectedProviderEnvelopeId: providerId(),
        providerEnvelopeId: providerId(),
        state: "sent",
        requestId: label("esign-conflict"),
      }),
    ).rejects.toThrow("E_SIGNING_PROVIDER_BINDING_CONFLICT");
    // A refused binding must not have advanced either counter.
    expect(await draftVersion(fixture.draftId)).toBe(2);
    expect((await envelopeRow(fixture.envelopeId))?.rowVersion).toBe(1);
  });
});
