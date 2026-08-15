import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  agreementTemplates,
  auditEvents,
  creditNotes,
  disputeCases,
  documents,
  invoices,
  organizations,
  orders,
  payments,
  quotes,
  refunds,
  webhookEvents,
} from "../../schema";
import { collectionActions, collectionCases } from "../../schema/core/finance";
import {
  lifecycleAgreementTemplateTexts,
  lifecycleProvisioningAttempts,
  lifecycleSignatureEnvelopes,
} from "../../schema/lifecycle";
import {
  providerProjectionCheckpoints,
  providerResourceBindings,
} from "../../schema/system";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

type JsonRecord = Record<string, unknown>;

export interface ProviderResourceBinding {
  provider: string;
  providerResourceType: string;
  providerResourceId: string;
  aggregateType: string;
  aggregateId: string;
  binding: JsonRecord;
}

/** Service-owned immutable mapping used to authenticate inbound resource IDs. */
export class DatabaseProviderResourceBindingStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async save(input: ProviderResourceBinding): Promise<void> {
    await withInternalTransaction(
      this.database,
      `provider-binding:${input.provider}:${input.providerResourceId}`,
      async (transaction) => {
        const [inserted] = await transaction
          .insert(providerResourceBindings)
          .values(input)
          .onConflictDoNothing()
          .returning({ id: providerResourceBindings.id });
        if (inserted) return;
        const existing =
          await transaction.query.providerResourceBindings.findFirst({
            where: and(
              eq(providerResourceBindings.provider, input.provider),
              eq(
                providerResourceBindings.providerResourceType,
                input.providerResourceType,
              ),
              eq(
                providerResourceBindings.providerResourceId,
                input.providerResourceId,
              ),
            ),
          });
        if (
          !existing ||
          existing.aggregateType !== input.aggregateType ||
          existing.aggregateId !== input.aggregateId ||
          stableJson(existing.binding) !== stableJson(input.binding)
        )
          throw new Error("Provider resource binding conflict");
      },
    );
  }

  public async find(input: {
    provider: string;
    providerResourceType: string;
    providerResourceId: string;
  }): Promise<ProviderResourceBinding | undefined> {
    return withInternalTransaction(
      this.database,
      `provider-binding-read:${input.provider}:${input.providerResourceId}`,
      async (transaction) => {
        const row = await transaction.query.providerResourceBindings.findFirst({
          where: and(
            eq(providerResourceBindings.provider, input.provider),
            eq(
              providerResourceBindings.providerResourceType,
              input.providerResourceType,
            ),
            eq(
              providerResourceBindings.providerResourceId,
              input.providerResourceId,
            ),
          ),
        });
        return row
          ? {
              provider: row.provider,
              providerResourceType: row.providerResourceType,
              providerResourceId: row.providerResourceId,
              aggregateType: row.aggregateType,
              aggregateId: row.aggregateId,
              binding: jsonRecord(row.binding),
            }
          : undefined;
      },
    );
  }
}

export interface WorkosOrganizationProvisioningTarget {
  organizationId: string;
  accountId: string;
  legalName: string;
  workosOrganizationId?: string;
  completed: boolean;
}

/** Persists the WorkOS organization identity and enforced MFA result atomically. */
export class DatabaseWorkosOrganizationProvisioningStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public load(
    organizationId: string,
    requestId: string,
  ): Promise<WorkosOrganizationProvisioningTarget> {
    return withInternalTransaction(
      this.database,
      requestId,
      async (transaction) => {
        const organization = await transaction.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
        });
        if (!organization)
          throw new Error("WORKOS_ORGANIZATION_TARGET_NOT_FOUND");
        const binding =
          await transaction.query.providerResourceBindings.findFirst({
            where: and(
              eq(providerResourceBindings.provider, "workos"),
              eq(providerResourceBindings.providerResourceType, "organization"),
              eq(providerResourceBindings.aggregateType, "organization"),
              eq(providerResourceBindings.aggregateId, organizationId),
            ),
          });
        const details = binding ? jsonRecord(binding.binding) : undefined;
        const persistedPolicy = details?.mfaPolicy;
        return {
          organizationId: organization.id,
          accountId: organization.accountId,
          legalName: organization.name,
          ...(organization.workosOrganizationId
            ? { workosOrganizationId: organization.workosOrganizationId }
            : {}),
          completed:
            Boolean(binding) &&
            binding?.providerResourceId === organization.workosOrganizationId &&
            persistedPolicy === "required",
        };
      },
    );
  }

  public persist(input: {
    organizationId: string;
    accountId: string;
    workosOrganizationId: string;
    mfaPolicy: "required" | "inherited_from_sso";
    requestId: string;
  }): Promise<void> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const organization = await transaction.query.organizations.findFirst({
          where: and(
            eq(organizations.id, input.organizationId),
            eq(organizations.accountId, input.accountId),
          ),
        });
        if (!organization)
          throw new Error("WORKOS_ORGANIZATION_TARGET_NOT_FOUND");
        if (
          organization.workosOrganizationId &&
          organization.workosOrganizationId !== input.workosOrganizationId
        )
          throw new Error("WORKOS_ORGANIZATION_BINDING_CONFLICT");
        const binding = {
          mfaPolicy: input.mfaPolicy,
          mfaEnforced: input.mfaPolicy === "required",
        };
        const inserted = await transaction
          .insert(providerResourceBindings)
          .values({
            provider: "workos",
            providerResourceType: "organization",
            providerResourceId: input.workosOrganizationId,
            aggregateType: "organization",
            aggregateId: input.organizationId,
            binding,
          })
          .onConflictDoNothing()
          .returning({ id: providerResourceBindings.id });
        if (inserted.length === 0) {
          const existing =
            await transaction.query.providerResourceBindings.findFirst({
              where: and(
                eq(providerResourceBindings.provider, "workos"),
                eq(
                  providerResourceBindings.providerResourceType,
                  "organization",
                ),
                eq(
                  providerResourceBindings.providerResourceId,
                  input.workosOrganizationId,
                ),
              ),
            });
          if (
            !existing ||
            existing.aggregateType !== "organization" ||
            existing.aggregateId !== input.organizationId ||
            stableJson(jsonRecord(existing.binding)) !== stableJson(binding)
          )
            throw new Error("WORKOS_ORGANIZATION_BINDING_CONFLICT");
        }
        if (organization.workosOrganizationId) return;
        const [updated] = await transaction
          .update(organizations)
          .set({ workosOrganizationId: input.workosOrganizationId })
          .where(
            and(
              eq(organizations.id, input.organizationId),
              sql`${organizations.workosOrganizationId} is null`,
            ),
          )
          .returning({ rowVersion: organizations.rowVersion });
        if (!updated) throw new Error("WORKOS_ORGANIZATION_BINDING_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          accountId: input.accountId,
          aggregateType: "organization",
          aggregateId: input.organizationId,
          aggregateVersion: updated.rowVersion,
          eventType: "organization.identity_provider_linked",
          actor: { kind: "system", id: "workos-organization-outbox" },
          requestId: input.requestId,
          before: { workosOrganizationId: null },
          after: {
            workosOrganizationId: input.workosOrganizationId,
            mfaPolicy: input.mfaPolicy,
          },
        });
      },
    );
  }
}

/** Read shape required by EsignWebhookVerifier; provider IDs stay server-side. */
export class DatabaseEsignEnvelopeLookup {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async findByProviderEnvelopeId(providerEnvelopeId: string) {
    return withInternalTransaction(
      this.database,
      `esign-binding:${providerEnvelopeId}`,
      async (transaction) => {
        const row =
          await transaction.query.lifecycleSignatureEnvelopes.findFirst({
            where: eq(
              lifecycleSignatureEnvelopes.providerEnvelopeId,
              providerEnvelopeId,
            ),
          });
        return row
          ? {
              envelopeId: row.id,
              providerEnvelopeId: row.providerEnvelopeId,
              accountId: ids.account.parse(row.accountId),
              documentId: ids.document.parse(row.documentId),
              state: esignEnvelopeState(row.state),
              signingMode: signingMode(row.signingMode),
              signingUrl: "",
              signers: [],
              createdAt: row.createdAt.toISOString(),
            }
          : undefined;
      },
    );
  }
}

