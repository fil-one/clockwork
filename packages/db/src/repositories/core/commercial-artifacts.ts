import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { documents } from "../../schema";
import { commercialArtifactRequests } from "../../schema/core/commercial-artifacts";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
const LocaleSchema = z.enum(["en-US", "en-GB", "en-IE", "es-ES"]);
const MoneySchema = z.object({
  currency: CurrencySchema,
  minorUnits: z.string().regex(/^-?(0|[1-9]\d*)$/),
});
const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  locality: z.string().min(1),
  region: z.string().min(1).optional(),
  postalCode: z.string().min(1),
  countryCode: z.string().min(2),
});
const PartySchema = z.object({
  legalName: z.string().min(1),
  address: AddressSchema,
  taxId: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  contactEmail: z.email().optional(),
});
const BrandSchema = z.object({
  wordmark: z.string().min(1),
  legalName: z.string().min(1),
  accentColor: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .optional(),
  supportEmail: z.email().optional(),
  legalFooter: z.string().min(1).optional(),
});
const LineSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  detail: z.string().min(1).optional(),
  quantity: z.string().min(1).optional(),
  unitLabel: z.string().min(1).optional(),
  unitPrice: MoneySchema.optional(),
  amount: MoneySchema,
  taxLabel: z.string().min(1).optional(),
});
const TotalsSchema = z.object({
  subtotal: MoneySchema,
  discount: MoneySchema.optional(),
  tax: MoneySchema.optional(),
  taxLabel: z.string().min(1).optional(),
  total: MoneySchema,
});
const ServicePeriodSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
});
const BaseDefinitionSchema = z.object({
  displayDocumentId: z.string().min(1),
  documentVersion: z.string().min(1),
  issuedAt: z.iso.datetime({ offset: true }),
  locale: LocaleSchema,
  recipient: PartySchema,
  issuerMode: z.enum(["platform", "partner"]),
  partnerIssuer: PartySchema.optional(),
  brand: BrandSchema.optional(),
  notes: z.array(z.string().min(1)).optional(),
});

