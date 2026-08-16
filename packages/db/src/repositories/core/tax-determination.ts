import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { MoneySchema } from "@clockwork/contracts";
import type {
  TaxDeterminationRequest,
  TaxDeterminationResult,
  TaxRegistration,
  TaxRoundingConvention,
  TaxSupplyType,
  TaxTreatment,
} from "@clockwork/contracts";
import {
  composeTaxRuleBook,
  determineTax as runTaxEngine,
  EXEMPTION_CERTIFICATE_KIND,
  PersistedTaxRuleBookError,
  TaxDeterminationError,
  type PersistedTaxRuleBookRow,
} from "@clockwork/domain/core";

import type { RuntimeTransaction } from "../../client";
import { accounts, orderLines } from "../../schema";
import {
  accountTaxIdentifiers,
  orderLineSnapshots,
  procurementCertificates,
} from "../../schema/core/finance";
import {
  legalEntities,
  orderSupplierBindings,
  taxRates,
  taxRegistrations,
  taxRuleBooks,
} from "../../schema/core/tax";

/**
 * THE TAX PATH, WIRED TO BOTH SIDES OF THE TRANSACTION.
 *
 * What this replaces, verbatim from the contract it is replacing
 * (`TaxPort.calculate`, deprecated in packages/contracts/src/providers.ts:361):
 * one `jurisdiction: string` documented as "the merchant-of-record side" and
 * populated with the INVOICED account's country. On a resale or distributor
 * route the invoiced account is the partner — our own customer — so a US entity
 * selling to a Spanish reseller determined against ES and would have billed
 * Spanish VAT on a supply that is not Spanish. There was no supplier in the
 * request at all, so no place-of-supply rule could be applied to it.
 *
 * Here the supplier is the entity the order was BOUND to at acceptance (001416)
 * and the customer is the invoiced account, which is the party we contract
 * with. `merchantOfRecord(route)` is consulted through that binding rather than
 * re-derived, so the word on the commercial profile and the entity behind it
 * cannot disagree.
 *
 * WHERE THE RULES LIVE. Nothing in this file knows a rate, a country, a postal
 * range, a threshold or a scheme. It reads `core_tax_rule_books` and
 * `core_tax_rates`, composes them into the rule book the domain engine consumes
 * (`composeTaxRuleBook`), and calls that engine. Two callers, one algorithm: the
 * demo runs the same engine over the same seeded books.
 */

/** A determination that cannot be made, with the code that says which refusal. */
export class TaxDeterminationUnavailableError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TaxDeterminationUnavailableError";
  }
}

export interface PersistedTaxLine {
  lineId: string;
  jurisdiction: string;
  treatment: TaxTreatment;
  taxCode: string;
  ratePpm: number;
  rateKind: string;
  taxableMinor: bigint;
  taxMinor: bigint;
  ruleBookId: string;
  ruleBookVersion: number;
  legalBasis: string;
  notation: string;
}

export interface TaxDeterminationDetail {
  determinationId: string;
  supplierLegalEntityId: string;
  supplierRegistrationId?: string;
  customerAccountId: string;
  customerRegistrationId?: string;
  customerStatus: "business" | "consumer";
  placeOfSupply: readonly string[];
  taxPointDate: string;
  confidence: "determined" | "review_required";
  reviewReasons: readonly string[];
  rounding: TaxRoundingConvention;
  inputProvenance: "unverified" | "repository_fixture" | "live_signed";
  determinationInput: Record<string, unknown>;
  determinationInputHash: string;
  lines: readonly PersistedTaxLine[];
}

/** The line the request was built from, kept so the invoice writer can see it. */
export interface TaxRequestLineSource {
  lineId: string;
  taxCode: string;
  netMinor: bigint;
}

/**
 * The supply type every line on this platform has.
 *
 * The catalogue supplies storage capacity over a network and nothing else:
 * there is no goods line and no non-electronic service in `rate_cards`, whose
 * columns are sku, region, unit and egress treatment. This is therefore a fact
 * about what we sell rather than a rule about tax, and it is stated once here
 * rather than guessed per call. The day a rate card can be something else, this
 * becomes a rate-card column and the constant goes; a nullable column now,
 * populated by nobody, would be the declaration this project keeps refusing.
 */
const PLATFORM_SUPPLY_TYPE: TaxSupplyType = "digital_service";

/** Canonical JSON, sorted the way `private.canonical_jsonb_text` (001300) sorts. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The message a Postgres raise carried, past whatever wrapped it. */
function postgresMessage(error: unknown): string | undefined {
  for (let held = error; held instanceof Error; held = held.cause) {
    const message = (held as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim() &&
      !message.startsWith("Failed query")
    )
      return message;
    if (!(held.cause instanceof Error)) return undefined;
  }
  return undefined;
}

export function canonicalTaxHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * The determination's own identifier, derived from the question rather than
 * generated. Two runs of the same question are the same determination, which is
 * what makes an idempotent replay of an invoice command land the same row
 * instead of a second answer with a new name.
 */
function determinationIdFor(inputHash: string): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update("tax-determination")
      .update("\0")
      .update(inputHash)
      .digest(),
  ).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function taxDay(value: string): string {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new TaxDeterminationUnavailableError(
      "TAX_POINT_INVALID",
      `A tax point must be a calendar date, not ${value}`,
    );
  return day;
}