/** Durable bridge between a commerce envelope and immutable signing bytes. */
export class DatabaseEsignSigningSessionRepository {
  public constructor(private readonly database: RuntimeDatabase) {}

  public load(input: {
    envelopeId: string;
    accountId: string;
    documentId: string;
    requestId: string;
  }) {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const envelope =
          await transaction.query.lifecycleSignatureEnvelopes.findFirst({
            where: and(
              eq(lifecycleSignatureEnvelopes.id, input.envelopeId),
              eq(lifecycleSignatureEnvelopes.accountId, input.accountId),
              eq(lifecycleSignatureEnvelopes.documentId, input.documentId),
            ),
          });
        if (!envelope) throw new Error("E_SIGNING_ENVELOPE_BINDING_NOT_FOUND");
        const document = await transaction.query.documents.findFirst({
          where: and(
            eq(documents.id, envelope.documentId),
            eq(documents.accountId, envelope.accountId),
          ),
        });
        if (!document) throw new Error("E_SIGNING_DOCUMENT_NOT_FOUND");
        return {
          envelopeId: envelope.id,
          providerEnvelopeId: envelope.providerEnvelopeId,
          accountId: envelope.accountId,
          documentId: envelope.documentId,
          signerEmail: envelope.signerEmail,
          mode: signingMode(envelope.signingMode),
          returnUrl: envelope.returnUrl,
          storageKey: document.storageKey,
          storageVersionId: document.storageVersionId,
          contentHash: document.contentHash,
          mimeType: document.mimeType,
          byteLength: document.byteLength.toString(),
        };
      },
    );
  }

  public persistProviderBinding(input: {
    envelopeId: string;
    expectedProviderEnvelopeId: string;
    providerEnvelopeId: string;
    state: "created" | "sent";
    requestId: string;
  }): Promise<void> {
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const envelope =
          await transaction.query.lifecycleSignatureEnvelopes.findFirst({
            where: eq(lifecycleSignatureEnvelopes.id, input.envelopeId),
          });
        if (!envelope) throw new Error("E_SIGNING_ENVELOPE_BINDING_NOT_FOUND");
        if (
          envelope.providerEnvelopeId !== input.expectedProviderEnvelopeId &&
          envelope.providerEnvelopeId !== input.providerEnvelopeId
        )
          throw new Error("E_SIGNING_PROVIDER_BINDING_CONFLICT");
        const binding = {
          commerceEnvelopeId: input.envelopeId,
          accountId: envelope.accountId,
          documentId: envelope.documentId,
        };
        const inserted = await transaction
          .insert(providerResourceBindings)
          .values({
            provider: "esign",
            providerResourceType: "envelope",
            providerResourceId: input.providerEnvelopeId,
            aggregateType: "agreement",
            aggregateId: envelope.agreementDraftId,
            binding,
          })
          .onConflictDoNothing()
          .returning({ id: providerResourceBindings.id });
        if (inserted.length === 0) {
          const existing =
            await transaction.query.providerResourceBindings.findFirst({
              where: and(
                eq(providerResourceBindings.provider, "esign"),
                eq(providerResourceBindings.providerResourceType, "envelope"),
                eq(
                  providerResourceBindings.providerResourceId,
                  input.providerEnvelopeId,
                ),
              ),
            });
          if (
            !existing ||
            existing.aggregateId !== envelope.agreementDraftId ||
            stableJson(jsonRecord(existing.binding)) !== stableJson(binding)
          )
            throw new Error("E_SIGNING_PROVIDER_BINDING_CONFLICT");
        }
        if (
          envelope.providerEnvelopeId === input.providerEnvelopeId &&
          envelope.state === input.state
        )
          return;
        const [updated] = await transaction
          .update(lifecycleSignatureEnvelopes)
          .set({
            providerEnvelopeId: input.providerEnvelopeId,
            state: input.state,
          })
          .where(
            and(
              eq(lifecycleSignatureEnvelopes.id, input.envelopeId),
              eq(
                lifecycleSignatureEnvelopes.providerEnvelopeId,
                envelope.providerEnvelopeId,
              ),
            ),
          )
          .returning({ rowVersion: lifecycleSignatureEnvelopes.rowVersion });
        if (!updated) throw new Error("E_SIGNING_PROVIDER_BINDING_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          accountId: envelope.accountId,
          aggregateType: "agreement",
          aggregateId: envelope.agreementDraftId,
          aggregateVersion: updated.rowVersion,
          eventType: "agreement.envelope_provider_linked",
          actor: { kind: "provider", id: "esign" },
          requestId: input.requestId,
          before: { providerEnvelopeId: envelope.providerEnvelopeId },
          after: {
            providerEnvelopeId: input.providerEnvelopeId,
            state: input.state,
          },
        });
      },
    );
  }
}

/** Read shape required by ProvisioningWebhookVerifier. */
export class DatabaseProvisioningExpectationLookup {
  public constructor(private readonly database: RuntimeDatabase) {}

  public register(input: {
    operationId: string;
    commandType: "provision" | "teardown";
    organizationId: string;
    orderId?: string;
    commandFingerprint?: string;
  }): Promise<"created" | "existing" | "conflict"> {
    return withInternalTransaction(
      this.database,
      `provisioning-register:${input.operationId}`,
      async (transaction) => {
        const existing =
          await transaction.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(
              lifecycleProvisioningAttempts.providerOperationId,
              input.operationId,
            ),
          });
        if (existing)
          return existing.organizationId === input.organizationId &&
            existing.operation === input.commandType &&
            existing.orderId === (input.orderId ?? null)
            ? "existing"
            : "conflict";
        const candidate =
          await transaction.query.lifecycleProvisioningAttempts.findFirst({
            where: and(
              eq(
                lifecycleProvisioningAttempts.organizationId,
                input.organizationId,
              ),
              eq(lifecycleProvisioningAttempts.operation, input.commandType),
              input.orderId
                ? eq(lifecycleProvisioningAttempts.orderId, input.orderId)
                : isNull(lifecycleProvisioningAttempts.orderId),
              isNull(lifecycleProvisioningAttempts.providerOperationId),
            ),
            orderBy: [desc(lifecycleProvisioningAttempts.createdAt)],
          });
        if (!candidate) return "conflict";
        const updated = await transaction
          .update(lifecycleProvisioningAttempts)
          .set({ providerOperationId: input.operationId })
          .where(
            and(
              eq(lifecycleProvisioningAttempts.id, candidate.id),
              isNull(lifecycleProvisioningAttempts.providerOperationId),
            ),
          )
          .returning({ id: lifecycleProvisioningAttempts.id });
        return updated.length === 1 ? "created" : "conflict";
      },
    );
  }

  public async get(operationId: string) {
    return withInternalTransaction(
      this.database,
      `provisioning-binding:${operationId}`,
      async (transaction) => {
        const row =
          await transaction.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(
              lifecycleProvisioningAttempts.providerOperationId,
              operationId,
            ),
          });
        if (!row) return null;
        const commandType: "provision" | "teardown" =
          row.operation === "teardown" ? "teardown" : "provision";
        return {
          operationId,
          commandType,
          organizationId: ids.organization.parse(row.organizationId),
          ...(row.orderId ? { orderId: ids.order.parse(row.orderId) } : {}),
        };
      },
    );
  }
}

export class DatabaseMarketplaceWebhookBindingStore {
  public constructor(
    private readonly bindings: DatabaseProviderResourceBindingStore,
  ) {}

  public async save(binding: {
    marketplace: "aws" | "azure" | "google";
    marketplaceAccountId: string;
    providerResourceType: "order" | "entitlement" | "subscription";
    providerResourceId: string;
    marketplaceOrderId: string;
    organizationId: string;
    accountId: string;
    orderId: string;
    providerEntitlementId?: string;
    entitlementId?: string;
  }): Promise<void> {
    await this.bindings.save({
      provider: `marketplace:${binding.marketplace}`,
      providerResourceType: binding.providerResourceType,
      providerResourceId: binding.providerResourceId,
      aggregateType: "organization",
      aggregateId: binding.organizationId,
      binding,
    });
  }

