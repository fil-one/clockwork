// i18n-exempt-file: builds generated PDF document inputs (translation policy rule 5) and API problem titles (integrator contract; the interface maps `code`, see problem-text.ts).
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionClaims } from "@clockwork/api";
import { loadPaygInvoiceSource, type RuntimeTransaction } from "@clockwork/db";
import type { CommerceDocumentInput, Party } from "@clockwork/documents";

import {
  ExperienceProblem,
  type ArtifactKind,
  type ExperienceAudience,
} from "./model";

type Row = Readonly<Record<string, unknown>>;
type WithoutVerification<T> = T extends unknown
  ? Omit<T, "verification">
  : never;
type DocumentWithoutVerification = WithoutVerification<CommerceDocumentInput>;

export interface ArtifactSourceRequest {
  kind: ArtifactKind;
  subjectId: string;
  expectedVersion: string;
  audience: ExperienceAudience;
  accountId: string | null;
}

export interface ResolvedArtifactSource {
  accountId: string | null;
  audience: ExperienceAudience;
  audienceAccountId: string | null;
  subjectType: string;
  subjectId: string;
  kind: ArtifactKind;
  input: CommerceDocumentInput;
  sourceHash: string;
  sourceVersion: string;
  retainUntil: string;
}

const PartySchema = z.object({
  legalName: z.string().min(1),
  address: z.object({
    line1: z.string().min(1),
    line2: z.string().min(1).optional(),
    locality: z.string().min(1),
    region: z.string().min(1).optional(),
    postalCode: z.string().min(1),
    countryCode: z.string().min(2),
  }),
  taxId: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  contactEmail: z.email().optional(),
});

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  city: z.string().min(1),
  region: z.string().min(1).optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2),
});
const ContactSchema = z
  .object({ name: z.string().min(1).optional(), email: z.email().optional() })
  .passthrough();
const TaxIdsSchema = z.array(
  z.object({ value: z.string().min(1) }).passthrough(),
);
const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
const LocaleSchema = z.enum(["en-US", "en-GB", "en-IE", "es-ES"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const MoneySchema = z
  .object({
    currency: CurrencySchema,
    minorUnits: z.string().regex(/^-?(0|[1-9]\d*)$/),
  })
  .strict();
const InvoiceDocumentLineSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    quantity: z.string().min(1),
    unitPrice: MoneySchema,
    amount: MoneySchema,
  })
  .strict();
const CommissionDocumentLineSchema = z
  .object({
    id: z.string().min(1),
    endClientName: z.string().min(1),
    invoiceReference: z.string().min(1),
    collectedRevenue: MoneySchema,
    commissionRateBasisPoints: z.number().int().min(0).max(10_000),
    earned: MoneySchema,
  })
  .strict();

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
  if (!value || typeof value !== "object")
    throw new Error("NON_CANONICAL_JSON_VALUE");
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function artifactSourceHash(input: {
  kind: ArtifactKind;
  subjectType: string;
  subjectId: string;
  sourceVersion: string;
  document: CommerceDocumentInput;
}): string {
  const verification = {
    ...input.document.verification,
    recordHash: "",
  };
  return createHash("sha256")
    .update(
      canonicalJson({
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        sourceVersion: input.sourceVersion,
        document: { ...input.document, verification },
      }),
    )
    .digest("hex");
}

export function verifyResolvedArtifactSource(
  source: Pick<
    ResolvedArtifactSource,
    | "kind"
    | "subjectType"
    | "subjectId"
    | "sourceVersion"
    | "input"
    | "sourceHash"
  >,
): void {
  if (
    source.input.kind !== source.kind ||
    source.input.verification.objectVersion !== source.sourceVersion ||
    source.input.verification.recordHash !== source.sourceHash ||
    artifactSourceHash({
      kind: source.kind,
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      sourceVersion: source.sourceVersion,
      document: source.input,
    }) !== source.sourceHash
  )
    throw new ExperienceProblem(
      409,
      "ARTIFACT_SOURCE_CORRUPT",
      "The persisted artifact source failed verification",
    );
}

function finalized(
  source: Omit<ResolvedArtifactSource, "sourceHash" | "input"> & {
    input: DocumentWithoutVerification;
  },
): ResolvedArtifactSource {
  const draft = {
    ...source.input,
    verification: {
      recordHash: "0".repeat(64),
      objectVersion: source.sourceVersion,
    },
  } as CommerceDocumentInput;
  const sourceHash = artifactSourceHash({
    kind: source.kind,
    subjectType: source.subjectType,
    subjectId: source.subjectId,
    sourceVersion: source.sourceVersion,
    document: draft,
  });
  const result: ResolvedArtifactSource = {
    ...source,
    sourceHash,
    input: {
      ...draft,
      verification: { ...draft.verification, recordHash: sourceHash },
    },
  };
  verifyResolvedArtifactSource(result);
  return result;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value)
    throw new Error(`ARTIFACT_SOURCE_COLUMN_INVALID:${key}`);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return text(row, key);
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new Error(`ARTIFACT_SOURCE_COLUMN_INVALID:${key}`);
}

function instant(row: Row, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  const raw = text(row, key);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.valueOf()))
    throw new Error(`ARTIFACT_SOURCE_COLUMN_INVALID:${key}`);
  return parsed.toISOString();
}