interface AddressShape {
  country: string;
  region?: string;
  postalCode?: string;
}

function addressOf(value: unknown, fallbackCountry: string): AddressShape {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string): string | undefined => {
    const held = record[key];
    return typeof held === "string" && held.trim() ? held.trim() : undefined;
  };
  return {
    country: (text("country") ?? fallbackCountry).toUpperCase(),
    ...(text("region") ? { region: text("region") as string } : {}),
    ...(text("postalCode") ? { postalCode: text("postalCode") as string } : {}),
  };
}

/**
 * OUR registrations, as the engine reads them.
 *
 * `verifiedAt` is the operator's statement date, which is what a registration of
 * ours actually has: 001410 requires an evidence document before a registration
 * may be `active`, and the statement with that evidence is the validation. It is
 * not invented — an unstated registration produces no row here at all, and the
 * engine's answer for a place we hold none in is `not_registered`.
 */
async function supplierRegistrationsFor(
  transaction: RuntimeTransaction,
  legalEntityId: string,
  day: string,
): Promise<{ registrations: TaxRegistration[]; ids: Map<string, string> }> {
  const rows = await transaction
    .select({
      id: taxRegistrations.id,
      jurisdiction: taxRegistrations.jurisdiction,
      scheme: taxRegistrations.scheme,
      number: taxRegistrations.registrationNumber,
      statedAt: taxRegistrations.statedAt,
      effectiveTo: taxRegistrations.effectiveTo,
      evidenceDocumentId: taxRegistrations.evidenceDocumentId,
    })
    .from(taxRegistrations)
    .where(
      and(
        eq(taxRegistrations.legalEntityId, legalEntityId),
        eq(taxRegistrations.status, "active"),
        sql`${taxRegistrations.effectiveFrom} <= ${day}::date`,
        sql`(${taxRegistrations.effectiveTo} is null or ${day}::date < ${taxRegistrations.effectiveTo})`,
      ),
    );
  const ids = new Map<string, string>();
  const registrations = rows.map((row) => {
    const registration: TaxRegistration = {
      jurisdiction: row.jurisdiction,
      scheme: row.scheme,
      number: row.number,
      verifiedAt: row.statedAt.toISOString(),
      ...(row.effectiveTo ? { expiresAt: row.effectiveTo } : {}),
      ...(row.evidenceDocumentId
        ? { evidenceReference: row.evidenceDocumentId }
        : {}),
    };
    ids.set(registrationKey(registration), row.id);
    return registration;
  });
  return { registrations, ids };
}

function registrationKey(registration: TaxRegistration): string {
  return `${registration.jurisdiction}|${registration.scheme}|${registration.number}`;
}

/**
 * The customer side, read whole and judged by the engine.
 *
 * There is deliberately no `day` parameter: neither a registration's validation
 * age nor a certificate's window is filtered in SQL. Both are the engine's
 * judgements — an unvalidated number downgrades the customer and raises a
 * review reason, a lapsed certificate raises another — and filtering them out
 * here would hide exactly the facts those reasons are raised about.
 */
async function customerSideFor(
  transaction: RuntimeTransaction,
  accountId: string,
): Promise<{
  registrations: TaxRegistration[];
  ids: Map<string, string>;
  certificates: TaxDeterminationRequest["customer"]["exemptionCertificates"];
}> {
  const [identifiers, certificates] = await Promise.all([
    transaction
      .select({
        id: accountTaxIdentifiers.id,
        jurisdiction: accountTaxIdentifiers.jurisdiction,
        type: accountTaxIdentifiers.type,
        normalizedValue: accountTaxIdentifiers.normalizedValue,
        validatedAt: accountTaxIdentifiers.validatedAt,
        verificationReference: accountTaxIdentifiers.verificationReference,
      })
      .from(accountTaxIdentifiers)
      .where(
        and(
          eq(accountTaxIdentifiers.accountId, accountId),
          eq(accountTaxIdentifiers.validationStatus, "valid"),
        ),
      ),
    transaction
      .select({
        jurisdiction: procurementCertificates.jurisdiction,
        certificateNumber: procurementCertificates.certificateNumber,
        validFrom: procurementCertificates.validFrom,
        expiresOn: procurementCertificates.expiresOn,
        documentId: procurementCertificates.documentId,
      })
      .from(procurementCertificates)
      .where(
        and(
          eq(procurementCertificates.accountId, accountId),
          eq(procurementCertificates.kind, EXEMPTION_CERTIFICATE_KIND),
          eq(procurementCertificates.status, "valid"),
        ),
      ),
  ]);
  const ids = new Map<string, string>();
  const registrations = identifiers.map((row) => {
    const registration: TaxRegistration = {
      jurisdiction: row.jurisdiction,
      scheme: row.type,
      number: row.normalizedValue,
      // A `valid` identifier carries `validated_at` by CHECK constraint
      // (core_account_tax_identifiers_check), so this is a read and not a
      // default. An unvalidated number reaches the engine with no
      // `verifiedAt`, which downgrades the customer to a consumer and raises a
      // review reason — the engine's rule, not this file's.
      ...(row.validatedAt ? { verifiedAt: row.validatedAt.toISOString() } : {}),
      ...(row.verificationReference
        ? { evidenceReference: row.verificationReference }
        : {}),
    };
    ids.set(registrationKey(registration), row.id);
    return registration;
  });
  return {
    registrations,
    ids,
    certificates: certificates
      .filter((row) => row.jurisdiction && row.certificateNumber)
      .map((row) => ({
        jurisdiction: row.jurisdiction as string,
        certificateId: row.certificateNumber as string,
        ...(row.validFrom ? { validFrom: row.validFrom } : {}),
        ...(row.expiresOn ? { validUntil: row.expiresOn } : {}),
        evidenceReference: row.documentId,
      })),
  };
}

