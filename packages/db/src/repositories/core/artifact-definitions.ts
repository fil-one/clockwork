import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@clockwork/contracts";
import type {
  AcceptedOrder,
  CommercialAmendment,
  QuoteSnapshot,
} from "@clockwork/domain/core";

import type { RuntimeTransaction } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  outboxMessages,
  procurementProfiles,
} from "../../schema";
import {
  accountCommercialProfiles,
  commercialArtifactRequests,
} from "../../schema/core";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  commercialArtifactRequestHash,
  commercialArtifactSourceHash,
  CommercialArtifactDefinitionSchema,
  type CommercialArtifactDefinition,
  type CommercialArtifactRequest,
} from "./commercial-artifacts";

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  city: z.string().min(1),
  region: z.string().min(1).optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2),
});
const ContactSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.email().optional(),
  })
  .passthrough();

type PartyDefinition = CommercialArtifactDefinition["recipient"];

async function party(
  transaction: RuntimeTransaction,
  accountId: string,
): Promise<PartyDefinition> {
  const account = await transaction.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!account) throw new Error("COMMERCIAL_ARTIFACT_ACCOUNT_NOT_FOUND");
  const address = AddressSchema.parse(account.registeredAddress);
  const contact = ContactSchema.parse(account.billingContact);
  const taxId = z
    .array(z.object({ value: z.string().min(1) }).passthrough())
    .safeParse(account.taxIds);
  return {
    legalName: account.legalName,
    address: {
      line1: address.line1,
      ...(address.line2 ? { line2: address.line2 } : {}),
      locality: address.city,
      ...(address.region ? { region: address.region } : {}),
      postalCode: address.postalCode,
      countryCode: address.country,
    },
    ...(taxId.success && taxId.data[0] ? { taxId: taxId.data[0].value } : {}),
    ...(contact.name ? { contactName: contact.name } : {}),
    ...(contact.email ? { contactEmail: contact.email } : {}),
  };
}

async function presentationPolicy(
  transaction: RuntimeTransaction,
  accountId: string,
): Promise<{
  locale: "en-US" | "en-GB" | "en-IE" | "es-ES";
  paymentTerms: string;
  purchaseOrderRequired: boolean;
}> {
  const [commercial, procurement] = await Promise.all([
    transaction.query.accountCommercialProfiles.findFirst({
      where: eq(accountCommercialProfiles.accountId, accountId),
    }),
    transaction.query.procurementProfiles.findFirst({
      where: eq(procurementProfiles.accountId, accountId),
    }),
  ]);
  const locale = z
    .enum(["en-US", "en-GB", "en-IE", "es-ES"])
    .catch("en-US")
    .parse(commercial?.locale);
  return {
    locale,
    paymentTerms:
      commercial?.paymentTermsDays === null ||
      commercial?.paymentTermsDays === undefined
        ? "Due on receipt"
        : `Net ${commercial.paymentTermsDays} days`,
    purchaseOrderRequired: procurement?.poRequired ?? false,
  };
}

function money(value: { currency: string; minor: string }) {
  return {
    currency: z.enum(["USD", "EUR", "GBP"]).parse(value.currency),
    minorUnits: value.minor,
  };
}

function quoteLines(quote: QuoteSnapshot) {
  return quote.lines.map((line) => ({
    id: line.id,
    description: line.sku,
    detail: `${line.region}; contracted overage ${line.overageRate.minor} minor units`,
    quantity: line.quantity,
    unitLabel: line.unit,
    unitPrice: money(line.unitPrice),
    amount: money(line.lineTotal),
  }));
}