  public async find(input: {
    marketplace: string;
    providerResourceType: "order" | "entitlement" | "subscription";
    providerResourceId: string;
  }) {
    const result = await this.bindings.find({
      provider: `marketplace:${input.marketplace}`,
      providerResourceType: input.providerResourceType,
      providerResourceId: input.providerResourceId,
    });
    if (!result) return undefined;
    const value = result.binding;
    return {
      marketplace: marketplaceProvider(value.marketplace),
      marketplaceAccountId: requiredString(
        value.marketplaceAccountId,
        "marketplaceAccountId",
      ),
      providerResourceType: input.providerResourceType,
      providerResourceId: input.providerResourceId,
      marketplaceOrderId: requiredString(
        value.marketplaceOrderId,
        "marketplaceOrderId",
      ),
      organizationId: ids.organization.parse(
        requiredString(value.organizationId, "organizationId"),
      ),
      accountId: ids.account.parse(
        requiredString(value.accountId, "accountId"),
      ),
      orderId: ids.order.parse(requiredString(value.orderId, "orderId")),
      ...(typeof value.providerEntitlementId === "string"
        ? { providerEntitlementId: value.providerEntitlementId }
        : {}),
      ...(typeof value.entitlementId === "string"
        ? { entitlementId: ids.entitlement.parse(value.entitlementId) }
        : {}),
    };
  }
}

/** Durable external support-account binding; ticket content never enters it. */
export class DatabaseSupportWebhookBindingStore {
  public constructor(
    private readonly bindings: DatabaseProviderResourceBindingStore,
  ) {}

  public async save(binding: {
    provider: string;
    externalAccountId: string;
    accountId: string;
  }): Promise<void> {
    await this.bindings.save({
      provider: `support:${binding.provider}`,
      providerResourceType: "account",
      providerResourceId: binding.externalAccountId,
      aggregateType: "account",
      aggregateId: ids.account.parse(binding.accountId),
      binding,
    });
  }

  public async find(input: { provider: string; externalAccountId: string }) {
    const result = await this.bindings.find({
      provider: `support:${input.provider}`,
      providerResourceType: "account",
      providerResourceId: input.externalAccountId,
    });
    if (!result) return undefined;
    const value = result.binding;
    const provider = requiredString(value.provider, "provider");
    const externalAccountId = requiredString(
      value.externalAccountId,
      "externalAccountId",
    );
    const accountId = ids.account.parse(
      requiredString(value.accountId, "accountId"),
    );
    if (
      provider !== input.provider ||
      externalAccountId !== input.externalAccountId ||
      result.aggregateType !== "account" ||
      result.aggregateId !== accountId
    )
      throw new Error("Support webhook binding mismatch");
    return { provider, externalAccountId, accountId };
  }
}

export interface StripeFinancialProjectionEvent {
  eventId: string;
  eventType: string;
  category:
    | "customer"
    | "subscription"
    | "subscription_schedule"
    | "invoice"
    | "payment"
    | "credit_note"
    | "refund"
    | "dispute"
    | "tax"
    | "other";
  aggregateKey: string;
  occurredAt: string;
  invoiceId?: string;
  paymentIntentId?: string;
  customerId?: string;
  creditNoteId?: string;
  refundId?: string;
  disputeId?: string;
  amount?: { currency: string; minor: string };
  amountDue?: { currency: string; minor: string };
  amountPaid?: { currency: string; minor: string };
  amountRemaining?: { currency: string; minor: string };
  status?: string;
}

/**
 * Transactional Stripe projection. Stripe states no delivery order and stamps
 * `created` to the second, so nothing here may treat "arrived behind something
 * newer" as "already accounted for": every verified event is projected exactly
 * once and the reducers join rather than overwrite, which makes arrival order
 * immaterial to the money. An event that genuinely cannot be reconciled raises;
 * one that carries nothing the row does not already hold — a restated phase,
 * behind or beside the sibling that got there first — is recorded as subsumed.
 * Anything carrying money of its own is applied whatever its arrival order.
 * Every verified event therefore leaves a row or an audit row: `apply()`
 * returning void acks the inbox, so nothing may be discarded in silence.
 */
export class DatabaseStripeFinancialProjection {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async apply(event: StripeFinancialProjectionEvent): Promise<void> {
    await withInternalTransaction(
      this.database,
      `stripe-projection:${event.eventId}`,
      async (transaction) => {
        await assertVerifiedStripeInboxEvent(transaction, event);
        if (await alreadyProjected(transaction, event)) return;
        await recordProjectionCheckpoint(transaction, event);
        switch (event.category) {
          case "invoice":
            await projectInvoice(transaction, event);
            return;
          case "payment":
            await projectPayment(transaction, event);
            return;
          case "credit_note":
            await projectCreditNote(transaction, event);
            return;
          case "refund":
            await projectRefund(transaction, event);
            return;
          case "dispute":
            await projectDispute(transaction, event);
            return;
          default:
            await appendWebhookProjection(transaction, event);
        }
      },
    );
  }
}

async function assertVerifiedStripeInboxEvent(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  const inbox = await transaction.query.webhookEvents.findFirst({
    where: and(
      eq(webhookEvents.provider, "stripe"),
      eq(webhookEvents.providerEventId, event.eventId),
      eq(webhookEvents.eventType, event.eventType),
    ),
  });
  if (
    !inbox ||
    inbox.occurredAt.valueOf() !== new Date(event.occurredAt).valueOf()
  )
    throw new Error("Verified Stripe inbox event is missing or mismatched");

  const payload = jsonRecord(inbox.payload);
  const persistedEvent = jsonRecord(payload.event);
  const projectionFields = [
    "eventId",
    "eventType",
    "category",
    "aggregateKey",
    "occurredAt",
    "invoiceId",
    "paymentIntentId",
    "customerId",
    "creditNoteId",
    "refundId",
    "disputeId",
    "amount",
    "amountDue",
    "amountPaid",
    "amountRemaining",
    "status",
  ] as const;
  if (
    payload.type !== event.eventType ||
    persistedEvent.provider !== "stripe" ||
    projectionFields.some(
      (field) => stableJson(persistedEvent[field]) !== stableJson(event[field]),
    )
  )
    throw new Error(
      "Stripe projection facts do not match the signed persisted payload",
    );
}

/**
 * One Stripe event is projected at most once. Idempotency is keyed per event,
 * not per aggregate: the checkpoint below holds a single identifier for a
 * stream that delivers many, so it can never say whether THIS event has landed.
 * The projection request ID is unique per provider event, so the append-only
 * trail the projection wrote is the authoritative record of what has.
 */