function localDate(row: Row, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = text(row, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    throw new Error(`ARTIFACT_SOURCE_COLUMN_INVALID:${key}`);
  return raw;
}

function object(row: Row, key: string): Record<string, unknown> {
  const value = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`ARTIFACT_SOURCE_COLUMN_INVALID:${key}`);
  return value as Record<string, unknown>;
}

function money(currency: string, minorUnits: string | bigint) {
  return {
    currency: CurrencySchema.parse(currency),
    minorUnits: String(minorUnits),
  };
}

function addYears(value: string, years = 7): string {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString();
}

function renderedCsvHash(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string | number | boolean | null>>[],
): { contentHash: string; byteLength: number } {
  const safeCell = (raw: string) => {
    const protectedValue = /^(?:[=+\-@]|\s+[=+\-@])/.test(raw)
      ? `'${raw}`
      : raw;
    return /[",\r\n]/.test(protectedValue)
      ? `"${protectedValue.replace(/"/g, '""')}"`
      : protectedValue;
  };
  const lines = [
    columns.map(safeCell).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const value = row[column];
          return safeCell(
            value === null || value === undefined ? "" : String(value),
          );
        })
        .join(","),
    ),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
  return {
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };
}

function platformIssuer(): Party {
  const configured = process.env.PLATFORM_ISSUER_JSON?.trim();
  if (!configured)
    throw new ExperienceProblem(
      503,
      "PLATFORM_ISSUER_REQUIRED",
      "The validated platform issuer is not configured",
    );
  try {
    return PartySchema.parse(JSON.parse(configured)) as Party;
  } catch {
    throw new ExperienceProblem(
      503,
      "PLATFORM_ISSUER_INVALID",
      "The validated platform issuer is invalid",
    );
  }
}