const QuoteDefinitionSchema = BaseDefinitionSchema.extend({
  kind: z.enum([
    "direct_quote",
    "partner_transfer_quote",
    "partner_resale_quote",
  ]),
  quoteNumber: z.string().min(1),
  validUntil: z.iso.date(),
  currency: CurrencySchema,
  lineItems: z.array(LineSchema).min(1),
  totals: TotalsSchema,
  servicePeriod: ServicePeriodSchema.optional(),
  agreementReference: z.string().min(1).optional(),
  purchaseOrderRequired: z.boolean().optional(),
  paymentTerms: z.string().min(1),
  endClient: PartySchema.optional(),
  commercialTerms: z.array(z.string().min(1)).optional(),
});
const OrderDefinitionSchema = BaseDefinitionSchema.extend({
  kind: z.literal("order_form"),
  orderNumber: z.string().min(1),
  quoteReference: z.string().min(1),
  governingAgreementReference: z.string().min(1),
  purchaseOrderNumber: z.string().min(1).optional(),
  servicePeriod: ServicePeriodSchema,
  currency: CurrencySchema,
  lineItems: z.array(LineSchema).min(1),
  totals: TotalsSchema,
  paymentTerms: z.string().min(1),
  signer: z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    acceptedAt: z.iso.datetime({ offset: true }),
    authorityAttestation: z.string().min(1),
  }),
});
const AmendmentDefinitionSchema = BaseDefinitionSchema.extend({
  kind: z.literal("amendment"),
  amendmentNumber: z.string().min(1),
  parentOrderReference: z.string().min(1),
  governingAgreementReference: z.string().min(1),
  effectiveDate: z.iso.date(),
  prorationMethod: z.string().min(1),
  deltaLines: z.array(
    LineSchema.extend({ change: z.enum(["add", "remove", "replace"]) }),
  ),
  netChange: MoneySchema,
  resultingTerm: ServicePeriodSchema.optional(),
  acceptedBy: z
    .object({
      name: z.string().min(1),
      title: z.string().min(1),
      acceptedAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
});

export const CommercialArtifactDefinitionSchema = z.discriminatedUnion("kind", [
  QuoteDefinitionSchema,
  OrderDefinitionSchema,
  AmendmentDefinitionSchema,
]);
export type CommercialArtifactDefinition = z.output<
  typeof CommercialArtifactDefinitionSchema
>;

export const CommercialArtifactRequestSchema = z.object({
  requestVersion: z.literal(1),
  requestId: z.uuid(),
  requestHash: Sha256Schema,
  subjectType: z.enum(["quote", "order", "amendment"]),
  subjectId: z.uuid(),
  commercialAccountId: z.uuid(),
  audienceAccountId: z.uuid(),
  audience: z.enum(["end_client", "partner"]),
  documentKind: z.enum([
    "direct_quote",
    "partner_transfer_quote",
    "partner_resale_quote",
    "order_form",
    "amendment",
  ]),
  sourceHash: Sha256Schema,
  sourceDefinition: CommercialArtifactDefinitionSchema,
  retainUntil: z.iso.datetime({ offset: true }),
});
export type CommercialArtifactRequest = z.output<
  typeof CommercialArtifactRequestSchema
>;

export interface PersistedCommercialArtifact {
  documentId: string;
  storageKey: string;
  storageVersionId: string;
  contentHash: string;
  byteLength: number;
  mimeType: "application/pdf";
  retainUntil: string;
  legalHold: boolean;
}

export interface CommercialArtifactIssueResult {
  documentId: string;
  duplicate: boolean;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function commercialArtifactRequestHash(
  request: Omit<CommercialArtifactRequest, "requestHash">,
): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

export function commercialArtifactSourceHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function storedKind(kind: CommercialArtifactRequest["documentKind"]): string {
  if (kind === "partner_transfer_quote") return "partner_quote";
  if (kind === "direct_quote" || kind === "partner_resale_quote")
    return "quote";
  return kind;
}

export async function assertCommercialArtifactBinding(
  transaction: RuntimeTransaction,
  input: {
    documentId: string;
    subjectType: CommercialArtifactRequest["subjectType"];
    subjectId: string;
    commercialAccountId: string;
    audienceAccountId: string;
    audience: CommercialArtifactRequest["audience"];
    documentKind: CommercialArtifactRequest["documentKind"];
    sourceHash: string;
  },
): Promise<void> {
  const rows = await transaction
    .select({ request: commercialArtifactRequests, document: documents })
    .from(commercialArtifactRequests)
    .innerJoin(
      documents,
      eq(documents.id, commercialArtifactRequests.documentId),
    )
    .where(
      and(
        eq(commercialArtifactRequests.documentId, input.documentId),
        eq(commercialArtifactRequests.subjectType, input.subjectType),
        eq(commercialArtifactRequests.subjectId, input.subjectId),
        eq(
          commercialArtifactRequests.commercialAccountId,
          input.commercialAccountId,
        ),
        eq(
          commercialArtifactRequests.audienceAccountId,
          input.audienceAccountId,
        ),
        eq(commercialArtifactRequests.audience, input.audience),
        eq(commercialArtifactRequests.documentKind, input.documentKind),
        eq(commercialArtifactRequests.sourceHash, input.sourceHash),
        eq(commercialArtifactRequests.status, "stored"),
      ),
    )
    .limit(1);
  const binding = rows[0];
  if (
    !binding ||
    binding.document.accountId !== input.audienceAccountId ||
    binding.document.kind !== storedKind(input.documentKind) ||
    binding.document.contentHash !== binding.request.contentHash ||
    binding.document.storageVersionId !== binding.request.storageVersionId ||
    binding.document.mimeType !== "application/pdf" ||
    binding.document.byteLength < 1n ||
    binding.document.objectLockMode !== "COMPLIANCE" ||
    binding.document.retainUntil.toISOString() !==
      binding.request.retainUntil.toISOString()
  )
    throw new Error("COMMERCIAL_ARTIFACT_BINDING_INVALID");
}

export class DatabaseCommercialArtifactStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public issue(input: {
    request: CommercialArtifactRequest;
    artifact: PersistedCommercialArtifact;
    requestId: string;
  }): Promise<CommercialArtifactIssueResult> {
    const request = CommercialArtifactRequestSchema.parse(input.request);
    const { requestHash, ...body } = request;
    if (commercialArtifactRequestHash(body) !== requestHash)
      throw new Error("COMMERCIAL_ARTIFACT_REQUEST_HASH_MISMATCH");
    if (
      commercialArtifactSourceHash(request.sourceDefinition) !==
      request.sourceHash
    )
      throw new Error("COMMERCIAL_ARTIFACT_SOURCE_HASH_MISMATCH");
    if (
      !Sha256Schema.safeParse(input.artifact.contentHash).success ||
      input.artifact.mimeType !== "application/pdf" ||
      input.artifact.byteLength < 1 ||
      !input.artifact.storageKey ||
      !input.artifact.storageVersionId ||
      input.artifact.retainUntil !== request.retainUntil ||
      input.artifact.legalHold
    )
      throw new Error("COMMERCIAL_ARTIFACT_STORAGE_EVIDENCE_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      (transaction) =>
        this.issueInTransaction(transaction, request, input.artifact),
    );
  }

  private async issueInTransaction(
    transaction: RuntimeTransaction,
    request: CommercialArtifactRequest,
    artifact: PersistedCommercialArtifact,
  ): Promise<CommercialArtifactIssueResult> {
    const persisted =
      await transaction.query.commercialArtifactRequests.findFirst({
        where: eq(commercialArtifactRequests.id, request.requestId),
      });
    if (!persisted) throw new Error("COMMERCIAL_ARTIFACT_REQUEST_NOT_FOUND");
    const persistedDefinition = CommercialArtifactDefinitionSchema.parse(
      persisted.sourceDefinition,
    );
    if (
      persisted.requestHash !== request.requestHash ||
      persisted.sourceHash !== request.sourceHash ||
      persisted.subjectType !== request.subjectType ||
      persisted.subjectId !== request.subjectId ||
      persisted.commercialAccountId !== request.commercialAccountId ||
      persisted.audienceAccountId !== request.audienceAccountId ||
      persisted.audience !== request.audience ||
      persisted.documentKind !== request.documentKind ||
      persisted.retainUntil.toISOString() !== request.retainUntil ||
      canonicalJson(persistedDefinition) !==
        canonicalJson(request.sourceDefinition)
    )
      throw new Error("COMMERCIAL_ARTIFACT_REQUEST_EVIDENCE_MISMATCH");
    if (persisted.status === "stored") {
      if (
        persisted.documentId !== artifact.documentId ||
        persisted.contentHash !== artifact.contentHash ||
        persisted.storageVersionId !== artifact.storageVersionId
      )
        throw new Error("COMMERCIAL_ARTIFACT_REPLAY_CONFLICT");
      return { documentId: artifact.documentId, duplicate: true };
    }
    if (persisted.status !== "requested")
      throw new Error("COMMERCIAL_ARTIFACT_REQUEST_STATE_INVALID");
    const [document] = await transaction
      .insert(documents)
      .values({
        id: artifact.documentId,
        accountId: request.audienceAccountId,
        kind: storedKind(request.documentKind),
        storageKey: artifact.storageKey,
        contentHash: artifact.contentHash,
        mimeType: artifact.mimeType,
        byteLength: BigInt(artifact.byteLength),
        objectLockMode: "COMPLIANCE",
        retainUntil: new Date(artifact.retainUntil),
        legalHold: false,
        storageVersionId: artifact.storageVersionId,
      })
      .returning();
    if (!document)
      throw new Error("COMMERCIAL_ARTIFACT_DOCUMENT_INSERT_FAILED");
    const [updated] = await transaction
      .update(commercialArtifactRequests)
      .set({
        status: "stored",
        documentId: document.id,
        contentHash: document.contentHash,
        storageVersionId: document.storageVersionId,
        updatedAt: new Date(),
        rowVersion: persisted.rowVersion + 1,
      })
      .where(
        and(
          eq(commercialArtifactRequests.id, persisted.id),
          eq(commercialArtifactRequests.status, "requested"),
          eq(commercialArtifactRequests.rowVersion, persisted.rowVersion),
        ),
      )
      .returning();
    if (!updated)
      throw new Error("COMMERCIAL_ARTIFACT_REQUEST_VERSION_CONFLICT");
    await appendAuditAndOutbox(transaction, {
      accountId: request.audienceAccountId,
      aggregateType: "document",
      aggregateId: document.id,
      aggregateVersion: 1,
      eventType: "commerce.commercial_artifact_stored",
      actor: { kind: "system", id: "commercial-artifact-workflow" },
      requestId: `commercial-artifact:${request.requestId}:${request.requestHash}`,
      occurredAt: new Date(request.sourceDefinition.issuedAt),
      after: {
        requestId: request.requestId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        commercialAccountId: request.commercialAccountId,
        audienceAccountId: request.audienceAccountId,
        audience: request.audience,
        documentKind: request.documentKind,
        documentId: document.id,
        sourceHash: request.sourceHash,
        contentHash: document.contentHash,
        storageVersionId: document.storageVersionId,
        retainUntil: document.retainUntil.toISOString(),
      },
    });
    return { documentId: document.id, duplicate: false };
  }
}