async function alreadyProjected(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<boolean> {
  const projected = await transaction.query.auditEvents.findFirst({
    where: eq(auditEvents.requestId, projectionRequestId(event)),
    columns: { id: true },
  });
  return Boolean(projected);
}

function projectionRequestId(event: StripeFinancialProjectionEvent): string {
  return `stripe:${event.eventId}`;
}

/**
 * How far each aggregate's stream has advanced, for operators reading the lag.
 * It is deliberately not a gate. A monotonically-advancing watermark can only
 * answer "is this the newest event", and Stripe guarantees no delivery order,
 * so the answer "no" means "this one arrived late" — never "this one has
 * already been accounted for". Dropping on that answer discards money nobody
 * will report again; the replay guard above answers the question the watermark
 * cannot, per event rather than per aggregate.
 */
async function recordProjectionCheckpoint(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  const occurredAt = new Date(event.occurredAt);
  if (!Number.isFinite(occurredAt.valueOf()))
    throw new Error("Stripe event occurredAt is invalid");
  await transaction
    .insert(providerProjectionCheckpoints)
    .values({
      provider: "stripe",
      aggregateKey: event.aggregateKey,
      providerEventId: event.eventId,
      occurredAt,
    })
    .onConflictDoUpdate({
      target: [
        providerProjectionCheckpoints.provider,
        providerProjectionCheckpoints.aggregateKey,
      ],
      set: {
        providerEventId: event.eventId,
        occurredAt,
        updatedAt: new Date(),
      },
      setWhere: sql`${providerProjectionCheckpoints.occurredAt} < ${occurredAt.toISOString()}::timestamptz`,
    });
}

async function projectInvoice(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  if (!event.invoiceId)
    throw new Error("Stripe invoice event has no invoice ID");
  const before = await transaction.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, event.invoiceId),
  });
  if (!before) throw new Error("Stripe invoice is not linked to an order");
  await assertStripeInvoiceIdentity(transaction, event, before);
  // An invoice event states the invoice's running `amount_paid`, so a strictly
  // older one restating a total the row has already passed is genuinely
  // subsumed — unlike a payment event, where each intent is separate money.
  // But it is subsumed because the money is already accounted for, not because
  // it arrived late, and the two are not the same event set: an
  // `invoice.payment_succeeded` naming an intent and stating no totals is
  // accounted for by nothing but the payments sum, and dropping it leaves that
  // sum with a hole no one will ever report again.
  if (
    isSubsumedFinancialEvent(event, before) &&
    !statesUnaccountedSettlement(event, before)
  )
    return appendSubsumedProjection(transaction, event);
  if (event.amount) assertInvoiceCurrency(event.amount, before);
  assertInvoiceTotals(event, before);
  const proposed = invoiceStatus(event.eventType, event.status, before.status);
  const status = monotonicInvoiceStatus(before.status, proposed);
  // An event claiming settlement must name the intent that settled it. The
  // claim is this event's own, not the status it inherits from the row: a
  // late-delivered `invoice.updated` landing on an already-paid invoice is
  // reporting an earlier phase and owes no intent.
  if (event.paymentIntentId || proposed === "paid")
    await projectBoundPayment(transaction, event, before);
  const settled = await settledInvoiceMinor(transaction, event, before);
  const amountPaidMinor = maximumMinor(
    before.amountPaidMinor,
    status === "paid" ? maximumMinor(settled, before.amountMinor) : settled,
  );
  const [after] = await transaction
    .update(invoices)
    .set({
      status,
      amountPaidMinor,
      ...(status === "paid" && !before.paidAt
        ? { paidAt: new Date(event.occurredAt) }
        : {}),
      ...stripeOrderingColumns(event, before),
    })
    .where(
      and(
        eq(invoices.id, before.id),
        eq(invoices.rowVersion, before.rowVersion),
      ),
    )
    .returning();
  if (!after) throw new Error("Stripe invoice projection was concurrent");
  await syncCollectionCase(transaction, event, after);
  await appendFinancialProjection(transaction, event, {
    aggregateType: "invoice",
    id: after.id,
    accountId: after.accountId,
    version: after.rowVersion,
    before: {
      status: before.status,
      paidAt: before.paidAt?.toISOString(),
      amountPaidMinor: before.amountPaidMinor.toString(),
    },
    after: {
      status: after.status,
      paidAt: after.paidAt?.toISOString(),
      amountPaidMinor: after.amountPaidMinor.toString(),
      amountRemainingMinor: after.amountRemainingMinor.toString(),
    },
  });
}

async function projectPayment(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  if (!event.invoiceId)
    throw new Error("Stripe payment event has no invoice ID");
  if (!event.paymentIntentId)
    throw new Error("Stripe payment event has no payment-intent ID");
  const invoice = await transaction.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, event.invoiceId),
  });
  if (!invoice) throw new Error("Stripe payment invoice is not linked");
  await assertStripeInvoiceIdentity(transaction, event, invoice);
  const payment = await projectBoundPayment(transaction, event, invoice);
  if (payment.status !== "succeeded") return;
  // The invoice side is a join, not an assignment: `settledInvoiceMinor` reads
  // every succeeded payment on the invoice, so a late intent contributes its
  // own money and the total it produces is the same whichever order the
  // siblings arrived in.
  const amountPaidMinor = maximumMinor(
    invoice.amountPaidMinor,
    await settledInvoiceMinor(transaction, event, invoice),
  );
  // A successful intent settles what it carries. Only reaching the persisted
  // total marks the invoice paid; anything short leaves it open and collectable.
  const settledInFull = amountPaidMinor >= invoice.amountMinor;
  const status = monotonicInvoiceStatus(
    invoice.status,
    settledInFull ? "paid" : invoice.status,
  );
  const [afterInvoice] = await transaction
    .update(invoices)
    .set({
      status,
      amountPaidMinor,
      paidAt:
        status === "paid"
          ? (invoice.paidAt ?? new Date(event.occurredAt))
          : invoice.paidAt,
      ...stripeOrderingColumns(event, invoice),
    })
    .where(
      and(
        eq(invoices.id, invoice.id),
        eq(invoices.rowVersion, invoice.rowVersion),
      ),
    )
    .returning();
  if (!afterInvoice)
    throw new Error("Stripe payment invoice projection was concurrent");
  await syncCollectionCase(transaction, event, afterInvoice);
  await appendFinancialProjection(transaction, event, {
    aggregateType: "invoice",
    id: afterInvoice.id,
    accountId: afterInvoice.accountId,
    version: afterInvoice.rowVersion,
    before: {
      status: invoice.status,
      paidAt: invoice.paidAt?.toISOString(),
      amountPaidMinor: invoice.amountPaidMinor.toString(),
    },
    after: {
      status: afterInvoice.status,
      paidAt: afterInvoice.paidAt?.toISOString(),
      amountPaidMinor: afterInvoice.amountPaidMinor.toString(),
      amountRemainingMinor: afterInvoice.amountRemainingMinor.toString(),
      paymentId: payment.id,
    },
  });
}

type StripeBoundInvoice = typeof invoices.$inferSelect;
type StripePayment = typeof payments.$inferSelect;

async function assertStripeInvoiceIdentity(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): Promise<void> {
  if (event.invoiceId !== invoice.stripeInvoiceId)
    throw new Error("Stripe event invoice binding mismatch");
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, invoice.orderId),
  });
  if (!order || order.invoicingAccountId !== invoice.accountId)
    throw new Error("Stripe invoice order binding mismatch");
  if (!event.customerId) return;
  const account = await transaction.query.accounts.findFirst({
    where: eq(accounts.id, invoice.accountId),
  });
  if (
    !account?.stripeCustomerId ||
    account.stripeCustomerId !== event.customerId
  )
    throw new Error("Stripe invoice customer binding mismatch");
}

function assertInvoiceCurrency(
  amount: { currency: string; minor: string },
  invoice: StripeBoundInvoice,
): void {
  if (amount.currency !== invoice.currency)
    throw new Error("Stripe invoice currency mismatch");
}

/**
 * The invoice total is immutable and its parts must add up. Absent totals are a
 * legacy payload rather than a claim, so only what the provider states is
 * checked; anything stated that disagrees fails closed.
 */
function assertInvoiceTotals(
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): void {
  const { amountDue, amountPaid, amountRemaining } = event;
  for (const total of [amountDue, amountPaid, amountRemaining])
    if (total) assertInvoiceCurrency(total, invoice);
  if (amountDue && BigInt(amountDue.minor) !== invoice.amountMinor)
    throw new Error("Stripe invoice total does not match the persisted total");
  if (!amountDue || !amountPaid || !amountRemaining) return;
  if (
    BigInt(amountPaid.minor) + BigInt(amountRemaining.minor) !==
    BigInt(amountDue.minor)
  )
    throw new Error("Stripe invoice paid and remaining do not reconcile");
}