export async function quoteArtifactDefinition(
  transaction: RuntimeTransaction,
  input: {
    quote: QuoteSnapshot;
    audience: "end_client" | "partner";
    issuedAt: string;
  },
): Promise<{
  definition: CommercialArtifactDefinition;
  audienceAccountId: string;
  documentKind: CommercialArtifactRequest["documentKind"];
  sourceHash: string;
}> {
  const { quote } = input;
  const partnerShape =
    quote.route === "resale" || quote.route === "distributor";
  if (input.audience === "partner" && !partnerShape)
    throw new Error("COMMERCIAL_ARTIFACT_PARTNER_AUDIENCE_INVALID");
  if (partnerShape && !quote.partnerAccountId)
    throw new Error("COMMERCIAL_ARTIFACT_PARTNER_ACCOUNT_MISSING");
  const audienceAccountId =
    input.audience === "partner" ? quote.partnerAccountId : quote.accountId;
  if (!audienceAccountId)
    throw new Error("COMMERCIAL_ARTIFACT_AUDIENCE_ACCOUNT_MISSING");
  const [recipient, policy] = await Promise.all([
    party(transaction, audienceAccountId),
    presentationPolicy(transaction, audienceAccountId),
  ]);
  const base = {
    displayDocumentId: `Q-${quote.id}-R${quote.revision}-${input.audience}`,
    documentVersion: String(quote.revision),
    issuedAt: input.issuedAt,
    locale: policy.locale,
    recipient,
    quoteNumber: `Q-${quote.id}-R${quote.revision}`,
    validUntil: quote.expiresAt.slice(0, 10),
    currency: quote.total.currency,
    purchaseOrderRequired: policy.purchaseOrderRequired,
    paymentTerms: policy.paymentTerms,
  } as const;
  let definition: CommercialArtifactDefinition;
  if (partnerShape && input.audience === "end_client") {
    if (!quote.partnerResaleTotal || !quote.partnerAccountId)
      throw new Error("COMMERCIAL_ARTIFACT_RESALE_TOTAL_MISSING");
    const partnerIssuer = await party(transaction, quote.partnerAccountId);
    definition = CommercialArtifactDefinitionSchema.parse({
      ...base,
      kind: "partner_resale_quote",
      issuerMode: "partner",
      partnerIssuer,
      ...(quote.whiteLabel
        ? {
            brand: {
              wordmark: quote.whiteLabel.displayName,
              legalName: partnerIssuer.legalName,
              ...(quote.whiteLabel.accentColor
                ? { accentColor: quote.whiteLabel.accentColor }
                : {}),
              supportEmail: quote.whiteLabel.commercialContactEmail,
              ...(quote.whiteLabel.footer
                ? { legalFooter: quote.whiteLabel.footer }
                : {}),
            },
          }
        : {}),
      lineItems: [
        {
          id: `resale-services:${quote.id}`,
          description: "Services under the partner quotation",
          amount: money(quote.partnerResaleTotal),
        },
      ],
      totals: {
        subtotal: money(quote.partnerResaleTotal),
        total: money(quote.partnerResaleTotal),
      },
      commercialTerms: [
        "Pricing is provided by the partner and excludes confidential supplier transfer economics.",
      ],
    });
  } else {
    const kind =
      input.audience === "partner" ? "partner_transfer_quote" : "direct_quote";
    definition = CommercialArtifactDefinitionSchema.parse({
      ...base,
      kind,
      issuerMode: "platform",
      lineItems: quoteLines(quote),
      totals: { subtotal: money(quote.total), total: money(quote.total) },
      ...(input.audience === "partner"
        ? {
            endClient: await party(transaction, quote.accountId),
            commercialTerms: [
              "Transfer prices are confidential partner commercial information.",
            ],
          }
        : {}),
    });
  }
  return {
    definition,
    audienceAccountId,
    documentKind: definition.kind,
    sourceHash: commercialArtifactSourceHash(definition),
  };
}

function orderLines(order: AcceptedOrder) {
  return order.lines.map((line) => ({
    id: line.id,
    description: line.sku,
    detail: `${line.region}; ${line.termMonths} month term`,
    quantity: line.quantity,
    unitPrice: money(line.unitPrice),
    amount: money(line.lineTotal),
  }));
}

function totalForOrder(order: AcceptedOrder) {
  const currency = order.lines[0]?.lineTotal.currency;
  if (!currency) throw new Error("COMMERCIAL_ARTIFACT_ORDER_LINES_MISSING");
  const minor = order.lines.reduce((total, line) => {
    if (line.lineTotal.currency !== currency)
      throw new Error("COMMERCIAL_ARTIFACT_MIXED_CURRENCY");
    return total + BigInt(line.lineTotal.minor);
  }, 0n);
  return money({ currency, minor: minor.toString() });
}