async function accountPresentation(
  transaction: RuntimeTransaction,
  accountId: string,
): Promise<{ party: Party; locale: "en-US" | "en-GB" | "en-IE" | "es-ES" }> {
  const rows = await transaction.execute(sql<Row>`
    select account.legal_name, account.registered_address, account.tax_ids,
           account.billing_contact, profile.locale
    from public.accounts account
    join public.core_account_commercial_profiles profile
      on profile.account_id = account.id
    where account.id = ${accountId}::uuid
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_ACCOUNT_PRESENTATION_INCOMPLETE");
  const address = AddressSchema.parse(row.registered_address);
  const contact = ContactSchema.parse(row.billing_contact);
  const taxIds = TaxIdsSchema.parse(row.tax_ids);
  return {
    party: {
      legalName: text(row, "legal_name"),
      address: {
        line1: address.line1,
        ...(address.line2 ? { line2: address.line2 } : {}),
        locality: address.city,
        ...(address.region ? { region: address.region } : {}),
        postalCode: address.postalCode,
        countryCode: address.country,
      },
      ...(taxIds[0] ? { taxId: taxIds[0].value } : {}),
      ...(contact.name ? { contactName: contact.name } : {}),
      ...(contact.email ? { contactEmail: contact.email } : {}),
    },
    locale: LocaleSchema.parse(row.locale),
  };
}

function assertScope(
  session: SessionClaims,
  request: ArtifactSourceRequest,
  source: Pick<
    ResolvedArtifactSource,
    "accountId" | "audience" | "audienceAccountId"
  >,
): void {
  if (
    request.accountId !== source.accountId ||
    request.audience !== source.audience ||
    (source.audience === "internal" &&
      (!session.isInternalStaff ||
        session.impersonation !== undefined ||
        source.accountId !== null ||
        source.audienceAccountId !== null)) ||
    (source.audience !== "internal" &&
      (!source.accountId ||
        !source.audienceAccountId ||
        (session.isInternalStaff && !session.impersonation) ||
        (session.impersonation
          ? session.impersonation.accountId !== source.audienceAccountId
          : !session.isInternalStaff &&
            !session.accountIds.includes(source.audienceAccountId))))
  )
    throw new ExperienceProblem(
      403,
      "ARTIFACT_SCOPE_FORBIDDEN",
      "The artifact source is outside the authorized audience scope",
    );
}

/**
 * One stored commercial artifact request, in the shape the mapping below reads.
 *
 * The persisted row and the demo's own request record are both projected into
 * this before the mapping runs, which is the point: there is exactly one
 * definition-to-document translation, and substituting the store cannot
 * substitute it. A demo that wrote its own translation would render order forms
 * that differ from the product's in ways nobody would notice until a prospect
 * compared the two.
 */
export interface CommercialArtifactRequestRecord {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly audienceAccountId: string;
  readonly audience: ExperienceAudience;
  readonly kind: ArtifactKind;
  /** The `CommercialArtifactDefinition` the prepare pass hashed. */
  readonly definition: Readonly<Record<string, unknown>>;
  /** `commercialArtifactSourceHash(definition)`, re-checked here. */
  readonly sourceHash: string;
  readonly retainUntil: string;
  /**
   * Who the platform issues as, when the caller knows.
   *
   * Left unset on the persisted path, where the issuer is a deployment fact
   * read from `PLATFORM_ISSUER_JSON` -- a real deployment must state the legal
   * entity it invoices as, and refusing to render without one is correct. The
   * demo is not a deployment that invoices anyone: it names the same fictional
   * Fil One entity every other demo document already names, and requiring an
   * operator to configure a legal issuer before a prospect can see an order
   * form would be a control that blocks the demo for no benefit.
   */
  readonly issuer?: Party;
}

/**
 * The commercial definition, as the document the renderer takes.
 *
 * `displayDocumentId`, `documentVersion`, `issuerMode` and `partnerIssuer` are
 * request-side fields rather than document body, so they are lifted out and the
 * rest is carried through untouched. The issuer is resolved from `issuerMode`
 * because a partner-issued document names the partner and a platform-issued one
 * names Fil One, and only the request knows which.
 */
export function commercialArtifactSource(
  record: CommercialArtifactRequestRecord,
): ResolvedArtifactSource {
  if (
    createHash("sha256")
      .update(canonicalJson(record.definition))
      .digest("hex") !== record.sourceHash
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const definition = record.definition;
  const sourceVersion = z
    .string()
    .min(1)
    .max(80)
    .parse(definition.documentVersion);
  const issuerMode = z
    .enum(["platform", "partner"])
    .parse(definition.issuerMode);
  const issuer =
    issuerMode === "partner"
      ? PartySchema.parse(definition.partnerIssuer)
      : (record.issuer ?? platformIssuer());
  const { displayDocumentId, documentVersion } = definition;
  const documentDefinition = Object.fromEntries(
    Object.entries(definition).filter(
      ([key]) =>
        ![
          "displayDocumentId",
          "documentVersion",
          "issuerMode",
          "partnerIssuer",
        ].includes(key),
    ),
  );
  return finalized({
    accountId: record.audienceAccountId,
    audience: record.audience,
    audienceAccountId: record.audienceAccountId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    kind: record.kind,
    sourceVersion,
    retainUntil: record.retainUntil,
    input: {
      ...documentDefinition,
      kind: record.kind,
      documentId: z.string().min(1).parse(displayDocumentId),
      version: z.string().min(1).parse(documentVersion),
      issuer,
    } as DocumentWithoutVerification,
  });
}

async function commercialSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select subject_type, subject_id, commercial_account_id, audience_account_id,
           audience, document_kind, source_definition, source_hash, retain_until
    from public.core_commercial_artifact_requests
    where subject_id = ${request.subjectId}::uuid
      and document_kind = ${request.kind}
    order by created_at desc, id desc
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
  return commercialArtifactSource({
    subjectType: text(row, "subject_type"),
    subjectId: text(row, "subject_id"),
    audienceAccountId: text(row, "audience_account_id"),
    audience: text(row, "audience") === "partner" ? "partner" : "customer",
    kind: request.kind,
    definition: object(row, "source_definition"),
    sourceHash: text(row, "source_hash"),
    retainUntil: instant(row, "retain_until"),
  });
}

async function pocSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select poc.*, owner.name as owner_name,
           evidence.id as evidence_id, evidence.payload as evidence_payload,
           evidence.evidence_hash, evidence.recorded_at as evidence_recorded_at
    from public.pocs poc
    join public.commerce_users owner on owner.id = poc.support_owner_id
    left join lateral (
      select candidate.* from public.lifecycle_poc_evidence candidate
      where candidate.poc_id = poc.id and candidate.kind = 'success_snapshot'
      order by candidate.recorded_at desc, candidate.id desc limit 1
    ) evidence on true
    where poc.id = ${request.subjectId}::uuid
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
  const accountId =
    request.audience === "partner"
      ? nullableText(row, "partner_account_id")
      : text(row, "account_id");
  if (!accountId) throw new Error("ARTIFACT_AUDIENCE_SOURCE_INCOMPLETE");
  const recipient = await accountPresentation(transaction, accountId);
  const SuccessTestSchema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    target: z.string().min(1),
  });
  const tests = z.array(SuccessTestSchema).min(1).parse(row.success_tests);
  const snapshot = row.evidence_payload
    ? z
        .object({
          tests: z.array(
            z.object({
              testId: z.string(),
              passed: z.boolean(),
              evidenceHash: HashSchema,
            }),
          ),
        })
        .passthrough()
        .parse(row.evidence_payload)
    : null;
  if (snapshot) {
    const evidence = object(row, "evidence_payload");
    const evidenceHash = HashSchema.parse(evidence.evidenceHash);
    const body = Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== "evidenceHash"),
    );
    if (
      evidenceHash !== text(row, "evidence_hash") ||
      createHash("sha256").update(canonicalJson(body)).digest("hex") !==
        evidenceHash
    )
      throw new Error("ARTIFACT_SOURCE_CORRUPT");
  }
  if (request.kind === "poc_final_report" && !snapshot)
    throw new ExperienceProblem(
      409,
      "ARTIFACT_SOURCE_INCOMPLETE",
      "The final POC success snapshot has not been recorded",
    );
  const observed = new Map(snapshot?.tests.map((test) => [test.testId, test]));
  const sourceVersion = snapshot
    ? `${integer(row, "row_version")}:${text(row, "evidence_id")}`
    : String(integer(row, "row_version"));
  return finalized({
    accountId,
    audience: request.audience,
    audienceAccountId: accountId,
    subjectType: "poc",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "expires_at")),
    input: {
      kind: request.kind as "poc_summary" | "poc_final_report",
      documentId: `POC-${text(row, "id")}-${request.kind === "poc_final_report" ? "FINAL" : "SUMMARY"}`,
      version: sourceVersion,
      issuedAt: snapshot
        ? instant(row, "evidence_recorded_at")
        : instant(row, "updated_at"),
      locale: recipient.locale,
      issuer: platformIssuer(),
      recipient: recipient.party,
      pocNumber: `POC-${text(row, "id")}`,
      workload: text(row, "workload"),
      permittedDataClass: text(row, "permitted_data_class"),
      status: text(row, "status"),
      ownerName: text(row, "owner_name"),
      servicePeriod: {
        startDate: instant(row, "kickoff_at").slice(0, 10),
        endDate: instant(row, "expires_at").slice(0, 10),
      },
      capacityCap: text(row, "capacity_cap"),
      egressCap: text(row, "egress_cap"),
      successTests: tests.map((test) => {
        const result = observed.get(test.id);
        return {
          id: test.id,
          label: test.description,
          target: test.target,
          ...(result ? { observed: result.evidenceHash } : {}),
          result: result ? (result.passed ? "passed" : "failed") : "pending",
        };
      }),
      ...(snapshot
        ? {
            outcome: snapshot.tests.every((test) => test.passed)
              ? "All recorded success tests passed."
              : "One or more recorded success tests failed.",
          }
        : {}),
    },
  });
}

async function paygInvoiceArtifactSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource | undefined> {
  const rows = await transaction.execute(sql<Row>`
    select invoice.*, source.source_snapshot, source.source_hash,
      coalesce(sum(payment.amount_minor) filter (where payment.status='succeeded'),0) as paid_minor,
      max(payment.stripe_payment_intent_id) filter(where payment.status='succeeded') as payment_reference
    from public.invoices invoice join public.core_payg_invoice_sources source on source.invoice_id=invoice.id
    left join public.payments payment on payment.invoice_id=invoice.id
    where invoice.id=${request.subjectId}::uuid and invoice.billing_source='payg'
    group by invoice.id, source.invoice_id limit 1
  `);
  const row = rows[0];
  if (!row) return undefined;
  if (!row.stripe_invoice_id || row.status === "draft")
    throw new Error("ARTIFACT_SOURCE_INCOMPLETE");
  if (
    createHash("sha256")
      .update(canonicalJson(row.source_snapshot))
      .digest("hex") !== row.source_hash
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const currency = CurrencySchema.parse(row.currency);
  const source = await loadPaygInvoiceSource(transaction, {
    id: text(row, "id"),
    billingSource: "payg",
    orderId: null,
    paygEffectKey: text(row, "payg_effect_key"),
    accountId: text(row, "account_id"),
    currency,
    amountMinor: BigInt(text(row, "amount_minor")),
    taxMinor: BigInt(text(row, "tax_minor")),
    taxTreatment: text(row, "tax_treatment"),
  });
  const party = z.object({
    legalName: z.string(),
    registeredAddress: AddressSchema,
  });
  const snapshot = z
    .object({
      supplier: party,
      customer: party.extend({ invoiceDeliveryEmail: z.email() }),
      effect: z.object({
        kind: z.string(),
        amount: z.object({ minor: z.string() }),
      }),
      rating: z.object({
        lines: z.array(
          z.object({
            kind: z.string(),
            amount: z.object({ minor: z.string() }),
          }),
        ),
        period: z.object({
          serviceStartsAt: z.string(),
          serviceEndsAt: z.string(),
        }),
      }),
      taxDetermination: z.object({
        detail: z.object({
          lines: z.array(
            z.object({
              jurisdiction: z.string(),
              treatment: z.string(),
              notation: z.string(),
              taxMinor: z.string(),
            }),
          ),
        }),
      }),
    })
    .parse(source.sourceSnapshot);
  const present = (value: z.infer<typeof party>): Party => ({
    legalName: value.legalName,
    address: {
      line1: value.registeredAddress.line1,
      ...(value.registeredAddress.line2
        ? { line2: value.registeredAddress.line2 }
        : {}),
      locality: value.registeredAddress.city,
      ...(value.registeredAddress.region
        ? { region: value.registeredAddress.region }
        : {}),
      postalCode: value.registeredAddress.postalCode,
      countryCode: value.registeredAddress.country,
    },
  });
  const paid = BigInt(text(row, "paid_minor"));
  const total = BigInt(text(row, "amount_minor"));
  const tax = BigInt(text(row, "tax_minor"));
  if (
    request.kind === "receipt" &&
    (paid < total || !row.paid_at || !row.payment_reference)
  )
    throw new ExperienceProblem(
      409,
      "ARTIFACT_SOURCE_INCOMPLETE",
      "A receipt requires authoritative successful payment evidence",
    );
  const items =
    snapshot.effect.kind === "debit_adjustment"
      ? [
          {
            kind: "Correction adjustment",
            amount: { minor: snapshot.effect.amount.minor },
          },
        ]
      : snapshot.rating.lines;
  const sourceVersion = `${integer(row, "row_version")}:payg:${source.paygSource.revision}`;
  const period = `PAYG ${source.paygSource.month} · revision ${source.paygSource.revision}`;
  return finalized({
    accountId: text(row, "account_id"),
    audience: request.audience,
    audienceAccountId: text(row, "account_id"),
    subjectType: "invoice",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "created_at")),
    input: {
      kind: request.kind as "invoice_companion" | "receipt",
      documentId: `${request.kind === "receipt" ? "RCT" : "INV-COMP"}-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "updated_at"),
      locale: "en-US",
      issuer: present(snapshot.supplier),
      recipient: {
        ...present(snapshot.customer),
        contactEmail: snapshot.customer.invoiceDeliveryEmail,
      },
      invoiceNumber: text(row, "stripe_invoice_id"),
      billingPeriodReference: period,
      ...(row.due_at ? { dueDate: instant(row, "due_at").slice(0, 10) } : {}),
      ...(request.kind === "receipt"
        ? {
            paidAt: instant(row, "paid_at"),
            paymentReference: text(row, "payment_reference"),
          }
        : {}),
      currency,
      lineItems: items.map((item, index) => ({
        id: `payg-${index}`,
        description: item.kind.replaceAll("_", " "),
        amount: money(currency, item.amount.minor),
      })),
      totals: {
        subtotal: money(currency, total - tax),
        tax: money(currency, tax),
        total: money(currency, total),
      },
      amountPaid: money(currency, paid),
      balanceDue: money(currency, paid >= total ? 0n : total - paid),
      notes: [
        `Service period ${snapshot.rating.period.serviceStartsAt} to ${snapshot.rating.period.serviceEndsAt} (end excluded).`,
        ...snapshot.taxDetermination.detail.lines.map(
          (line) =>
            `${line.jurisdiction}: ${line.treatment.replaceAll("_", " ")}; tax ${line.taxMinor} minor units ${currency}${line.notation ? `; ${line.notation}` : ""}`,
        ),
      ],
    },
  });
}

