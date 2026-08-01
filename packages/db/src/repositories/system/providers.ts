import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  agreementTemplates,
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
  status?: string;
}

/** Transactional Stripe projection with an out-of-order fail-closed watermark. */
export class DatabaseStripeFinancialProjection {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async apply(event: StripeFinancialProjectionEvent): Promise<void> {
    await withInternalTransaction(
      this.database,
      `stripe-projection:${event.eventId}`,
      async (transaction) => {
        await assertVerifiedStripeInboxEvent(transaction, event);
        const current = await claimProjectionCheckpoint(transaction, event);
        if (!current) return;
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

async function claimProjectionCheckpoint(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
): Promise<boolean> {
  const occurredAt = new Date(event.occurredAt);
  if (!Number.isFinite(occurredAt.valueOf()))
    throw new Error("Stripe event occurredAt is invalid");
  const rows = await transaction
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
      setWhere: sql`${providerProjectionCheckpoints.occurredAt} < ${occurredAt.toISOString()}::timestamptz
        or (${providerProjectionCheckpoints.occurredAt} = ${occurredAt.toISOString()}::timestamptz
          and ${providerProjectionCheckpoints.providerEventId} < ${event.eventId})`,
    })
    .returning({ id: providerProjectionCheckpoints.id });
  return rows.length === 1;
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
  if (!isNewerFinancialEvent(event, before)) return;
  if (event.amount) assertInvoiceAmount(event.amount, before);
  const proposed = invoiceStatus(event.eventType, event.status, before.status);
  const status = monotonicInvoiceStatus(before.status, proposed);
  if (event.paymentIntentId || status === "paid")
    await projectBoundPayment(transaction, event, before);
  const [after] = await transaction
    .update(invoices)
    .set({
      status,
      ...(status === "paid" && !before.paidAt
        ? { paidAt: new Date(event.occurredAt) }
        : {}),
      stripeLastOccurredAt: new Date(event.occurredAt),
      stripeLastEventId: event.eventId,
      updatedAt: new Date(event.occurredAt),
    })
    .where(
      and(
        eq(invoices.id, before.id),
        eq(invoices.rowVersion, before.rowVersion),
      ),
    )
    .returning();
  if (!after) throw new Error("Stripe invoice projection was concurrent");
  await appendFinancialProjection(transaction, event, {
    aggregateType: "invoice",
    id: after.id,
    accountId: after.accountId,
    version: after.rowVersion,
    before: { status: before.status, paidAt: before.paidAt?.toISOString() },
    after: { status: after.status, paidAt: after.paidAt?.toISOString() },
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
  if (!isNewerFinancialEvent(event, invoice)) return;
  const status = monotonicInvoiceStatus(invoice.status, "paid");
  const [afterInvoice] = await transaction
    .update(invoices)
    .set({
      status,
      paidAt: invoice.paidAt ?? new Date(event.occurredAt),
      stripeLastOccurredAt: new Date(event.occurredAt),
      stripeLastEventId: event.eventId,
      updatedAt: new Date(event.occurredAt),
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
  await appendFinancialProjection(transaction, event, {
    aggregateType: "invoice",
    id: afterInvoice.id,
    accountId: afterInvoice.accountId,
    version: afterInvoice.rowVersion,
    before: { status: invoice.status, paidAt: invoice.paidAt?.toISOString() },
    after: {
      status: afterInvoice.status,
      paidAt: afterInvoice.paidAt?.toISOString(),
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

function assertInvoiceAmount(
  amount: { currency: string; minor: string },
  invoice: StripeBoundInvoice,
): void {
  if (
    amount.currency !== invoice.currency ||
    BigInt(amount.minor) !== invoice.amountMinor
  )
    throw new Error("Stripe invoice amount or currency mismatch");
}

function isNewerFinancialEvent(
  event: StripeFinancialProjectionEvent,
  row: {
    stripeLastOccurredAt: Date | null;
    stripeLastEventId: string | null;
  },
): boolean {
  if (!row.stripeLastOccurredAt || !row.stripeLastEventId) return true;
  const occurredAt = new Date(event.occurredAt);
  const prior = row.stripeLastOccurredAt;
  return (
    occurredAt > prior ||
    (occurredAt.valueOf() === prior.valueOf() &&
      event.eventId > row.stripeLastEventId)
  );
}

async function projectBoundPayment(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
  invoice: StripeBoundInvoice,
): Promise<StripePayment> {
  if (!event.paymentIntentId)
    throw new Error("Paid Stripe event has no payment-intent ID");
  if (!event.amount)
    throw new Error("Stripe payment event has no normalized amount");
  assertInvoiceAmount(event.amount, invoice);
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
  if (before && !isNewerFinancialEvent(event, before)) return before;
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
    stripeLastOccurredAt: occurredAt,
    stripeLastEventId: event.eventId,
    updatedAt: occurredAt,
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
  if (!isNewerFinancialEvent(event, before)) return;
  const status =
    event.eventType === "credit_note.voided" || event.status === "void"
      ? "void"
      : event.status === "issued"
        ? "issued"
        : event.status === "draft"
          ? "pending"
          : undefined;
  if (!status) throw new Error("Stripe credit-note status is unsupported");
  if (
    (before.status === "issued" ||
      before.status === "failed" ||
      before.status === "void") &&
    before.status !== status &&
    !(before.status === "issued" && status === "void")
  )
    throw new Error("Stripe credit-note terminal status conflicted");
  const [after] = await transaction
    .update(creditNotes)
    .set({
      status,
      stripeLastOccurredAt: new Date(event.occurredAt),
      stripeLastEventId: event.eventId,
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
  if (!isNewerFinancialEvent(event, before)) return;
  const status =
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
  if (!status) throw new Error("Stripe refund status is unsupported");
  if (
    (before.status === "succeeded" || before.status === "failed") &&
    before.status !== status
  )
    throw new Error("Stripe refund terminal status conflicted");
  const [after] = await transaction
    .update(refunds)
    .set({
      status,
      stripeLastOccurredAt: new Date(event.occurredAt),
      stripeLastEventId: event.eventId,
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
    requestId: `stripe:${event.eventId}`,
    before: input.before,
    after: { ...input.after, providerEventId: event.eventId },
    occurredAt: new Date(event.occurredAt),
  });
}

async function appendWebhookProjection(
  transaction: RuntimeTransaction,
  event: StripeFinancialProjectionEvent,
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
    requestId: `stripe:${event.eventId}`,
    after: {
      providerEventId: event.eventId,
      category: event.category,
      disposition: "verified_no_financial_projection",
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

function disputeStatus(
  eventType: string,
  providerStatus: string | undefined,
  current: string,
): "needs_response" | "under_review" | "won" | "lost" {
  if (eventType.endsWith(".closed"))
    return providerStatus === "won" ? "won" : "lost";
  if (eventType.endsWith(".funds_reinstated")) return "won";
  if (eventType.endsWith(".funds_withdrawn")) return "lost";
  if (
    providerStatus === "warning_needs_response" ||
    providerStatus === "needs_response"
  )
    return "needs_response";
  if (isDisputeStatus(current)) return current;
  return "under_review";
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