export async function orderArtifactDefinition(
  transaction: RuntimeTransaction,
  input: { order: AcceptedOrder; issuedAt: string },
): Promise<{
  definition: CommercialArtifactDefinition;
  audienceAccountId: string;
  sourceHash: string;
}> {
  if (!input.order.serviceEndsOn)
    throw new Error("COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED");
  const [recipient, policy, signer] = await Promise.all([
    party(transaction, input.order.invoicingAccountId),
    presentationPolicy(transaction, input.order.invoicingAccountId),
    transaction.query.commerceUsers.findFirst({
      where: eq(commerceUsers.id, input.order.signerUserId),
    }),
  ]);
  if (!signer) throw new Error("COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND");
  const total = totalForOrder(input.order);
  const definition = CommercialArtifactDefinitionSchema.parse({
    kind: "order_form",
    displayDocumentId: `ORD-${input.order.id}`,
    documentVersion: "1",
    issuedAt: input.issuedAt,
    locale: policy.locale,
    recipient,
    issuerMode: "platform",
    orderNumber: `ORD-${input.order.id}`,
    quoteReference: `Q-${input.order.quoteId}-R${input.order.quoteRevision}`,
    governingAgreementReference: `${input.order.agreementId}-v${input.order.agreementVersion}`,
    ...(input.order.poNumber
      ? { purchaseOrderNumber: input.order.poNumber }
      : {}),
    servicePeriod: {
      startDate: input.order.serviceStartsOn,
      endDate: input.order.serviceEndsOn,
    },
    currency: total.currency,
    lineItems: orderLines(input.order),
    totals: { subtotal: total, total },
    paymentTerms: policy.paymentTerms,
    signer: {
      name: signer.name,
      title: input.order.authorityTitle,
      acceptedAt: input.order.acceptedAt,
      authorityAttestation: `I am authorized to bind ${recipient.legalName} to this order form.`,
    },
  });
  return {
    definition,
    audienceAccountId: input.order.invoicingAccountId,
    sourceHash: commercialArtifactSourceHash(definition),
  };
}

export async function amendmentArtifactDefinition(
  transaction: RuntimeTransaction,
  input: {
    order: AcceptedOrder;
    amendment: CommercialAmendment;
    issuedAt: string;
  },
): Promise<{
  definition: CommercialArtifactDefinition;
  audienceAccountId: string;
  sourceHash: string;
}> {
  const [recipient, policy, signer] = await Promise.all([
    party(transaction, input.order.invoicingAccountId),
    presentationPolicy(transaction, input.order.invoicingAccountId),
    transaction.query.commerceUsers.findFirst({
      where: eq(commerceUsers.id, input.order.signerUserId),
    }),
  ]);
  if (!signer) throw new Error("COMMERCIAL_ARTIFACT_SIGNER_NOT_FOUND");
  const currency = input.order.lines[0]?.lineTotal.currency;
  if (!currency) throw new Error("COMMERCIAL_ARTIFACT_ORDER_LINES_MISSING");
  const netMinor = input.amendment.deltas.reduce(
    (total, delta) => total + BigInt(delta.proratedPriceDelta.minor),
    0n,
  );
  const definition = CommercialArtifactDefinitionSchema.parse({
    kind: "amendment",
    displayDocumentId: `AMD-${input.amendment.id}`,
    documentVersion: "1",
    issuedAt: input.issuedAt,
    locale: policy.locale,
    recipient,
    issuerMode: "platform",
    amendmentNumber: `AMD-${input.amendment.id}`,
    parentOrderReference: `ORD-${input.order.id}`,
    governingAgreementReference: `${input.order.agreementId}-v${input.order.agreementVersion}`,
    effectiveDate: input.amendment.effectiveOn,
    prorationMethod: input.amendment.prorationMethod,
    deltaLines: input.amendment.deltas.map((delta, index) => ({
      id: `${input.amendment.id}:${index}`,
      description: delta.sku,
      quantity: delta.quantityDelta,
      amount: money(delta.proratedPriceDelta),
      change: delta.orderLineId
        ? "replace"
        : delta.quantityDelta.trim().startsWith("-")
          ? "remove"
          : "add",
    })),
    netChange: money({ currency, minor: netMinor.toString() }),
    ...(input.amendment.resultingServiceEndsOn
      ? {
          resultingTerm: {
            startDate: input.order.serviceStartsOn,
            endDate: input.amendment.resultingServiceEndsOn,
          },
        }
      : {}),
    acceptedBy: {
      name: signer.name,
      title: input.order.authorityTitle,
      acceptedAt: input.amendment.acceptedAt,
    },
  });
  return {
    definition,
    audienceAccountId: input.order.invoicingAccountId,
    sourceHash: commercialArtifactSourceHash(definition),
  };
}