async function invoiceSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const payg = await paygInvoiceArtifactSource(transaction, request);
  if (payg) return payg;
  const rows = await transaction.execute(sql<Row>`
    select invoice.*, snapshot.line_items, snapshot.subtotal_minor,
           snapshot.tax_minor, snapshot.total_minor, snapshot.source_version,
           snapshot.source_hash as snapshot_source_hash,
           snapshot.quote_id as snapshot_quote_id,
           orders.id as source_order_id,
           coalesce(sum(payment.amount_minor) filter (where payment.status = 'succeeded'), 0) as paid_minor,
           max(payment.received_at) filter (where payment.status = 'succeeded') as payment_received_at,
           max(payment.stripe_payment_intent_id) filter (where payment.status = 'succeeded') as payment_reference
    from public.invoices invoice
    join public.core_invoice_document_snapshots snapshot on snapshot.invoice_id = invoice.id
    join public.orders orders on orders.id = invoice.order_id
    left join public.payments payment on payment.invoice_id = invoice.id
    where invoice.id = ${request.subjectId}::uuid
    group by invoice.id, snapshot.invoice_id, orders.id
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_INCOMPLETE");
  const accountId = text(row, "account_id");
  const recipient = await accountPresentation(transaction, accountId);
  const currency = CurrencySchema.parse(row.currency);
  const poNumber = nullableText(row, "po_number");
  const lineItems = z
    .array(InvoiceDocumentLineSchema)
    .min(1)
    .parse(row.line_items);
  const paid = BigInt(text(row, "paid_minor"));
  const total = BigInt(text(row, "total_minor"));
  if (request.kind === "receipt" && (paid < total || !row.paid_at))
    throw new ExperienceProblem(
      409,
      "ARTIFACT_SOURCE_INCOMPLETE",
      "A receipt requires authoritative successful payment evidence",
    );
  const snapshotSourceVersion = text(row, "source_version");
  const invoiceSnapshot = {
    invoiceId: text(row, "id"),
    orderId: text(row, "source_order_id"),
    quoteId: text(row, "snapshot_quote_id"),
    currency,
    lineItems,
    subtotalMinor: text(row, "subtotal_minor"),
    taxMinor: text(row, "tax_minor"),
    totalMinor: text(row, "total_minor"),
    sourceVersion: snapshotSourceVersion,
  };
  if (
    createHash("sha256")
      .update(canonicalJson(invoiceSnapshot))
      .digest("hex") !== text(row, "snapshot_source_hash")
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const sourceVersion = `${integer(row, "row_version")}:${snapshotSourceVersion}`;
  return finalized({
    accountId,
    audience: request.audience,
    audienceAccountId: accountId,
    subjectType: "invoice",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "created_at")),
    input: {
      kind: request.kind as "invoice_companion" | "receipt",
      documentId: `${request.kind === "receipt" ? "RCT" : "INV-COMP"}-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "updated_at"),
      locale: recipient.locale,
      issuer: platformIssuer(),
      recipient: recipient.party,
      invoiceNumber: `INV-${text(row, "id")}`,
      orderReference: `ORD-${text(row, "source_order_id")}`,
      ...(poNumber ? { purchaseOrderNumber: poNumber } : {}),
      ...(row.due_at ? { dueDate: instant(row, "due_at").slice(0, 10) } : {}),
      ...(request.kind === "receipt"
        ? {
            paidAt: instant(row, "paid_at"),
            paymentReference: text(row, "payment_reference"),
          }
        : {}),
      currency,
      lineItems,
      totals: {
        subtotal: money(currency, text(row, "subtotal_minor")),
        tax: money(currency, text(row, "tax_minor")),
        total: money(currency, text(row, "total_minor")),
      },
      amountPaid: money(currency, paid),
      balanceDue: money(currency, paid >= total ? 0n : total - paid),
    },
  });
}