/**
 * The persisted books behind a set of ids, in the shape the composer reads.
 *
 * Shared by the determination path and by the replay: a replay that assembled
 * its books differently would be testing a second implementation, and the whole
 * value of the replay is that it runs the same code over a stored question.
 */
export async function loadPersistedRuleBooks(
  transaction: RuntimeTransaction,
  bookIds: readonly string[],
): Promise<PersistedTaxRuleBookRow[]> {
  if (bookIds.length === 0)
    throw new TaxDeterminationUnavailableError(
      "TAX_RULE_BOOK_UNRESOLVED",
      "A determination names no rule book",
    );
  const [books, rates] = await Promise.all([
    transaction
      .select()
      .from(taxRuleBooks)
      .where(inArray(taxRuleBooks.id, [...bookIds])),
    transaction
      .select()
      .from(taxRates)
      .where(inArray(taxRates.taxRuleBookId, [...bookIds])),
  ]);
  if (books.length !== bookIds.length)
    throw new TaxDeterminationUnavailableError(
      "TAX_RULE_BOOK_UNRESOLVED",
      `Only ${books.length} of ${bookIds.length} pinned rule books exist`,
    );
  return books
    .map((book) => ({
      id: book.id,
      jurisdiction: book.jurisdiction,
      version: book.version,
      effectiveFrom: book.effectiveFrom,
      ...(book.effectiveTo ? { effectiveTo: book.effectiveTo } : {}),
      determinationSource: book.determinationSource,
      inputProvenance: book.inputProvenance,
      ruleParameters: book.ruleParameters,
      rates: rates
        .filter((rate) => rate.taxRuleBookId === book.id)
        .map((rate) => ({
          taxCode: rate.taxCode,
          rateKind: rate.rateKind,
          ratePpm: Number(rate.ratePpm),
          legalBasis: rate.legalBasis,
          notation: rate.notation,
        }))
        .sort((left, right) => left.taxCode.localeCompare(right.taxCode)),
    }))
    .sort((left, right) => left.jurisdiction.localeCompare(right.jurisdiction));
}

/**
 * THE STORED QUESTION, READ BACK.
 *
 * `determination_input` is stored so a past answer can be reproduced, and a
 * question that cannot be parsed back into the request that produced it is not
 * a question. This is validated rather than cast: a stored input that has
 * drifted from the shape the engine reads fails here, loudly, in the replay,
 * which is the only place anybody would find out.
 */
const StoredRegistrationSchema = z
  .object({
    jurisdiction: z.string(),
    scheme: z.string(),
    number: z.string(),
    verifiedAt: z.string().optional(),
    expiresAt: z.string().optional(),
    evidenceReference: z.string().optional(),
  })
  .strict();