function maximumMinor(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

/**
 * Whether a late invoice event still carries settlement the row has not
 * accounted for. The answer is read off the event's own fields, never off its
 * arrival order, and the four shapes below are the whole input space:
 *
 * - It states `amount_paid`. That is the invoice's entire settlement position
 *   as of that moment, so if `amount_paid_minor` already holds at least as
 *   much, every intent behind the event is inside the number the row shows the
 *   customer: the invoice is not collectable for it and nobody is chased.
 * - It states `amount_paid` greater than the row holds. Money the row has never
 *   seen, so it applies.
 * - It states no totals and names an intent whose money it carries. Then this
 *   event accounts for that intent and nothing else ever will, so it applies
 *   whatever its arrival order. An intent's own `amount` is not comparable with
 *   the invoice's running total, and comparing the two is what let a 60,000
 *   second installment look "already accounted for" behind a 120,000 first one
 *   and vanish. Applying late is safe rather than double-booking:
 *   `projectBoundPayment` keys on the intent so the same intent is one row, and
 *   the invoice side is a max-join over the payments it can see.
 * - It states neither a total nor an amount to book. There is nothing this
 *   reducer could write for it.
 *
 * Every shape that was answered with a note before is still answered with one;
 * the third is the only one that changed, and it changed from a note to a row.
 */
function statesUnaccountedSettlement(
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): boolean {
  // The per-intent branch is tested FIRST, and that ordering is the whole fix.
  // normalizeStripeFinancialEvent attaches invoiceTotals to every invoice-category
  // event, and every Stripe Invoice carries amount_paid, so a total-first branch
  // answers every real event of this category and the per-intent branch below it
  // is unreachable in production. That is how a 60,000 second installment
  // arriving behind a 120,000 first one looked "already accounted for" against
  // the invoice-level running total and vanished, leaving the invoice `open` and
  // collectable with the money received and no payments row naming it.
  //
  // Whether a PER-INTENT row should exist is not answerable from an
  // INVOICE-LEVEL total, so it is no longer asked that way. Booking late is safe
  // rather than double-booking: projectBoundPayment keys on the intent, so the
  // same intent is one row however often it arrives, which makes this branch
  // commutative under reordering.
  if (event.paymentIntentId && event.amount) return true;
  if (event.amountPaid)
    return BigInt(event.amountPaid.minor) > invoice.amountPaidMinor;
  return false;
}

/**
 * Provider truth wins because `amount_paid` also carries money settled outside
 * the platform. Events without invoice totals fall back to the payments already
 * projected from signed events.
 */
async function settledInvoiceMinor(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): Promise<bigint> {
  if (event.amountPaid) return BigInt(event.amountPaid.minor);
  const settled = await transaction.query.payments.findMany({
    where: and(
      eq(payments.invoiceId, invoice.id),
      eq(payments.status, "succeeded"),
    ),
    columns: { amountMinor: true },
  });
  return settled.reduce((sum, row) => sum + row.amountMinor, 0n);
}

/**
 * Settlement closes the collection case in the same transaction as the money it
 * follows, so a replayed event finds the case already resolved and appends
 * nothing. A partial payment leaves the case and its aging where they are.
 */
async function syncCollectionCase(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): Promise<void> {
  if (invoice.amountRemainingMinor > 0n) return;
  const collectionCase = await transaction.query.collectionCases.findFirst({
    where: eq(collectionCases.invoiceId, invoice.id),
  });
  if (
    !collectionCase ||
    !["open", "promised", "escalated"].includes(collectionCase.status)
  )
    return;
  const [resolved] = await transaction
    .update(collectionCases)
    .set({
      status: "resolved",
      newServiceBlocked: false,
      runningServiceDecision: "continue",
    })
    .where(
      and(
        eq(collectionCases.id, collectionCase.id),
        eq(collectionCases.rowVersion, collectionCase.rowVersion),
      ),
    )
    .returning();
  if (!resolved) throw new Error("Collection case resolution was concurrent");
  await transaction.insert(collectionActions).values({
    collectionCaseId: resolved.id,
    action: "invoice_settled",
    actorUserId: resolved.ownerUserId,
    outcome: "resolved",
    metadata: {
      providerEventId: event.eventId,
      currency: invoice.currency,
      amountPaidMinor: invoice.amountPaidMinor.toString(),
      priorStatus: collectionCase.status,
      deletionPermitted: false,
    },
    occurredAt: new Date(event.occurredAt),
  });
}

interface StripeOrderedRow {
  stripeLastOccurredAt: Date | null;
  stripeLastEventId: string | null;
}

/**
 * Whether this event is the newest one the row has seen. It answers only
 * whether the row's ordering columns may advance, never whether the event may
 * be applied: `occurredAt` has one-second resolution and no delivery order, so
 * a same-second sibling is not newer and is not stale either.
 */
function isNewerFinancialEvent(
  event: StripeFinancialProjectionEvent,
  row: StripeOrderedRow,
): boolean {
  if (!row.stripeLastOccurredAt || !row.stripeLastEventId) return true;
  return new Date(event.occurredAt) > row.stripeLastOccurredAt;
}

/**
 * A row already carries an event Stripe stamped strictly later. Only an event
 * with nothing of its own to contribute may be answered with this: the row's
 * newer event has already stated the phase, so re-running an older one would
 * invent a conflict rather than settle one. Money-bearing joins ignore it,
 * because a late payment is still a payment — which is why the invoice reducer
 * consults it only for events that name no payment intent.
 */
function isSubsumedFinancialEvent(
  event: StripeFinancialProjectionEvent,
  row: StripeOrderedRow,
): boolean {
  if (!row.stripeLastOccurredAt || !row.stripeLastEventId) return false;
  return (
    new Date(event.occurredAt).valueOf() < row.stripeLastOccurredAt.valueOf()
  );
}

/**
 * How far along its lifecycle each status sits, for the two rows that hold one
 * provider status and no money of their own. The ranks are the persisted
 * transition rules: a credit note runs approved -> pending -> issued -> void,
 * a refund approved -> pending -> succeeded, and the two ways each can end sit
 * at the same rank because neither follows the other.
 */
const CREDIT_NOTE_STATUS_RANK: Readonly<Record<string, number>> = {
  approved: 0,
  pending: 1,
  issued: 2,
  failed: 3,
  void: 3,
};
const REFUND_STATUS_RANK: Readonly<Record<string, number>> = {
  approved: 0,
  pending: 1,
  succeeded: 2,
  failed: 2,
};

/**
 * The status a single-status row should hold after this event. Stripe stamps
 * `created` to the second and delivers in no order, so an event proposing an
 * earlier phase than the row already holds is that phase restated behind its
 * sibling — the row keeps what it has. Only two different ends of the same
 * lifecycle contradict each other, and those stop here rather than letting
 * arrival order decide. Ranking rather than listing terminal states is what
 * keeps "you arrived second" out of the set of things treated as a conflict.
 */
function joinedProviderStatus(
  current: string,
  proposed: string,
  ranks: Readonly<Record<string, number>>,
  subject: string,
): string {
  if (current === proposed) return current;
  const currentRank = ranks[current];
  const proposedRank = ranks[proposed];
  if (currentRank === undefined || proposedRank === undefined)
    throw new Error(`Stripe ${subject} status is unsupported`);
  if (proposedRank < currentRank) return current;
  if (proposedRank === currentRank)
    throw new Error(`Stripe ${subject} terminal status conflicted`);
  return proposed;
}

/**
 * The ordering columns a row should carry after this event. A late arrival
 * writes none of them, so `stripeLastOccurredAt` stays the high-water mark and
 * `updatedAt` never walks backwards — the event still applies, it just does not
 * get to claim it is the latest word.
 */
function stripeWatermarkColumns(
  event: StripeFinancialProjectionEvent,
  row: StripeOrderedRow,
): { stripeLastOccurredAt?: Date; stripeLastEventId?: string } {
  if (!isNewerFinancialEvent(event, row)) return {};
  return {
    stripeLastOccurredAt: new Date(event.occurredAt),
    stripeLastEventId: event.eventId,
  };
}

/** The watermark plus the `updated_at` the tables that carry one expect. */
function stripeOrderingColumns(
  event: StripeFinancialProjectionEvent,
  row: StripeOrderedRow,
): {
  stripeLastOccurredAt?: Date;
  stripeLastEventId?: string;
  updatedAt?: Date;
} {
  const watermark = stripeWatermarkColumns(event, row);
  return watermark.stripeLastEventId
    ? { ...watermark, updatedAt: new Date(event.occurredAt) }
    : watermark;
}

const UNSEEN_STRIPE_ROW: StripeOrderedRow = {
  stripeLastOccurredAt: null,
  stripeLastEventId: null,
};

async function projectBoundPayment(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): Promise<StripePayment> {
  if (!event.paymentIntentId)
    throw new Error("Paid Stripe event has no payment-intent ID");
  if (!event.amount)
    throw new Error("Stripe payment event has no normalized amount");
  assertInvoiceCurrency(event.amount, invoice);
  const before = await transaction.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, event.paymentIntentId),
  });
  if (
    before &&
    (before.invoiceId !== invoice.id ||
      before.orderId !== invoice.orderId ||
      before.currency !== event.amount.currency ||
      before.amountMinor !== BigInt(event.amount.minor))
  )
    throw new Error(
      "Stripe payment invoice, order, amount, or currency mismatch",
    );
  // `monotonicPaymentStatus` is a join on pending < failed < succeeded <
  // refunded, so a late event for this intent can only restate a rank the row
  // has already passed. Applying it is a no-op on the status and the audit row
  // it leaves is the record that the event landed.
  const priorStatus = before?.status ?? "pending";
  const status = monotonicPaymentStatus(
    priorStatus,
    paymentStatus(event.eventType, event.status, priorStatus),
  );
  const occurredAt = new Date(event.occurredAt);
  const values = {
    invoiceId: invoice.id,
    orderId: invoice.orderId,
    stripePaymentIntentId: event.paymentIntentId,
    currency: event.amount.currency,
    amountMinor: BigInt(event.amount.minor),
    status,
    receivedAt:
      status === "succeeded" ? (before?.receivedAt ?? occurredAt) : null,
    ...stripeOrderingColumns(event, before ?? UNSEEN_STRIPE_ROW),
  };
  const [after] = before
    ? await transaction
        .update(payments)
        .set(values)
        .where(
          and(
            eq(payments.id, before.id),
            eq(payments.rowVersion, before.rowVersion),
          ),
        )
        .returning()
    : await transaction.insert(payments).values(values).returning();
  if (!after) throw new Error("Stripe payment projection was concurrent");
  await appendFinancialProjection(transaction, event, {
    aggregateType: "payment",
    id: after.id,
    accountId: invoice.accountId,
    version: after.rowVersion,
    before: before
      ? {
          status: before.status,
          receivedAt: before.receivedAt?.toISOString(),
        }
      : { status: null, receivedAt: null },
    after: {
      status: after.status,
      receivedAt: after.receivedAt?.toISOString(),
      invoiceId: after.invoiceId,
      orderId: after.orderId,
      currency: after.currency,
      amountMinor: after.amountMinor.toString(),
      stripePaymentIntentId: after.stripePaymentIntentId,
    },
  });
  return after;
}