async function commissionSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select statement.*,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', line.id,
        'endClientName', account.legal_name,
        'invoiceReference', 'INV-' || invoice.id::text,
        'collectedRevenue', jsonb_build_object('currency', statement.currency, 'minorUnits', line.net_collected_revenue_minor::text),
        'commissionRateBasisPoints', accrual.rate_bps,
        'earned', jsonb_build_object('currency', statement.currency, 'minorUnits', line.commission_minor::text)
      ) order by line.id), '[]'::jsonb) as document_lines
    from public.core_commission_statements statement
    join public.core_commission_statement_lines line on line.statement_id = statement.id
    join public.commission_accruals accrual on accrual.id = line.accrual_id
    join public.invoices invoice on invoice.id = accrual.invoice_id
    join public.orders source_order on source_order.id = invoice.order_id
    join public.accounts account on account.id = source_order.account_id
    where statement.id = ${request.subjectId}::uuid
    group by statement.id
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_INCOMPLETE");
  const accountId = text(row, "partner_account_id");
  const recipient = await accountPresentation(transaction, accountId);
  const currency = CurrencySchema.parse(row.currency);
  const lines = z
    .array(CommissionDocumentLineSchema)
    .min(1)
    .parse(row.document_lines);
  const sourceVersion = String(integer(row, "row_version"));
  return finalized({
    accountId,
    audience: "partner",
    audienceAccountId: accountId,
    subjectType: "commission_statement",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "created_at")),
    input: {
      kind: "commission_statement",
      documentId: `COM-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "updated_at"),
      locale: recipient.locale,
      issuer: platformIssuer(),
      recipient: recipient.party,
      statementNumber: `COM-${text(row, "id")}`,
      period: {
        startDate: localDate(row, "period_starts_on"),
        endDate: localDate(row, "period_ends_on"),
      },
      lines,
      grossCommission: money(currency, text(row, "gross_accrued_minor")),
      clawbacks: money(currency, `-${text(row, "clawback_minor")}`),
      holdback: money(currency, `-${text(row, "holdback_minor")}`),
      netPayable: money(currency, text(row, "payable_minor")),
      paymentStatus: text(row, "status"),
    },
  });
}

async function renewalSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select action.*, source_order.account_id as customer_account_id,
           source_order.partner_account_id, source_order.sourcing,
           source_order.service_starts_on, source_order.service_ends_on,
           source_order.agreement_id, agreement.renewal_type,
           actor.name as actor_name
    from public.lifecycle_renewal_actions action
    join public.orders source_order on source_order.id = action.order_id
    join public.agreements agreement on agreement.id = source_order.agreement_id
    join public.commerce_users actor on actor.id = action.actor_user_id
    where action.id = ${request.subjectId}::uuid
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
  const isDecline = text(row, "action") === "decline";
  if (isDecline !== (request.kind === "decline_confirmation"))
    throw new Error("ARTIFACT_SOURCE_KIND_MISMATCH");
  const accountId =
    text(row, "sourcing") === "direct"
      ? text(row, "customer_account_id")
      : nullableText(row, "partner_account_id");
  if (!accountId) throw new Error("ARTIFACT_AUDIENCE_SOURCE_INCOMPLETE");
  const recipient = await accountPresentation(transaction, accountId);
  const payload = object(row, "payload");
  const sourceVersion = HashSchema.parse(row.evidence_hash);
  const embeddedEvidenceHash =
    typeof payload.evidenceHash === "string"
      ? HashSchema.parse(payload.evidenceHash)
      : null;
  const evidenceBody = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== "evidenceHash"),
  );
  if (
    (embeddedEvidenceHash !== null && embeddedEvidenceHash !== sourceVersion) ||
    createHash("sha256").update(canonicalJson(evidenceBody)).digest("hex") !==
      sourceVersion
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const startsOn = localDate(row, "service_starts_on");
  const endsOn = localDate(row, "service_ends_on");
  const nextStarts = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .parse(payload.proposedStartsOn);
  const nextEnds = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .parse(payload.proposedEndsOn);
  return finalized({
    accountId,
    audience: request.audience,
    audienceAccountId: accountId,
    subjectType: "renewal_action",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "created_at")),
    input: {
      kind: request.kind as "renewal_confirmation" | "decline_confirmation",
      documentId: `${isDecline ? "DEC" : "REN"}-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "created_at"),
      locale: recipient.locale,
      issuer: platformIssuer(),
      recipient: recipient.party,
      confirmationNumber: `${isDecline ? "DEC" : "REN"}-${text(row, "id")}`,
      orderReference: `ORD-${text(row, "order_id")}`,
      agreementReference: text(row, "agreement_id"),
      currentTerm: { startDate: startsOn, endDate: endsOn },
      ...(!isDecline && nextStarts && nextEnds
        ? { nextTerm: { startDate: nextStarts, endDate: nextEnds } }
        : {}),
      ...(isDecline
        ? {
            noticeServedOn: z.string().date().parse(payload.servedOn),
          }
        : {}),
      effectiveDate: isDecline ? endsOn : (nextStarts ?? endsOn),
      renewalType: isDecline
        ? text(row, "renewal_type") === "auto_renew"
          ? "automatic"
          : "expires"
        : "manual",
      recordedBy: text(row, "actor_name"),
      confirmationText: isDecline
        ? `A non-renewal decline was recorded. Exact notice text SHA-256: ${HashSchema.parse(payload.exactDeclineTextHash)}.`
        : `Renewal action ${text(row, "action")} was recorded for the next service term.`,
    },
  });
}