export async function persistCommercialArtifactRequest(
  transaction: RuntimeTransaction,
  input: {
    subjectType: CommercialArtifactRequest["subjectType"];
    subjectId: string;
    commercialAccountId: string;
    audienceAccountId: string;
    audience: CommercialArtifactRequest["audience"];
    definition: CommercialArtifactDefinition;
    retainUntil: string;
    requestedBy: string;
    actor: Actor;
    requestId: string;
    occurredAt: string;
  },
): Promise<{
  request: CommercialArtifactRequest;
  auditEventId: string;
  outboxMessageId: string;
}> {
  const sourceDefinition = CommercialArtifactDefinitionSchema.parse(
    input.definition,
  );
  const sourceHash = commercialArtifactSourceHash(sourceDefinition);
  const requestId = uuidFromHash(sourceHash);
  const body: Omit<CommercialArtifactRequest, "requestHash"> = {
    requestVersion: 1,
    requestId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    commercialAccountId: input.commercialAccountId,
    audienceAccountId: input.audienceAccountId,
    audience: input.audience,
    documentKind: sourceDefinition.kind,
    sourceHash,
    sourceDefinition,
    retainUntil: input.retainUntil,
  };
  const request: CommercialArtifactRequest = {
    ...body,
    requestHash: commercialArtifactRequestHash(body),
  };
  const [row] = await transaction
    .insert(commercialArtifactRequests)
    .values({
      id: request.requestId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      commercialAccountId: request.commercialAccountId,
      audienceAccountId: request.audienceAccountId,
      audience: request.audience,
      documentKind: request.documentKind,
      sourceDefinition: request.sourceDefinition,
      sourceHash: request.sourceHash,
      requestHash: request.requestHash,
      retainUntil: new Date(request.retainUntil),
      requestedBy: input.requestedBy,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const existing =
      await transaction.query.commercialArtifactRequests.findFirst({
        where: eq(commercialArtifactRequests.id, request.requestId),
      });
    if (!existing || existing.requestHash !== request.requestHash)
      throw new Error("COMMERCIAL_ARTIFACT_REQUEST_CONFLICT");
    const event = await transaction.query.auditEvents.findFirst({
      where: and(
        eq(auditEvents.aggregateType, "document"),
        eq(auditEvents.aggregateId, request.requestId),
        eq(auditEvents.eventType, "commerce.commercial_artifact_requested"),
      ),
    });
    if (!event) throw new Error("COMMERCIAL_ARTIFACT_REQUEST_AUDIT_MISSING");
    const message = await transaction.query.outboxMessages.findFirst({
      where: eq(outboxMessages.eventId, event.id),
    });
    if (!message) throw new Error("COMMERCIAL_ARTIFACT_REQUEST_OUTBOX_MISSING");
    return {
      request,
      auditEventId: event.id,
      outboxMessageId: message.id,
    };
  }
  const appended = await appendAuditAndOutbox(transaction, {
    accountId: input.audienceAccountId,
    aggregateType: "document",
    aggregateId: request.requestId,
    aggregateVersion: 1,
    eventType: "commerce.commercial_artifact_requested",
    topic: "commerce.commercial_artifact_requested",
    actor: input.actor,
    requestId: input.requestId,
    occurredAt: new Date(input.occurredAt),
    after: { artifactRequest: request },
  });
  return {
    request,
    auditEventId: appended.event.id,
    outboxMessageId: appended.message.id,
  };
}

function uuidFromHash(hash: string): string {
  const characters = hash.slice(0, 32).split("");
  characters[12] = "4";
  characters[16] = (
    8 |
    (Number.parseInt(characters[16] ?? "0", 16) & 3)
  ).toString(16);
  const value = characters.join("");
  return z
    .uuid()
    .parse(
      `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`,
    );
}