async function projectCreditNote(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  if (!event.creditNoteId)
    throw new Error("Stripe credit-note event has no credit-note ID");
  const before = await transaction.query.creditNotes.findFirst({
    where: eq(creditNotes.stripeCreditNoteId, event.creditNoteId),
  });
  if (!before)
    throw new Error("Stripe credit note is not linked to an invoice");
  const invoice = await transaction.query.invoices.findFirst({
    where: eq(invoices.id, before.invoiceId),
  });
  if (
    !invoice?.stripeInvoiceId ||
    event.invoiceId !== invoice.stripeInvoiceId ||
    !event.amount ||
    event.amount.currency !== before.currency ||
    BigInt(event.amount.minor) !== before.amountMinor
  )
    throw new Error("Stripe credit-note source or money binding mismatched");
  if (isSubsumedFinancialEvent(event, before))
    return appendSubsumedProjection(transaction, event);
  const proposed =
    event.eventType === "credit_note.voided" || event.status === "void"
      ? "void"
      : event.status === "issued"
        ? "issued"
        : event.status === "draft"
          ? "pending"
          : undefined;
  if (!proposed) throw new Error("Stripe credit-note status is unsupported");
  const status = joinedProviderStatus(
    before.status,
    proposed,
    CREDIT_NOTE_STATUS_RANK,
    "credit-note",
  );
  const watermark = stripeWatermarkColumns(event, before);
  // Neither the phase nor the watermark moves, so there is no row to write. The
  // persisted projection rule refuses an update that advances neither, and a
  // raise here would dead-letter a verified event forever for the crime of
  // sharing a second with the sibling that got there first. It is recorded.
  if (status === before.status && !watermark.stripeLastEventId)
    return appendSubsumedProjection(transaction, event);
  const [after] = await transaction
    .update(creditNotes)
    .set({
      status,
      ...watermark,
      version: sql`${creditNotes.version} + 1`,
    })
    .where(
      and(
        eq(creditNotes.id, before.id),
        eq(creditNotes.version, before.version),
      ),
    )
    .returning();
  if (!after) throw new Error("Stripe credit-note projection failed");
  await appendFinancialProjection(transaction, event, {
    aggregateType: "credit_note",
    id: after.id,
    accountId: invoice.accountId,
    version: after.version,
    before: { status: before.status },
    after: { status: after.status },
  });
}

async function projectRefund(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  if (!event.refundId) throw new Error("Stripe refund event has no refund ID");
  const before = await transaction.query.refunds.findFirst({
    where: eq(refunds.stripeRefundId, event.refundId),
  });
  if (!before) throw new Error("Stripe refund is not linked to a payment");
  const payment = await transaction.query.payments.findFirst({
    where: eq(payments.id, before.paymentId),
  });
  if (
    !payment ||
    event.paymentIntentId !== payment.stripePaymentIntentId ||
    !event.amount ||
    event.amount.currency !== before.currency ||
    BigInt(event.amount.minor) !== before.amountMinor
  )
    throw new Error("Stripe refund source or money binding mismatched");
  if (isSubsumedFinancialEvent(event, before))
    return appendSubsumedProjection(transaction, event);
  const proposed =
    event.eventType === "refund.created"
      ? before.status
      : event.eventType === "refund.updated" &&
          (event.status === "pending" || event.status === "requires_action")
        ? "pending"
        : event.eventType === "refund.updated" && event.status === "succeeded"
          ? "succeeded"
          : event.eventType === "refund.updated" &&
              (event.status === "failed" || event.status === "canceled")
            ? "failed"
            : undefined;
  if (!proposed) throw new Error("Stripe refund status is unsupported");
  const status = joinedProviderStatus(
    before.status,
    proposed,
    REFUND_STATUS_RANK,
    "refund",
  );
  const watermark = stripeWatermarkColumns(event, before);
  // As above: an event that moves neither the phase nor the watermark has
  // nothing to write, and must be recorded rather than dead-lettered.
  if (status === before.status && !watermark.stripeLastEventId)
    return appendSubsumedProjection(transaction, event);
  const [after] = await transaction
    .update(refunds)
    .set({
      status,
      ...watermark,
      version: sql`${refunds.version} + 1`,
    })
    .where(and(eq(refunds.id, before.id), eq(refunds.version, before.version)))
    .returning();
  if (!after) throw new Error("Stripe refund projection failed");
  const invoice = payment
    ? await transaction.query.invoices.findFirst({
        where: eq(invoices.id, payment.invoiceId),
      })
    : undefined;
  if (!invoice) throw new Error("Stripe refund invoice is missing");
  await appendFinancialProjection(transaction, event, {
    aggregateType: "refund",
    id: after.id,
    accountId: invoice.accountId,
    version: after.version,
    before: { status: before.status },
    after: { status: after.status },
  });
}