async function deletionSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select certificate.*, termination.account_id, termination.order_id,
           plan.plan, account.legal_name,
           request_event.after as request_evidence
    from public.deletion_certificates certificate
    join public.terminations termination on termination.id = certificate.termination_id
    join public.lifecycle_offboarding_plans plan on plan.termination_id = termination.id
    join public.accounts account on account.id = termination.account_id
    left join lateral (
      select event.after from public.audit_events event
      where event.event_type = 'termination.deletion_certificate_requested'
        and event.after->'certificateRequest'->>'terminationId' = termination.id::text
      order by event.occurred_at desc, event.id desc limit 1
    ) request_event on true
    where certificate.id = ${request.subjectId}::uuid
    limit 1
  `);
  const row = rows[0];
  if (!row || !row.request_evidence)
    throw new Error("ARTIFACT_SOURCE_INCOMPLETE");
  const accountId = text(row, "account_id");
  const recipient = await accountPresentation(transaction, accountId);
  const evidence = object(row, "request_evidence");
  const certificateRequest = z
    .object({
      certificateNumber: z.string().min(1),
      account: PartySchema.pick({ legalName: true, address: true }),
      deletionMethod: z.string().min(1),
      completedAt: z.string().datetime({ offset: true }),
      deletedScope: z.array(z.string().min(1)).min(1),
      retainedObjectExclusions: z
        .array(
          z
            .object({
              objectId: z.string().min(1),
              scope: z.string().min(1),
              retainUntil: z.string().datetime({ offset: true }),
              reason: z.enum(["legal_hold", "object_lock_retention"]),
            })
            .passthrough(),
        )
        .default([]),
      approvals: z.array(
        z
          .object({
            approverId: z.string().min(1),
            approverName: z.string().min(1),
            role: z.string().min(1),
            approvedAt: z.string().datetime({ offset: true }),
          })
          .passthrough(),
      ),
      providerEvidence: z
        .object({
          operationId: z.string().min(1),
          confirmationId: z.string().min(1),
        })
        .passthrough(),
      retainUntil: z.string().datetime({ offset: true }),
      requestHash: HashSchema,
    })
    .passthrough()
    .parse(evidence.certificateRequest);
  const { requestHash, ...certificateRequestBody } = certificateRequest;
  if (
    createHash("sha256")
      .update(canonicalJson(certificateRequestBody))
      .digest("hex") !== requestHash ||
    canonicalJson(row.locked_exclusions) !==
      canonicalJson(certificateRequest.retainedObjectExclusions)
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const sourceVersion = requestHash;
  return finalized({
    accountId,
    audience: request.audience,
    audienceAccountId: accountId,
    subjectType: "deletion_certificate",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: certificateRequest.retainUntil,
    input: {
      kind: "deletion_certificate",
      documentId: `DEL-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "completed_at"),
      locale: recipient.locale,
      issuer: platformIssuer(),
      recipient: recipient.party,
      certificateNumber: certificateRequest.certificateNumber,
      accountReference: text(row, "legal_name"),
      ...(nullableText(row, "order_id")
        ? { orderReference: `ORD-${nullableText(row, "order_id")}` }
        : {}),
      deletionScope: certificateRequest.deletedScope,
      deletionMethod: certificateRequest.deletionMethod,
      completedAt: certificateRequest.completedAt,
      orchestratorConfirmation: `${certificateRequest.providerEvidence.operationId}:${certificateRequest.providerEvidence.confirmationId}`,
      retentionExclusions: certificateRequest.retainedObjectExclusions.map(
        (exclusion) => ({
          id: exclusion.objectId,
          scope: exclusion.scope,
          reason: exclusion.reason,
          retentionExpiresOn: exclusion.retainUntil.slice(0, 10),
        }),
      ),
      approvedBy: certificateRequest.approvals.map((approval) => ({
        name: approval.approverName,
        role: approval.role,
        approvedAt: approval.approvedAt,
      })),
    },
  });
}