export const StoredDeterminationInputSchema = z
  .object({
    orderId: z.string(),
    documentType: z.enum(["invoice", "credit_note", "proforma"]),
    taxPointDate: z.string(),
    currency: z.enum(["USD", "EUR", "GBP"]),
    supplier: z
      .object({
        legalEntityId: z.string(),
        establishedCountry: z.string(),
        registrations: z.array(StoredRegistrationSchema),
      })
      .strict(),
    customer: z
      .object({
        accountId: z.string(),
        country: z.string(),
        address: z
          .object({
            country: z.string(),
            region: z.string().optional(),
            postalCode: z.string().optional(),
          })
          .strict(),
        status: z.enum(["business", "consumer"]),
        registrations: z.array(StoredRegistrationSchema),
        exemptionCertificates: z.array(
          z
            .object({
              jurisdiction: z.string(),
              certificateId: z.string(),
              validFrom: z.string().optional(),
              validUntil: z.string().optional(),
              reason: z.string().optional(),
              evidenceReference: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    lines: z.array(
      z
        .object({
          lineId: z.string(),
          taxCode: z.string(),
          supplyType: z.enum(["service", "digital_service", "goods"]),
          netMinor: z.string(),
        })
        .strict(),
    ),
    ruleBooks: z.array(
      z
        .object({
          id: z.string(),
          jurisdiction: z.string(),
          version: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * Rebuilds an optional-property record without the undefined keys.
 * `exactOptionalPropertyTypes` distinguishes "absent" from "present and
 * undefined", and a replayed registration must be the first, or the engine's
 * validity rules would read a key that was never stored.
 */
function storedRegistration(row: {
  jurisdiction: string;
  scheme: string;
  number: string;
  verifiedAt?: string | undefined;
  expiresAt?: string | undefined;
  evidenceReference?: string | undefined;
}): TaxRegistration {
  return {
    jurisdiction: row.jurisdiction,
    scheme: row.scheme,
    number: row.number,
    ...(row.verifiedAt === undefined ? {} : { verifiedAt: row.verifiedAt }),
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
    ...(row.evidenceReference === undefined
      ? {}
      : { evidenceReference: row.evidenceReference }),
  };
}

export function taxRequestFromStoredInput(value: unknown): {
  request: TaxDeterminationRequest;
  ruleBookIds: string[];
  determinationId: string;
  inputHash: string;
} {
  const parsed = StoredDeterminationInputSchema.parse(value);
  const inputHash = canonicalTaxHash(parsed);
  return {
    request: {
      supplier: {
        legalEntityId: parsed.supplier.legalEntityId,
        establishedCountry: parsed.supplier.establishedCountry,
        registrations: parsed.supplier.registrations.map(storedRegistration),
      },
      customer: {
        accountId: parsed.customer
          .accountId as TaxDeterminationRequest["customer"]["accountId"],
        country: parsed.customer.country,
        address: {
          country: parsed.customer.address.country,
          ...(parsed.customer.address.region === undefined
            ? {}
            : { region: parsed.customer.address.region }),
          ...(parsed.customer.address.postalCode === undefined
            ? {}
            : { postalCode: parsed.customer.address.postalCode }),
        },
        status: parsed.customer.status,
        registrations: parsed.customer.registrations.map(storedRegistration),
        exemptionCertificates: parsed.customer.exemptionCertificates.map(
          (certificate) => ({
            jurisdiction: certificate.jurisdiction,
            certificateId: certificate.certificateId,
            ...(certificate.validFrom === undefined
              ? {}
              : { validFrom: certificate.validFrom }),
            ...(certificate.validUntil === undefined
              ? {}
              : { validUntil: certificate.validUntil }),
            ...(certificate.reason === undefined
              ? {}
              : { reason: certificate.reason }),
            ...(certificate.evidenceReference === undefined
              ? {}
              : { evidenceReference: certificate.evidenceReference }),
          }),
        ),
      },
      lines: parsed.lines.map((line) => ({
        lineId: line.lineId,
        taxCode: line.taxCode,
        supplyType: line.supplyType,
        netAmount: MoneySchema.parse({
          currency: parsed.currency,
          minor: line.netMinor,
        }),
      })),
      taxPointDate: parsed.taxPointDate,
      documentType: parsed.documentType,
    },
    ruleBookIds: parsed.ruleBooks.map((book) => book.id),
    determinationId: determinationIdFor(inputHash),
    inputHash,
  };
}

async function persistedRuleBooksFor(
  transaction: RuntimeTransaction,
  input: {
    supplierCountry: string;
    customerAddress: AddressShape;
    day: string;
    pinnedRuleBookIds?: readonly string[];
  },
): Promise<PersistedTaxRuleBookRow[]> {
  const pinned = input.pinnedRuleBookIds ?? [];
  // Which books answer is the database's question, not this file's: the place
  // an address falls in is decided by the postal prefixes the books declare
  // (001417), the window rule is 001413's, and a pinned reversal reads no date
  // at all.
  // The resolver RAISES when a question has no answer, and that raise is the
  // refusal — not a driver error. It is caught here and given its code so the
  // caller sees "no book answers" rather than "failed query".
  const resolved = await transaction
    .execute<{ id: string }>(
      sql`
    select id from public.core_tax_rule_books_for_supply(
      ${input.supplierCountry},
      ${input.customerAddress.country},
      ${input.customerAddress.region ?? null},
      ${input.customerAddress.postalCode ?? null},
      ${input.day}::date,
      ${
        pinned.length > 0
          ? sql`(select array_agg(pin.value::uuid)
                 from jsonb_array_elements_text(${JSON.stringify(pinned)}::jsonb) pin)`
          : sql`null::uuid[]`
      }
    ) as id
  `,
    )
    .catch((error: unknown) => {
      throw new TaxDeterminationUnavailableError(
        "TAX_RULE_BOOK_UNRESOLVED",
        postgresMessage(error) ??
          `No tax rule book answers for ${input.supplierCountry} and ${input.customerAddress.country} on ${input.day}`,
      );
    });
  const bookIds = [...resolved].map((row) => row.id);
  if (bookIds.length === 0)
    throw new TaxDeterminationUnavailableError(
      "TAX_RULE_BOOK_UNRESOLVED",
      `No tax rule book answers for ${input.supplierCountry} and ${input.customerAddress.country} on ${input.day}`,
    );
  const [books, rates] = await Promise.all([
    transaction
      .select()
      .from(taxRuleBooks)
      .where(inArray(taxRuleBooks.id, bookIds)),
    transaction
      .select()
      .from(taxRates)
      .where(inArray(taxRates.taxRuleBookId, bookIds)),
  ]);
  return books
    .map((book) => ({
      id: book.id,
      jurisdiction: book.jurisdiction,
      version: book.version,
      effectiveFrom: book.effectiveFrom,
      ...(book.effectiveTo ? { effectiveTo: book.effectiveTo } : {}),
      determinationSource: book.determinationSource,
      inputProvenance: book.inputProvenance,
      ruleParameters: book.ruleParameters,
      rates: rates
        .filter((rate) => rate.taxRuleBookId === book.id)
        .map((rate) => ({
          taxCode: rate.taxCode,
          rateKind: rate.rateKind,
          ratePpm: Number(rate.ratePpm),
          legalBasis: rate.legalBasis,
          notation: rate.notation,
        }))
        .sort((left, right) => left.taxCode.localeCompare(right.taxCode)),
    }))
    .sort((left, right) => left.jurisdiction.localeCompare(right.jurisdiction));
}

const PROVENANCE_ORDER = [
  "unverified",
  "repository_fixture",
  "live_signed",
] as const;

/**
 * The scalar the invoice header records for a document whose lines may
 * disagree, and the review reason that says information was lost saying it.
 *
 * A non-zero amount can only be `standard`: `invoices_tax_amount_check` says so
 * and 001415 explains why every other treatment is zero by definition. For a
 * zero document with more than one treatment the header takes the one that most
 * needs a human's eye — a threshold breach before a reverse charge, a reverse
 * charge before a supply nobody taxed — because the header is what a
 * reconciliation reads first.
 */
const HEADER_PRECEDENCE: readonly TaxTreatment[] = [
  "not_registered",
  "reverse_charge",
  "out_of_scope",
  "exempt",
  "zero_rated",
  "standard",
];

function headerTreatment(
  result: TaxDeterminationResult,
  reviewReasons: string[],
): TaxTreatment {
  const treatments = new Set(result.lines.map((line) => line.treatment));
  if (treatments.size > 1)
    reviewReasons.push("mixed_treatments_summarised_at_invoice_header");
  if (BigInt(result.totals.taxMinor) !== 0n) return "standard";
  if (treatments.size === 1) return [...treatments][0] as TaxTreatment;
  return (
    HEADER_PRECEDENCE.find((treatment) => treatments.has(treatment)) ??
    "standard"
  );
}

interface DeterminationSubject {
  orderId: string;
  supplierLegalEntityId: string;
  customerAccountId: string;
  lines: readonly TaxRequestLineSource[];
  currency: string;
  documentType: "invoice" | "credit_note" | "proforma";
  taxPointDate: string;
  pinnedRuleBookIds?: readonly string[];
}

/**
 * Determines one document from persisted truth, and returns both the answer and
 * the question it was asked.
 */
export async function determineTaxForSubject(
  transaction: RuntimeTransaction,
  subject: DeterminationSubject,
): Promise<{
  detail: TaxDeterminationDetail;
  result: TaxDeterminationResult;
  currency: string;
  netMinor: bigint;
  taxMinor: bigint;
  treatment: TaxTreatment;
}> {
  const day = taxDay(subject.taxPointDate);
  if (subject.lines.length === 0)
    throw new TaxDeterminationUnavailableError(
      "TAX_REQUEST_EMPTY",
      "A determination needs at least one line",
    );
  const [supplier] = await transaction
    .select()
    .from(legalEntities)
    .where(eq(legalEntities.id, subject.supplierLegalEntityId));
  const [customer] = await transaction
    .select()
    .from(accounts)
    .where(eq(accounts.id, subject.customerAccountId));
  if (!supplier || !customer)
    throw new TaxDeterminationUnavailableError(
      "TAX_PARTIES_INCOMPLETE",
      "A determination needs a persisted supplier entity and customer account",
    );

  const [supplierSide, customerSide] = await Promise.all([
    supplierRegistrationsFor(transaction, supplier.id, day),
    customerSideFor(transaction, customer.id),
  ]);
  const address = addressOf(customer.registeredAddress, customer.country);

  const request: TaxDeterminationRequest = {
    supplier: {
      legalEntityId: supplier.id,
      establishedCountry: supplier.establishedCountry,
      registrations: supplierSide.registrations,
    },
    customer: {
      accountId:
        customer.id as TaxDeterminationRequest["customer"]["accountId"],
      country: customer.country,
      address,
      // Every counterparty in this schema is a company: `accounts` carries a
      // legal name, a registered address and a relationship role, and there is
      // no consumer relationship in the vocabulary. Whether that company can
      // carry a reverse charge is decided by its registration, not by this
      // field — the engine downgrades an unvalidated business to a consumer and
      // says so in a review reason.
      status: "business",
      registrations: customerSide.registrations,
      exemptionCertificates: customerSide.certificates,
    },
    lines: subject.lines.map((line) => ({
      lineId: line.lineId,
      taxCode: line.taxCode,
      supplyType: PLATFORM_SUPPLY_TYPE,
      netAmount: MoneySchema.parse({
        currency: subject.currency,
        minor: line.netMinor.toString(),
      }),
    })),
    taxPointDate: day,
    documentType: subject.documentType,
  };

  const books = await persistedRuleBooksFor(transaction, {
    supplierCountry: supplier.establishedCountry,
    customerAddress: address,
    day,
    ...(subject.pinnedRuleBookIds
      ? { pinnedRuleBookIds: subject.pinnedRuleBookIds }
      : {}),
  });

  // THE QUESTION, canonically. Everything the engine is about to read and
  // nothing it is about to produce, so a replay reads this and reaches the same
  // answer or the build fails.
  const determinationInput = {
    orderId: subject.orderId,
    documentType: subject.documentType,
    taxPointDate: day,
    currency: subject.currency,
    supplier: {
      legalEntityId: supplier.id,
      establishedCountry: supplier.establishedCountry,
      registrations: supplierSide.registrations.map((registration) => ({
        ...registration,
      })),
    },
    customer: {
      accountId: customer.id,
      country: customer.country,
      address,
      status: "business",
      registrations: customerSide.registrations.map((registration) => ({
        ...registration,
      })),
      exemptionCertificates: customerSide.certificates.map((certificate) => ({
        ...certificate,
      })),
    },
    lines: subject.lines.map((line) => ({
      lineId: line.lineId,
      taxCode: line.taxCode,
      supplyType: PLATFORM_SUPPLY_TYPE,
      netMinor: line.netMinor.toString(),
    })),
    ruleBooks: books.map((book) => ({
      id: book.id,
      jurisdiction: book.jurisdiction,
      version: book.version.toString(),
    })),
  };
  const determinationInputHash = canonicalTaxHash(determinationInput);
  const determinationId = determinationIdFor(determinationInputHash);

  const result = runDetermination({
    determinationId,
    request,
    books,
  });

  const reviewReasons = [...result.reviewReasons];
  const treatment = headerTreatment(result, reviewReasons);
  // 001410's rule, honoured where the engine cannot honour it: no registration
  // in the place of supply is "no tax charged, the treatment recorded, an
  // exception raised". The engine is pure and raises nothing, so the exception
  // is raised here as a review reason on the persisted determination.
  if (result.lines.some((line) => line.treatment === "not_registered"))
    reviewReasons.push("supplier_not_registered_in_place_of_supply");

  const supplierRegistrationId = result.supplierRegistration
    ? supplierSide.ids.get(registrationKey(result.supplierRegistration))
    : undefined;
  const customerRegistrationId = result.customerRegistration
    ? customerSide.ids.get(registrationKey(result.customerRegistration))
    : undefined;
  const inputProvenance = books.reduce<(typeof PROVENANCE_ORDER)[number]>(
    (weakest, book) => {
      const provenance = PROVENANCE_ORDER.find(
        (candidate) => candidate === book.inputProvenance,
      );
      if (!provenance)
        throw new TaxDeterminationUnavailableError(
          "TAX_RULE_BOOK_PROVENANCE_UNKNOWN",
          `Rule book ${book.jurisdiction} states a provenance the determination cannot rank: ${book.inputProvenance}`,
        );
      return PROVENANCE_ORDER.indexOf(provenance) <
        PROVENANCE_ORDER.indexOf(weakest)
        ? provenance
        : weakest;
    },
    "live_signed",
  );

  return {
    detail: {
      determinationId,
      supplierLegalEntityId: supplier.id,
      ...(supplierRegistrationId ? { supplierRegistrationId } : {}),
      customerAccountId: customer.id,
      ...(customerRegistrationId ? { customerRegistrationId } : {}),
      // The status the determination was ACTUALLY made under. Every account in
      // this schema is a company, so the question is always asked as
      // `business`; the engine downgrades one whose registration it cannot use
      // and says so in a review reason, and that downgrade is what this column
      // records.
      customerStatus: reviewReasons.some((reason) =>
        reason.endsWith("_treated_as_consumer"),
      )
        ? "consumer"
        : "business",
      placeOfSupply: result.placeOfSupply,
      taxPointDate: day,
      confidence: reviewReasons.length === 0 ? "determined" : "review_required",
      reviewReasons: [...new Set(reviewReasons)],
      rounding: result.rounding,
      inputProvenance,
      determinationInput,
      determinationInputHash,
      lines: result.lines.map((line) => ({
        lineId: line.lineId,
        jurisdiction: line.jurisdiction,
        treatment: line.treatment,
        taxCode: line.taxCode,
        ratePpm: line.ratePpm,
        rateKind: line.rateKind,
        taxableMinor: BigInt(line.taxableMinor),
        taxMinor: BigInt(line.taxMinor),
        ruleBookId: line.ruleBookId,
        ruleBookVersion: line.ruleBookVersion,
        legalBasis: line.legalBasis,
        notation: line.notation,
      })),
    },
    result,
    currency: subject.currency,
    netMinor: BigInt(result.totals.netMinor),
    taxMinor: BigInt(result.totals.taxMinor),
    treatment,
  };
}

/**
 * Composes the books, runs the engine, and attributes every answer back to the
 * book that published it.
 *
 * Exported because the replay test runs exactly this, over a stored question,
 * and compares the result with the stored lines. If the replay had its own copy
 * of the composition it would be testing a second implementation.
 */
export function runDetermination(input: {
  determinationId: string;
  request: TaxDeterminationRequest;
  books: readonly PersistedTaxRuleBookRow[];
}): TaxDeterminationResult {
  let composed;
  try {
    composed = composeTaxRuleBook(input.books);
  } catch (error: unknown) {
    if (error instanceof PersistedTaxRuleBookError)
      throw new TaxDeterminationUnavailableError(error.code, error.message);
    throw error;
  }
  let result: TaxDeterminationResult;
  try {
    result = runTaxEngine({
      determinationId: input.determinationId,
      request: input.request,
      ruleBook: composed.ruleBook,
    });
  } catch (error: unknown) {
    if (error instanceof TaxDeterminationError)
      throw new TaxDeterminationUnavailableError(error.code, error.message);
    throw error;
  }
  const territories = new Set(
    composed.ruleBook.territories.map((territory) => territory.id),
  );
  // A VAT territory's single authority is NAMED AFTER THE TERRITORY — the
  // taxing jurisdiction in Spain is "ES" — so a row naming "ES" is an ordinary
  // per-authority answer and not the unattributable one below. Only an id that
  // is a territory and is NOT an authority means the books declared nobody who
  // taxes this address.
  const authorities = new Set(
    composed.ruleBook.jurisdictions.map((jurisdiction) => jurisdiction.id),
  );
  // A supplier unregistered in its OWN establishment is a real
  // `not_registered` answer that names the customer's territory (engine.ts
  // documents why), so it is excluded from the refusal below by the review
  // reason the engine raises for it. Refusing it would block a legitimate
  // determination.
  const establishmentGap = result.reviewReasons.includes(
    "supplier_not_registered_in_establishment",
  );
  const lines = result.lines.map((line) => {
    // A `not_registered` row naming the TERRITORY rather than a taxing
    // authority means the books declared no authority the address reaches —
    // not that we hold no registration there. Recording it as `not_registered`
    // would be a claim about us standing in for "nobody has stated who taxes
    // this address", and it would bill zero and look settled.
    if (
      territories.has(line.jurisdiction) &&
      !authorities.has(line.jurisdiction) &&
      line.treatment === "not_registered" &&
      !establishmentGap
    )
      throw new TaxDeterminationUnavailableError(
        "TAX_JURISDICTION_UNKNOWN",
        `No taxing authority in ${line.jurisdiction} covers the customer address; a determination is refused rather than answered with zero`,
      );
    const attribution = composed.attribution.get(line.jurisdiction);
    if (line.ruleBookId !== "composed") return line;
    if (!attribution)
      throw new TaxDeterminationUnavailableError(
        "TAX_RULE_BOOK_ATTRIBUTION_MISSING",
        `No persisted rule book declares ${line.jurisdiction}, so its answer cannot be pinned to one`,
      );
    return {
      ...line,
      ruleBookId: attribution.ruleBookId,
      ruleBookVersion: attribution.ruleBookVersion,
    };
  });
  return { ...result, lines };
}

/**
 * The entity that WILL sell an order that has not been accepted yet.
 *
 * Acceptance writes the binding inside its own transaction, so the pre-check
 * that runs before that transaction has no binding to read. It resolves the
 * same operator statement the binding is about to pin — same function, same
 * precedence, same date — so a quote that passes the pre-check is a quote whose
 * acceptance can bind, and the two cannot disagree about which entity sells.
 */
export async function prospectiveSupplierEntity(
  transaction: RuntimeTransaction,
  input: { accountId: string; taxPointDate: string },
): Promise<string> {
  const day = taxDay(input.taxPointDate);
  const rows = await transaction.execute<{
    legal_entity_id: string | null;
  }>(sql`
    select assignment.legal_entity_id
    from public.core_selling_entity_assignments assignment
    where assignment.id = public.core_resolve_selling_entity_assignment(
      ${input.accountId}::uuid,
      (select country from public.accounts where id = ${input.accountId}::uuid),
      ${day}::date
    )
  `);
  const entityId = [...rows][0]?.legal_entity_id;
  if (!entityId)
    throw new TaxDeterminationUnavailableError(
      "SELLING_ENTITY_UNSTATED",
      `No selling entity is stated for account ${input.accountId} on ${day}; state one before accepting an order we bill`,
    );
  return entityId;
}

/** Pins the supplier and merchant-of-record entities onto an accepted order. */
export async function bindOrderSellingEntity(
  transaction: RuntimeTransaction,
  input: { orderId: string; boundAt: Date },
): Promise<void> {
  await transaction.execute(sql`
    select public.core_bind_order_selling_entity(
      ${input.orderId}::uuid, ${input.boundAt.toISOString()}::timestamptz
    )
  `);
}

export interface OrderSupplierBinding {
  merchantOfRecord: "fil_one" | "partner" | "marketplace";
  supplierLegalEntityId?: string;
  merchantLegalEntityId?: string;
}

export async function loadOrderSupplierBinding(
  transaction: RuntimeTransaction,
  orderId: string,
): Promise<OrderSupplierBinding> {
  const [binding] = await transaction
    .select()
    .from(orderSupplierBindings)
    .where(eq(orderSupplierBindings.orderId, orderId));
  if (!binding)
    throw new TaxDeterminationUnavailableError(
      "ORDER_NOT_BOUND_TO_SELLING_ENTITY",
      `Order ${orderId} is not bound to a selling entity, so there is no supplier to determine tax for`,
    );
  return {
    merchantOfRecord:
      binding.merchantOfRecord as OrderSupplierBinding["merchantOfRecord"],
    ...(binding.supplierLegalEntityId
      ? { supplierLegalEntityId: binding.supplierLegalEntityId }
      : {}),
    ...(binding.merchantLegalEntityId
      ? { merchantLegalEntityId: binding.merchantLegalEntityId }
      : {}),
  };
}

/**
 * The lines an order's invoice is determined against: the immutable snapshot
 * taken at acceptance, WITH the per-line tax code it already froze.
 *
 * `core_order_line_snapshots.snapshot` has carried `stripeTaxCode` since
 * 000100, and `core-dispatch.ts` read the same snapshots and threw that field
 * away, so every line on every invoice was taxed at whatever the quote's rate
 * cards said today rather than at the code frozen with the line. Reading it
 * here is the whole of that fix.
 */
export async function orderTaxLines(
  transaction: RuntimeTransaction,
  orderId: string,
  currency: string,
): Promise<TaxRequestLineSource[]> {
  const snapshots = await transaction
    .select({
      id: orderLineSnapshots.id,
      orderLineId: orderLineSnapshots.orderLineId,
      snapshot: orderLineSnapshots.snapshot,
    })
    .from(orderLineSnapshots)
    .innerJoin(orderLines, eq(orderLines.id, orderLineSnapshots.orderLineId))
    .where(eq(orderLines.orderId, orderId));
  if (snapshots.length === 0)
    throw new TaxDeterminationUnavailableError(
      "ORDER_LINE_SNAPSHOTS_MISSING",
      `Order ${orderId} carries no immutable line snapshots to determine tax against`,
    );
  return snapshots
    .map((row) => {
      const snapshot =
        row.snapshot && typeof row.snapshot === "object"
          ? (row.snapshot as Record<string, unknown>)
          : {};
      const taxCode = snapshot.stripeTaxCode;
      const lineTotal = snapshot.lineTotal as
        { currency?: unknown; minor?: unknown } | undefined;
      if (
        typeof taxCode !== "string" ||
        !taxCode.trim() ||
        typeof lineTotal?.minor !== "string" ||
        lineTotal.currency !== currency
      )
        throw new TaxDeterminationUnavailableError(
          "ORDER_LINE_SNAPSHOT_UNUSABLE",
          `Order line snapshot ${row.id} carries no frozen tax code and line total in ${currency}`,
        );
      return {
        lineId: row.id,
        taxCode,
        netMinor: BigInt(lineTotal.minor),
      };
    })
    .sort((left, right) => left.lineId.localeCompare(right.lineId));
}

/**
 * The signed net delta of accepted amendments, as a line.
 *
 * It has no order line of its own — an amendment moves the amount owed without
 * being a quoted line — so it is named `amendment-delta`, which
 * `core_invoice_tax_lines.line_id` admits explicitly. Attributing it needs a tax
 * code and the only defensible one is the code the order already bills every
 * line under; a mixed-code order refuses rather than picking one.
 */
export function amendmentDeltaLine(
  lines: readonly TaxRequestLineSource[],
  deltaMinor: bigint,
): TaxRequestLineSource {
  const codes = new Set(lines.map((line) => line.taxCode));
  if (codes.size !== 1)
    throw new TaxDeterminationUnavailableError(
      "AMENDMENT_DELTA_TAX_CODE_AMBIGUOUS",
      "Amended order carries mixed tax codes; the amendment delta cannot be attributed to one",
    );
  return {
    lineId: "amendment-delta",
    taxCode: [...codes][0] as string,
    netMinor: deltaMinor,
  };
}

/** Persists the determination and its per-jurisdiction lines for an invoice. */
export async function persistInvoiceTaxDetermination(
  transaction: RuntimeTransaction,
  input: {
    invoiceId: string;
    orderId: string;
    currency: string;
    netMinor: bigint;
    taxMinor: bigint;
    treatment: TaxTreatment;
    detail: TaxDeterminationDetail;
  },
): Promise<void> {
  await transaction.execute(sql`
    insert into public.core_invoice_tax_determinations (
      invoice_id, order_id, determination_id, supplier_legal_entity_id,
      supplier_registration_id, customer_account_id, customer_registration_id,
      customer_status, place_of_supply, tax_point_date, currency, net_minor,
      tax_minor, treatment, confidence, review_reasons, rounding,
      input_provenance, determination_input, determination_input_hash
    ) values (
      ${input.invoiceId}::uuid,
      ${input.orderId}::uuid,
      ${input.detail.determinationId}::uuid,
      ${input.detail.supplierLegalEntityId}::uuid,
      ${input.detail.supplierRegistrationId ?? null}::uuid,
      ${input.detail.customerAccountId}::uuid,
      ${input.detail.customerRegistrationId ?? null}::uuid,
      ${input.detail.customerStatus},
      ${textArray(input.detail.placeOfSupply)},
      ${input.detail.taxPointDate}::date,
      ${input.currency},
      ${input.netMinor.toString()}::bigint,
      ${input.taxMinor.toString()}::bigint,
      ${input.treatment},
      ${input.detail.confidence},
      ${textArray(input.detail.reviewReasons)},
      ${input.detail.rounding},
      ${input.detail.inputProvenance},
      ${JSON.stringify(input.detail.determinationInput)}::jsonb,
      ${input.detail.determinationInputHash}
    )
  `);
  for (const line of input.detail.lines)
    await transaction.execute(sql`
      insert into public.core_invoice_tax_lines (
        invoice_id, line_id, jurisdiction, treatment, tax_code, rate_ppm,
        rate_kind, taxable_minor, tax_minor, rule_book_id, rule_book_version,
        legal_basis, notation
      ) values (
        ${input.invoiceId}::uuid, ${line.lineId}, ${line.jurisdiction},
        ${line.treatment}, ${line.taxCode}, ${line.ratePpm}::bigint,
        ${line.rateKind}, ${line.taxableMinor.toString()}::bigint,
        ${line.taxMinor.toString()}::bigint, ${line.ruleBookId}::uuid,
        ${line.ruleBookVersion}::integer, ${line.legalBasis}, ${line.notation}
      )
    `);
}

/**
 * A `text[]` built from a bound JSON parameter rather than from an interpolated
 * literal. A legal citation carries apostrophes and a review reason is
 * engine-authored text; neither is ever spliced into SQL here.
 */
function textArray(values: readonly string[]) {
  return sql`(
    select coalesce(array_agg(entry.value order by entry.ordinality), array[]::text[])
    from jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)
      with ordinality as entry(value, ordinality)
  )`;
}

export const taxDeterminationInternals = { canonicalJson, determinationIdFor };