async function projectDispute(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  if (!event.disputeId)
    throw new Error("Stripe dispute event has no dispute ID");
  const before = await transaction.query.disputeCases.findFirst({
    where: eq(disputeCases.stripeDisputeId, event.disputeId),
  });
  if (!before) throw new Error("Stripe dispute is not linked to a payment");
  const status = disputeStatus(event.eventType, event.status, before.status);
  const [after] = await transaction
    .update(disputeCases)
    .set({ status })
    .where(eq(disputeCases.id, before.id))
    .returning();
  if (!after) throw new Error("Stripe dispute projection failed");
  const payment = await transaction.query.payments.findFirst({
    where: eq(payments.id, after.paymentId),
  });
  const invoice = payment
    ? await transaction.query.invoices.findFirst({
        where: eq(invoices.id, payment.invoiceId),
      })
    : undefined;
  if (!invoice) throw new Error("Stripe dispute invoice is missing");
  await appendFinancialProjection(transaction, event, {
    aggregateType: "dispute_case",
    id: after.id,
    accountId: invoice.accountId,
    version: after.rowVersion,
    before: { status: before.status },
    after: { status: after.status },
  });
}

async function appendFinancialProjection(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  input: {
    aggregateType:
      "invoice" | "payment" | "credit_note" | "refund" | "dispute_case";
    id: string;
    accountId: string;
    version: number;
    before: JsonRecord;
    after: JsonRecord;
  },
) {
  await appendAuditAndOutbox(transaction, {
    accountId: input.accountId,
    aggregateType: input.aggregateType,
    aggregateId: input.id,
    aggregateVersion: input.version,
    eventType: `provider.stripe.${event.eventType}`,
    actor: { kind: "provider", id: "stripe" },
    requestId: projectionRequestId(event),
    before: input.before,
    after: { ...input.after, providerEventId: event.eventId },
    occurredAt: new Date(event.occurredAt),
  });
}

/**
 * A verified event with no column left to move: its row already holds the phase
 * it proposes, or a later one, and it is not the newest event the row has seen.
 * There is nothing to write and nothing in conflict. It is still a delivered
 * money event, so it is recorded rather than acked into nothing.
 */
function appendSubsumedProjection(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<void> {
  return appendWebhookProjection(
    transaction,
    event,
    "subsumed_by_newer_provider_event",
  );
}

async function appendWebhookProjection(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  disposition = "verified_no_financial_projection",
) {
  const webhook = await transaction.query.webhookEvents.findFirst({
    where: and(
      eq(webhookEvents.provider, "stripe"),
      eq(webhookEvents.providerEventId, event.eventId),
    ),
  });
  if (!webhook) throw new Error("Verified Stripe inbox event is missing");
  await appendAuditAndOutbox(transaction, {
    aggregateType: "webhook_event",
    aggregateId: webhook.id,
    aggregateVersion: webhook.attemptCount,
    eventType: `provider.stripe.${event.eventType}`,
    actor: { kind: "provider", id: "stripe" },
    requestId: projectionRequestId(event),
    after: {
      providerEventId: event.eventId,
      category: event.category,
      disposition,
    },
    occurredAt: new Date(event.occurredAt),
  });
}

export interface CustomerPaymentTarget {
  invoiceId: string;
  accountId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  currency: string;
  amountMinor: string;
  invoiceStatus: "open";
}

export class DatabaseCustomerPaymentTargetRepository {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly authorizationSecret: string,
  ) {}

  public async resolve(input: {
    invoiceId: string;
    accountId: string;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<CustomerPaymentTarget> {
    return withAuthorizedTransaction(
      this.database,
      {
        userId: input.authorization.userId,
        accountIds: input.authorization.accountIds,
        roles: input.authorization.roles,
        isInternalStaff: input.authorization.isInternalStaff,
        requestId: input.requestId,
      },
      { secret: this.authorizationSecret },
      async (transaction) => {
        const invoice = await transaction.query.invoices.findFirst({
          where: and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.accountId, input.accountId),
          ),
        });
        if (!invoice) throw new Error("Invoice was not found in account scope");
        if (invoice.status !== "open")
          throw new Error("Only an open Stripe invoice can start payment");
        if (!invoice.stripeInvoiceId)
          throw new Error("Open invoice has no linked Stripe invoice");
        const account = await transaction.query.accounts.findFirst({
          where: eq(accounts.id, invoice.accountId),
        });
        if (!account?.stripeCustomerId)
          throw new Error("Account has no linked Stripe customer");
        return {
          invoiceId: invoice.id,
          accountId: invoice.accountId,
          stripeInvoiceId: invoice.stripeInvoiceId,
          stripeCustomerId: account.stripeCustomerId,
          currency: invoice.currency,
          amountMinor: invoice.amountMinor.toString(),
          invoiceStatus: "open" as const,
        };
      },
    );
  }
}

export type ArtifactKind =
  "agreement_template" | "quote" | "partner_quote" | "order_form";

export interface ImmutableArtifactMetadata {
  artifactKind: ArtifactKind;
  artifactId: string;
  documentId: string;
  accountId: string | null;
  storageKey: string;
  storageVersionId: string;
  contentHash: string;
  mimeType: string;
  byteLength: string;
  retainUntil: string;
  legalHold: boolean;
}

export class DatabaseImmutableArtifactRepository {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly serviceDatabase: RuntimeDatabase,
    private readonly authorizationSecret: string,
  ) {}

  public async find(input: {
    artifactKind: ArtifactKind;
    artifactId: string;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<ImmutableArtifactMetadata> {
    const documentId = await withAuthorizedTransaction(
      this.database,
      {
        userId: input.authorization.userId,
        accountIds: input.authorization.accountIds,
        roles: input.authorization.roles,
        isInternalStaff: input.authorization.isInternalStaff,
        requestId: input.requestId,
      },
      { secret: this.authorizationSecret },
      async (transaction) => resolveArtifactDocumentId(transaction, input),
    );
    return withInternalTransaction(
      this.serviceDatabase,
      input.requestId,
      async (transaction) => {
        const document = await transaction.query.documents.findFirst({
          where: eq(documents.id, documentId),
        });
        if (!document) throw new Error("Artifact document was not found");
        return {
          artifactKind: input.artifactKind,
          artifactId: input.artifactId,
          documentId: document.id,
          accountId: document.accountId,
          storageKey: document.storageKey,
          storageVersionId: document.storageVersionId,
          contentHash: document.contentHash,
          mimeType: document.mimeType,
          byteLength: document.byteLength.toString(),
          retainUntil: document.retainUntil.toISOString(),
          legalHold: document.legalHold,
        };
      },
    );
  }
}

async function resolveArtifactDocumentId(
  transaction: RuntimeTransaction,
  input: { artifactKind: ArtifactKind; artifactId: string },
): Promise<string> {
  if (input.artifactKind === "agreement_template") {
    const template = await transaction.query.agreementTemplates.findFirst({
      where: and(
        eq(agreementTemplates.id, input.artifactId),
        eq(agreementTemplates.approvalStatus, "approved"),
      ),
    });
    if (!template) throw new Error("Approved agreement template was not found");
    return template.canonicalDocumentId;
  }
  if (
    input.artifactKind === "quote" ||
    input.artifactKind === "partner_quote"
  ) {
    const quote = await transaction.query.quotes.findFirst({
      where: eq(quotes.id, input.artifactId),
    });
    const documentId =
      input.artifactKind === "quote"
        ? quote?.renderedDocumentId
        : quote?.partnerDocumentId;
    if (!quote || !documentId || !quote.immutableAt)
      throw new Error("Issued immutable quote artifact was not found");
    return documentId;
  }
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, input.artifactId),
  });
  if (!order?.orderFormDocumentId || !order.immutableAt)
    throw new Error("Accepted immutable order artifact was not found");
  return order.orderFormDocumentId;
}

export interface ActiveAgreementTemplate {
  id: string;
  type: string;
  semanticVersion: string;
  jurisdiction: string;
  effectiveOn: string;
  canonicalDocumentId: string;
  exactTextHash: string;
  exactText: string;
  executionMode: string;
}