async function reconciliationSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select * from public.core_marketplace_reconciliations
    where id = ${request.subjectId}::uuid limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_NOT_FOUND");
  const issuer = platformIssuer();
  const currency = CurrencySchema.parse(row.currency);
  const sourceVersion = String(integer(row, "row_version"));
  const resolution = nullableText(row, "resolution");
  return finalized({
    accountId: null,
    audience: "internal",
    audienceAccountId: null,
    subjectType: "marketplace_reconciliation",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion,
    retainUntil: addYears(instant(row, "created_at")),
    input: {
      kind: "reconciliation_report",
      documentId: `REC-${text(row, "id")}`,
      version: sourceVersion,
      issuedAt: instant(row, "updated_at"),
      locale: "en-US",
      issuer,
      recipient: issuer,
      reportTitle: `${text(row, "provider")} marketplace reconciliation`,
      period: {
        startDate: localDate(row, "period_starts_on"),
        endDate: localDate(row, "period_ends_on"),
      },
      generatedAt: instant(row, "updated_at"),
      basis: "Persisted provider and platform gross and fee ledgers",
      status: text(row, "status"),
      columns: [
        { key: "measure", label: "Measure" },
        { key: "provider", label: "Provider", align: "right" },
        { key: "platform", label: "Platform", align: "right" },
      ],
      rows: [
        {
          id: "gross",
          values: {
            measure: "Gross",
            provider: `${currency} ${text(row, "provider_gross_minor")}`,
            platform: `${currency} ${text(row, "platform_gross_minor")}`,
          },
        },
        {
          id: "fees",
          values: {
            measure: "Fees",
            provider: `${currency} ${text(row, "provider_fees_minor")}`,
            platform: `${currency} ${text(row, "platform_fees_minor")}`,
          },
        },
      ],
      summary: [
        {
          id: "variance",
          label: "Variance",
          value: `${currency} ${text(row, "variance_minor")}`,
          ...(resolution ? { detail: resolution } : {}),
        },
      ],
    },
  });
}