export class DatabaseActiveAgreementTemplateRepository {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly authorizationSecret: string,
  ) {}

  public async getActive(input: {
    type: string;
    jurisdiction: string;
    authorization: AuthorizationContext;
    requestId: string;
    now?: Date;
  }): Promise<ActiveAgreementTemplate> {
    return withAuthorizedTransaction(
      this.database,
      {
        userId: input.authorization.userId,
        accountIds: input.authorization.accountIds,
        roles: input.authorization.roles,
        isInternalStaff: input.authorization.isInternalStaff,
        requestId: input.requestId,
      },
      { secret: this.authorizationSecret },
      async (transaction) => {
        const today = (input.now ?? new Date()).toISOString().slice(0, 10);
        const [row] = await transaction
          .select({
            id: agreementTemplates.id,
            type: agreementTemplates.type,
            semanticVersion: agreementTemplates.semanticVersion,
            jurisdiction: agreementTemplates.jurisdiction,
            effectiveOn: agreementTemplates.effectiveOn,
            canonicalDocumentId: agreementTemplates.canonicalDocumentId,
            textHash: agreementTemplates.textHash,
            executionMode: agreementTemplates.executionMode,
            exactText: lifecycleAgreementTemplateTexts.exactText,
            persistedTextHash: lifecycleAgreementTemplateTexts.exactTextHash,
          })
          .from(agreementTemplates)
          .innerJoin(
            lifecycleAgreementTemplateTexts,
            eq(
              lifecycleAgreementTemplateTexts.templateId,
              agreementTemplates.id,
            ),
          )
          .where(
            and(
              eq(agreementTemplates.type, input.type),
              eq(agreementTemplates.jurisdiction, input.jurisdiction),
              eq(agreementTemplates.approvalStatus, "approved"),
              sql`${agreementTemplates.effectiveOn} <= ${today}`,
            ),
          )
          .orderBy(
            desc(agreementTemplates.effectiveOn),
            desc(agreementTemplates.createdAt),
          )
          .limit(1);
        if (!row) throw new Error("Active agreement template was not found");
        if (row.textHash !== row.persistedTextHash)
          throw new Error("Agreement template text binding is corrupt");
        return {
          id: row.id,
          type: row.type,
          semanticVersion: row.semanticVersion,
          jurisdiction: row.jurisdiction,
          effectiveOn: row.effectiveOn,
          canonicalDocumentId: row.canonicalDocumentId,
          exactTextHash: row.textHash,
          exactText: row.exactText,
          executionMode: row.executionMode,
        };
      },
    );
  }
}

function invoiceStatus(
  eventType: string,
  providerStatus: string | undefined,
  current: string,
): "draft" | "open" | "paid" | "void" | "uncollectible" {
  if (eventType === "invoice.paid" || eventType === "invoice.payment_succeeded")
    return "paid";
  if (eventType === "invoice.voided") return "void";
  if (eventType === "invoice.marked_uncollectible") return "uncollectible";
  return isInvoiceStatus(providerStatus)
    ? providerStatus
    : isInvoiceStatus(current)
      ? current
      : "open";
}

function monotonicInvoiceStatus(
  current: string,
  proposed: string,
): "draft" | "open" | "paid" | "void" | "uncollectible" {
  if (!isInvoiceStatus(current) || !isInvoiceStatus(proposed))
    throw new Error("Stripe invoice status is invalid");
  if (current === proposed) return current;
  if (current === "draft") return proposed === "open" ? proposed : current;
  if (current === "open")
    return proposed === "paid" ||
      proposed === "void" ||
      proposed === "uncollectible"
      ? proposed
      : current;
  return current;
}

function isInvoiceStatus(
  value: string | undefined,
): value is "draft" | "open" | "paid" | "void" | "uncollectible" {
  return ["draft", "open", "paid", "void", "uncollectible"].includes(
    value ?? "",
  );
}

function paymentStatus(
  eventType: string,
  providerStatus: string | undefined,
  current: string,
): "pending" | "succeeded" | "failed" | "refunded" {
  if (
    eventType === "payment_intent.succeeded" ||
    eventType === "invoice_payment.paid" ||
    eventType === "invoice.paid" ||
    eventType === "invoice.payment_succeeded"
  )
    return "succeeded";
  if (
    eventType === "payment_intent.payment_failed" ||
    eventType === "payment_intent.canceled" ||
    eventType === "invoice_payment.failed" ||
    eventType === "invoice.payment_failed"
  )
    return "failed";
  if (eventType === "charge.refunded") return "refunded";
  if (providerStatus === "succeeded") return "succeeded";
  return isPaymentStatus(current) ? current : "pending";
}

function monotonicPaymentStatus(
  current: string,
  proposed: string,
): "pending" | "succeeded" | "failed" | "refunded" {
  if (!isPaymentStatus(current) || !isPaymentStatus(proposed))
    throw new Error("Stripe payment status is invalid");
  if (current === proposed) return current;
  if (current === "pending") return proposed;
  if (current === "failed")
    return proposed === "succeeded" ? proposed : current;
  if (current === "succeeded")
    return proposed === "refunded" ? proposed : current;
  return current;
}

function isPaymentStatus(
  value: string,
): value is "pending" | "succeeded" | "failed" | "refunded" {
  return ["pending", "succeeded", "failed", "refunded"].includes(value);
}

/**
 * Stripe's dispute vocabulary is `warning_needs_response`,
 * `warning_under_review`, `warning_closed`, `needs_response`, `under_review`,
 * `won` and `lost`, and only `won` and `lost` are outcomes: once a dispute
 * closes on one of them it does not reopen. Deliveries are unordered, so a
 * later-delivered phase event restates where the dispute has been, never where
 * it now is, and must not pull a closed one back into the evidence queue. Two
 * closures that disagree are a real contradiction and stop here rather than
 * letting arrival order decide who owns the money.
 */
function disputeStatus(
  eventType: string,
  providerStatus: string | undefined,
  current: string,
): "needs_response" | "under_review" | "won" | "lost" {
  const proposed = proposedDisputeStatus(eventType, providerStatus, current);
  if (!isDisputeStatus(current) || current === proposed) return proposed;
  if (!isDisputeOutcome(current)) return proposed;
  if (!isDisputeOutcome(proposed) || !eventType.endsWith(".closed"))
    return current;
  throw new Error("Stripe dispute outcome conflicted");
}

function proposedDisputeStatus(
  eventType: string,
  providerStatus: string | undefined,
  current: string,
): "needs_response" | "under_review" | "won" | "lost" {
  // Only a closure states an outcome, and only for the two statuses that are
  // one. `warning_closed` ends an inquiry without deciding anything, and funds
  // move out when a dispute opens rather than when it is lost, so neither may
  // record a loss the provider has not declared.
  if (
    eventType.endsWith(".closed") &&
    providerStatus !== undefined &&
    isDisputeOutcome(providerStatus)
  )
    return providerStatus;
  if (eventType.endsWith(".funds_reinstated")) return "won";
  if (
    providerStatus === "warning_needs_response" ||
    providerStatus === "needs_response"
  )
    return "needs_response";
  if (isDisputeStatus(current)) return current;
  return "under_review";
}

function isDisputeOutcome(value: string): value is "won" | "lost" {
  return value === "won" || value === "lost";
}

function isDisputeStatus(
  value: string,
): value is "needs_response" | "under_review" | "won" | "lost" {
  return ["needs_response", "under_review", "won", "lost"].includes(value);
}

function jsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider binding payload is invalid");
  return Object.fromEntries(Object.entries(value));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Provider binding ${name} is invalid`);
  return value;
}

function marketplaceProvider(value: unknown): "aws" | "azure" | "google" {
  if (value === "aws" || value === "azure" || value === "google") return value;
  throw new Error("Provider binding marketplace is invalid");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function esignEnvelopeState(
  value: string,
): "created" | "sent" | "viewed" | "completed" | "declined" | "voided" {
  if (
    value === "created" ||
    value === "sent" ||
    value === "viewed" ||
    value === "completed" ||
    value === "declined" ||
    value === "voided"
  )
    return value;
  throw new Error("E-sign envelope has an unsupported provider state");
}

function signingMode(value: string): "redirect" | "embedded" {
  if (value === "redirect" || value === "embedded") return value;
  throw new Error("E-sign envelope has an invalid signing mode");
}