async function reportExportSource(
  transaction: RuntimeTransaction,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  const rows = await transaction.execute(sql<Row>`
    select report.*, document.content_hash as document_content_hash,
           document.byte_length as document_byte_length
    from public.report_exports report
    join public.documents document on document.id = report.document_id
    where report.id = ${request.subjectId}::uuid and report.status = 'complete'
    limit 1
  `);
  const row = rows[0];
  if (!row) throw new Error("ARTIFACT_SOURCE_INCOMPLETE");
  const parameters = object(row, "parameters");
  const source = z
    .object({
      columns: z.array(z.string().min(1)),
      rows: z.array(
        z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
      ),
      rowCount: z.number().int().nonnegative(),
      sourceVersion: z.string().min(1).max(80),
      contentHash: HashSchema,
      byteLength: z.number().int().positive(),
    })
    .parse(parameters.renderSource);
  if (source.rowCount !== source.rows.length)
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const rendered = renderedCsvHash(source.columns, source.rows);
  if (
    rendered.contentHash !== source.contentHash ||
    rendered.byteLength !== source.byteLength ||
    source.contentHash !== text(row, "document_content_hash") ||
    source.byteLength !== integer(row, "document_byte_length")
  )
    throw new Error("ARTIFACT_SOURCE_CORRUPT");
  const issuer = platformIssuer();
  const asOf = z.string().datetime({ offset: true }).parse(parameters.asOf);
  const from = z.string().date().optional().parse(parameters.from);
  const to = z.string().date().optional().parse(parameters.to);
  const report = text(row, "report");
  const titles: Record<string, string> = {
    revenue_forecast: "Revenue forecast",
    capacity_planning: "Capacity planning",
    renewal_churn_exposure: "Renewal and churn exposure",
    partner_performance: "Partner performance",
    funnel_cycle_time: "Funnel cycle time",
    margin_poc_cost: "Margin and POC cost",
    weekly_scorecard: "Weekly scorecard",
  };
  const reportTitle = titles[report];
  if (!reportTitle) throw new Error("ARTIFACT_REPORT_TYPE_INVALID");
  return finalized({
    accountId: null,
    audience: "internal",
    audienceAccountId: null,
    subjectType: "report_export",
    subjectId: text(row, "id"),
    kind: request.kind,
    sourceVersion: source.sourceVersion,
    retainUntil: z
      .string()
      .datetime({ offset: true })
      .parse(parameters.retainUntil),
    input: {
      kind: "report_export",
      documentId: `RPT-${text(row, "id")}`,
      version: source.sourceVersion,
      issuedAt: instant(row, "updated_at"),
      locale: "en-US",
      issuer,
      recipient: issuer,
      reportTitle,
      period: {
        startDate: from ?? asOf.slice(0, 10),
        endDate: to ?? asOf.slice(0, 10),
      },
      generatedAt: instant(row, "updated_at"),
      basis: `${report}; source ${source.sourceVersion}`,
      status: "complete",
      columns: source.columns.map((column) => ({
        key: column,
        label: column.replaceAll("_", " "),
      })),
      rows: source.rows.map((values, index) => ({
        id: createHash("sha256")
          .update(canonicalJson({ index, values }))
          .digest("hex")
          .slice(0, 24),
        values: Object.fromEntries(
          source.columns.map((column) => [
            column,
            values[column] === null || values[column] === undefined
              ? ""
              : String(values[column]),
          ]),
        ),
      })),
      summary: [
        { id: "row-count", label: "Rows", value: String(source.rowCount) },
        { id: "csv-hash", label: "CSV SHA-256", value: source.contentHash },
      ],
    },
  });
}

export async function resolveArtifactSource(
  transaction: RuntimeTransaction,
  session: SessionClaims,
  request: ArtifactSourceRequest,
): Promise<ResolvedArtifactSource> {
  let source: ResolvedArtifactSource;
  if (
    [
      "direct_quote",
      "partner_transfer_quote",
      "partner_resale_quote",
      "order_form",
      "amendment",
    ].includes(request.kind)
  )
    source = await commercialSource(transaction, request);
  else if (["poc_summary", "poc_final_report"].includes(request.kind))
    source = await pocSource(transaction, request);
  else if (["invoice_companion", "receipt"].includes(request.kind))
    source = await invoiceSource(transaction, request);
  else if (request.kind === "commission_statement")
    source = await commissionSource(transaction, request);
  else if (
    ["renewal_confirmation", "decline_confirmation"].includes(request.kind)
  )
    source = await renewalSource(transaction, request);
  else if (request.kind === "deletion_certificate")
    source = await deletionSource(transaction, request);
  else if (request.kind === "reconciliation_report")
    source = await reconciliationSource(transaction, request);
  else source = await reportExportSource(transaction, request);

  assertScope(session, request, source);
  if (source.sourceVersion !== request.expectedVersion)
    throw new ExperienceProblem(
      409,
      "ARTIFACT_SOURCE_VERSION_CONFLICT",
      "The artifact source changed; reload before requesting a render",
    );
  verifyResolvedArtifactSource(source);
  return source;
}
