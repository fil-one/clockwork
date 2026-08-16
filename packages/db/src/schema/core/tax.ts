// ADR-0003 mirror of the tax schema. The reviewed Supabase SQL is canonical:
// supabase/migrations/001410_tax_supplier_side.sql (core_legal_entities,
// core_tax_registrations), 001411_tax_rule_books.sql (core_tax_rule_books,
// core_tax_rates) and 001412_tax_rule_book_activation.sql
// (core_tax_rule_book_activation_events). Every column, nullability, check,
// unique constraint and index below was read off those migrations and confirmed
// against the applied schema; nothing here is a design intention that the
// database does not hold.
//
// Triggers, RLS policies and grants are deliberately absent: Drizzle has no way
// to express them and the migrations are where they live. What this file owes
// the repository is the shape, which is what check:schema-drift compares.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  accounts,
  commerceUsers,
  documents,
  invoices,
  orders,
} from "../../schema";
import { accountTaxIdentifiers } from "./finance";

const id = (name = "id") =>
  uuid(name)
    .primaryKey()
    .default(sql`public.uuid_v7()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rowVersion = () => integer("row_version").notNull().default(1);

/**
 * The supplier side of a supply: our own selling entities, and a partner
 * account acting as merchant of record. `accountId` is nullable and the
 * biconditional with `merchantRole` is what gives that nullability a meaning a
 * constraint can hold.
 */
export const legalEntities = pgTable(
  "core_legal_entities",
  {
    id: id(),
    legalName: text("legal_name").notNull(),
    merchantRole: text("merchant_role").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    establishedCountry: text("established_country").notNull(),
    registeredAddress: jsonb("registered_address").notNull(),
    invoiceHeaderText: text("invoice_header_text").notNull().default(""),
    invoiceFooterText: text("invoice_footer_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_legal_entities_account_idx").on(table.accountId),
    // One partner account is one partner entity (001416). Without it the
    // merchant of record on an order would be whichever row sorted first.
    uniqueIndex("core_legal_entities_partner_account_unique")
      .on(table.accountId)
      .where(sql`${table.merchantRole} = 'partner_entity'`),
    check(
      "core_legal_entities_legal_name_check",
      sql`length(trim(${table.legalName})) > 0`,
    ),
    check(
      "core_legal_entities_merchant_role_check",
      sql`${table.merchantRole} in ('our_entity','partner_entity')`,
    ),
    // Country of establishment, not a hierarchical jurisdiction: establishment
    // is a country-level fact even where the tax is subdivided.
    check(
      "core_legal_entities_established_country_check",
      sql`${table.establishedCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "core_legal_entities_registered_address_check",
      sql`jsonb_typeof(${table.registeredAddress}) = 'object'`,
    ),
    check(
      "core_legal_entities_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    // An entity of ours has no counterparty account; a partner merchant of
    // record is exactly an entity that points at one.
    check(
      "core_legal_entities_partner_account_check",
      sql`(${table.merchantRole} = 'partner_entity') = (${table.accountId} is not null)`,
    ),
  ],
);

/**
 * The operator's statement of where a merchant is registered. Effective-dated
 * rows with a half-open window, and at most one `active` row per entity,
 * jurisdiction and scheme — the partial unique index below is that rule, and it
 * is a real constraint rather than a convention.
 */
export const taxRegistrations = pgTable(
  "core_tax_registrations",
  {
    id: id(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    jurisdiction: text("jurisdiction").notNull(),
    scheme: text("scheme").notNull(),
    registrationNumber: text("registration_number").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull().default("pending"),
    statedBy: uuid("stated_by")
      .notNull()
      .references(() => commerceUsers.id),
    statedAt: timestamp("stated_at", { withTimezone: true }).notNull(),
    evidenceDocumentId: uuid("evidence_document_id").references(
      () => documents.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_tax_registrations_active_unique")
      .on(table.legalEntityId, table.jurisdiction, table.scheme)
      .where(sql`${table.status} = 'active'`),
    index("core_tax_registrations_lookup_idx").on(
      table.jurisdiction,
      table.status,
      table.effectiveFrom,
    ),
    index("core_tax_registrations_entity_idx").on(
      table.legalEntityId,
      table.status,
    ),
    // Hierarchical place, not a country: GB, ES, US-CA, US-CA-06075.
    check(
      "core_tax_registrations_jurisdiction_check",
      sql`${table.jurisdiction} ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'`,
    ),
    // Shape-checked and deliberately not enumerated: what a scheme means to the
    // determination is rule-book data, so a new scheme needs no deploy.
    check(
      "core_tax_registrations_scheme_check",
      sql`${table.scheme} ~ '^[a-z][a-z0-9_]{1,31}$'`,
    ),
    check(
      "core_tax_registrations_registration_number_check",
      sql`length(trim(${table.registrationNumber})) > 0`,
    ),
    check(
      "core_tax_registrations_status_check",
      sql`${table.status} in ('pending','active','deregistered')`,
    ),
    check(
      "core_tax_registrations_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    // Strictly ordered, half-open: a same-day close would be a window that
    // covers nothing.
    check(
      "core_tax_registrations_window_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    // An active registration authorises charging tax in someone else's country;
    // recording that with no evidence is the claim without the basis. A pending
    // row may have none, because the certificate arrives after the application.
    check(
      "core_tax_registrations_active_evidence_check",
      sql`${table.status} <> 'active' or ${table.evidenceDocumentId} is not null`,
    ),
  ],
);

/**
 * One jurisdiction's rules at a version, on the price-book grain: draft is
 * editable, published is immutable, a new version supersedes. At most one
 * `active` book per jurisdiction, enforced by the partial unique index.
 */
export const taxRuleBooks = pgTable(
  "core_tax_rule_books",
  {
    id: id(),
    jurisdiction: text("jurisdiction").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    // The non-rate parameters the stable algorithm consults: reverse-charge
    // conditions, thresholds, rounding, tax point, scheme semantics, stacking.
    // Frozen once the book leaves draft by protect_published_tax_rule_book
    // (001411), which lists rule_parameters among the columns that may not move.
    ruleParameters: jsonb("rule_parameters").notNull().default({}),
    authorityReference: text("authority_reference").notNull(),
    determinationSource: text("determination_source")
      .notNull()
      .default("local"),
    inputProvenance: text("input_provenance").notNull().default("unverified"),
    subdivisionScope: text("subdivision_scope")
      .notNull()
      .default("this_level_only"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("core_tax_rule_books_jurisdiction_version_unique").on(
      table.jurisdiction,
      table.version,
    ),
    uniqueIndex("core_tax_rule_books_active_jurisdiction_unique")
      .on(table.jurisdiction)
      .where(sql`${table.status} = 'active'`),
    index("core_tax_rule_books_resolution_idx").on(
      table.jurisdiction,
      table.effectiveFrom.desc(),
      table.effectiveTo,
    ),
    check(
      "core_tax_rule_books_jurisdiction_check",
      sql`${table.jurisdiction} ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'`,
    ),
    check("core_tax_rule_books_version_check", sql`${table.version} > 0`),
    check(
      "core_tax_rule_books_status_check",
      sql`${table.status} in ('draft','active','retired')`,
    ),
    check(
      "core_tax_rule_books_rule_parameters_check",
      sql`jsonb_typeof(${table.ruleParameters}) = 'object'`,
    ),
    check(
      "core_tax_rule_books_authority_reference_check",
      sql`length(trim(${table.authorityReference})) > 0`,
    ),
    check(
      "core_tax_rule_books_determination_source_check",
      sql`${table.determinationSource} in ('local','provider')`,
    ),
    // Same vocabulary as system_external_gates.input_provenance (001000:8).
    check(
      "core_tax_rule_books_input_provenance_check",
      sql`${table.inputProvenance} in ('unverified','repository_fixture','live_signed')`,
    ),
    check(
      "core_tax_rule_books_subdivision_scope_check",
      sql`${table.subdivisionScope} in ('whole_jurisdiction','this_level_only')`,
    ),
    check(
      "core_tax_rule_books_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    // Half-open window: effective_to is the date the successor takes over, so a
    // supply ON that date belongs to the successor and never to both.
    check(
      "core_tax_rule_books_window_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check(
      "core_tax_rule_books_retired_window_check",
      sql`${table.status} <> 'retired' or ${table.effectiveTo} is not null`,
    ),
  ],
);

/**
 * The rates of one rule book, one row per tax code.
 *
 * `ratePpm` is PARTS PER MILLION and is modelled as a bigint in bigint mode
 * because that is what the column is. It is NOT basis points: a US combined
 * rate stacks state, county, city and district, and New York City's 8.875% is
 * 887.5 bps, which is not an integer — rounding it to 887 or 888 is a wrong
 * number that looks fine. 20% is 200000, 8.875% is 88750, and the representable
 * step is 0.0001%. Narrowing this column to a JS number, or to bps, would
 * silently reintroduce exactly the defect 001411 documents.
 */
export const taxRates = pgTable(
  "core_tax_rates",
  {
    id: id(),
    taxRuleBookId: uuid("tax_rule_book_id")
      .notNull()
      .references(() => taxRuleBooks.id),
    taxCode: text("tax_code").notNull(),
    rateKind: text("rate_kind").notNull(),
    ratePpm: bigint("rate_ppm", { mode: "bigint" }).notNull(),
    legalBasis: text("legal_basis").notNull(),
    notation: text("notation").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    unique("core_tax_rates_book_code_unique").on(
      table.taxRuleBookId,
      table.taxCode,
    ),
    index("core_tax_rates_book_idx").on(table.taxRuleBookId),
    check(
      "core_tax_rates_tax_code_check",
      sql`length(trim(${table.taxCode})) > 0`,
    ),
    check(
      "core_tax_rates_rate_kind_check",
      sql`${table.rateKind} ~ '^[a-z][a-z0-9_]{1,31}$'`,
    ),
    check("core_tax_rates_rate_ppm_check", sql`${table.ratePpm} >= 0`),
    check(
      "core_tax_rates_legal_basis_check",
      sql`length(trim(${table.legalBasis})) > 0`,
    ),
  ],
);

/**
 * The operator's statement of which of our entities contracts a supply, by
 * counterparty, by counterparty country, or as the default. Resolved most
 * specific first by `core_resolve_selling_entity_assignment` (001416) and
 * pinned onto the order at acceptance.
 */
export const sellingEntityAssignments = pgTable(
  "core_selling_entity_assignments",
  {
    id: id(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    accountId: uuid("account_id").references(() => accounts.id),
    customerCountry: text("customer_country"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    statedBy: uuid("stated_by")
      .notNull()
      .references(() => commerceUsers.id),
    statedAt: timestamp("stated_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_selling_entity_assignments_open_account_unique")
      .on(table.accountId)
      .where(
        sql`${table.effectiveTo} is null and ${table.accountId} is not null`,
      ),
    uniqueIndex("core_selling_entity_assignments_open_country_unique")
      .on(table.customerCountry)
      .where(
        sql`${table.effectiveTo} is null and ${table.customerCountry} is not null`,
      ),
    // NULLS NOT DISTINCT in the migration, which Drizzle cannot express on an
    // index: every row this predicate admits has a null `effective_to`, and
    // treating those nulls as equal is what limits the open default to one.
    uniqueIndex("core_selling_entity_assignments_open_default_unique")
      .on(table.effectiveTo)
      .where(
        sql`${table.effectiveTo} is null and ${table.accountId} is null and ${table.customerCountry} is null`,
      ),
    index("core_selling_entity_assignments_lookup_idx").on(
      table.accountId,
      table.customerCountry,
      table.effectiveFrom,
    ),
    check(
      "core_selling_entity_assignments_customer_country_check",
      sql`${table.customerCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "core_selling_entity_assignments_reason_check",
      sql`length(trim(${table.reason})) > 0`,
    ),
    check(
      "core_selling_entity_assignments_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    check(
      "core_selling_entity_assignments_window_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    // An account-scoped statement names the counterparty and nothing else: a
    // row carrying both would be two statements with no rule to choose between.
    check(
      "core_selling_entity_assignments_scope_check",
      sql`${table.accountId} is null or ${table.customerCountry} is null`,
    ),
  ],
);

/**
 * Which entity sells an order and which is merchant of record on it, pinned at
 * acceptance and immutable thereafter (001416).
 *
 * Both entity columns are nullable and null together: a marketplace order is
 * one we are not a party to, and the row records that decision rather than
 * leaving its absence to be interpreted.
 */
export const orderSupplierBindings = pgTable(
  "core_order_supplier_bindings",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id),
    merchantOfRecord: text("merchant_of_record").notNull(),
    supplierLegalEntityId: uuid("supplier_legal_entity_id").references(
      () => legalEntities.id,
    ),
    merchantLegalEntityId: uuid("merchant_legal_entity_id").references(
      () => legalEntities.id,
    ),
    sellingEntityAssignmentId: uuid("selling_entity_assignment_id").references(
      () => sellingEntityAssignments.id,
    ),
    supplierEstablishedCountry: text("supplier_established_country"),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_order_supplier_bindings_supplier_idx").on(
      table.supplierLegalEntityId,
    ),
    index("core_order_supplier_bindings_merchant_idx").on(
      table.merchantLegalEntityId,
    ),
    check(
      "core_order_supplier_bindings_merchant_of_record_check",
      sql`${table.merchantOfRecord} in ('fil_one','partner','marketplace')`,
    ),
    check(
      "core_order_supplier_bindings_supplier_established_country_check",
      sql`${table.supplierEstablishedCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "core_order_supplier_bindings_marketplace_check",
      sql`(${table.merchantOfRecord} = 'marketplace') = (${table.supplierLegalEntityId} is null)
        and (${table.supplierLegalEntityId} is null) = (${table.merchantLegalEntityId} is null)
        and (${table.supplierLegalEntityId} is null) = (${table.sellingEntityAssignmentId} is null)
        and (${table.supplierLegalEntityId} is null) = (${table.supplierEstablishedCountry} is null)`,
    ),
    check(
      "core_order_supplier_bindings_self_merchant_check",
      sql`${table.merchantOfRecord} <> 'fil_one'
        or ${table.merchantLegalEntityId} = ${table.supplierLegalEntityId}`,
    ),
  ],
);

/**
 * What was determined for one invoice and what it was determined from (001417).
 *
 * `determinationInput` is the QUESTION — both parties, their registrations, the
 * lines with their frozen tax codes, the tax point and the books consulted —
 * with the canonical hash the database recomputes before it accepts the row. An
 * answer with no question cannot be replayed, and a determination that cannot be
 * replayed cannot be defended.
 */
export const invoiceTaxDeterminations = pgTable(
  "core_invoice_tax_determinations",
  {
    invoiceId: uuid("invoice_id")
      .primaryKey()
      .references(() => invoices.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    determinationId: uuid("determination_id").notNull(),
    supplierLegalEntityId: uuid("supplier_legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    // Null is the `not_registered` determination and is not an omission.
    supplierRegistrationId: uuid("supplier_registration_id").references(
      () => taxRegistrations.id,
    ),
    customerAccountId: uuid("customer_account_id")
      .notNull()
      .references(() => accounts.id),
    customerRegistrationId: uuid("customer_registration_id").references(
      () => accountTaxIdentifiers.id,
    ),
    customerStatus: text("customer_status").notNull(),
    // Plural: a document whose lines are supplied in different places has more
    // than one place of supply, and a scalar would be wrong for it.
    placeOfSupply: text("place_of_supply").array().notNull(),
    taxPointDate: date("tax_point_date").notNull(),
    currency: text("currency").notNull(),
    netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    treatment: text("treatment").notNull(),
    confidence: text("confidence").notNull(),
    reviewReasons: text("review_reasons").array().notNull().default([]),
    rounding: text("rounding").notNull(),
    inputProvenance: text("input_provenance").notNull(),
    determinationInput: jsonb("determination_input").notNull(),
    determinationInputHash: text("determination_input_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("core_invoice_tax_determinations_determination_id_key").on(
      table.determinationId,
    ),
    index("core_invoice_tax_determination_order_idx").on(table.orderId),
    index("core_invoice_tax_determination_entity_idx").on(
      table.supplierLegalEntityId,
      table.taxPointDate,
    ),
    uniqueIndex("core_invoice_tax_determination_input_unique").on(
      table.determinationInputHash,
    ),
    check(
      "core_invoice_tax_determinations_customer_status_check",
      sql`${table.customerStatus} in ('business','consumer')`,
    ),
    check(
      "core_invoice_tax_determinations_place_of_supply_check",
      sql`array_length(${table.placeOfSupply}, 1) >= 1`,
    ),
    check(
      "core_invoice_tax_determinations_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
    check(
      "core_invoice_tax_determinations_net_minor_check",
      sql`${table.netMinor} >= 0`,
    ),
    check(
      "core_invoice_tax_determinations_treatment_check",
      sql`${table.treatment} in ('standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered')`,
    ),
    check(
      "core_invoice_tax_determinations_confidence_check",
      sql`${table.confidence} in ('determined','review_required')`,
    ),
    check(
      "core_invoice_tax_determinations_rounding_check",
      sql`${table.rounding} in ('line','invoice')`,
    ),
    check(
      "core_invoice_tax_determinations_input_provenance_check",
      sql`${table.inputProvenance} in ('unverified','repository_fixture','live_signed')`,
    ),
    check(
      "core_invoice_tax_determinations_determination_input_check",
      sql`jsonb_typeof(${table.determinationInput}) = 'object'`,
    ),
    check(
      "core_invoice_tax_determinations_determination_input_hash_check",
      sql`${table.determinationInputHash} ~ '^[a-f0-9]{64}$'`,
    ),
    // The same rule the invoice header carries: one treatment admits an amount.
    check(
      "core_invoice_tax_determinations_amount_check",
      sql`${table.treatment} = 'standard' or ${table.taxMinor} = 0`,
    ),
    check(
      "core_invoice_tax_determinations_review_check",
      sql`(${table.confidence} = 'review_required') = (array_length(${table.reviewReasons}, 1) >= 1)`,
    ),
  ],
);

/**
 * One taxing authority's answer for one line (001417). A stacked sales tax
 * produces several rows for one line; a mixed-treatment document is legible
 * here where the invoice header can only summarise it.
 *
 * `lineId` is TEXT and not a foreign key: it is a `core_order_line_snapshots`
 * id for everything that was quoted, and the literal `amendment-delta` for the
 * signed net delta of accepted amendments, which has no line of its own.
 */
export const invoiceTaxLines = pgTable(
  "core_invoice_tax_lines",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    lineId: text("line_id").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    treatment: text("treatment").notNull(),
    taxCode: text("tax_code").notNull(),
    ratePpm: bigint("rate_ppm", { mode: "bigint" }).notNull(),
    rateKind: text("rate_kind").notNull(),
    taxableMinor: bigint("taxable_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    ruleBookId: uuid("rule_book_id")
      .notNull()
      .references(() => taxRuleBooks.id),
    ruleBookVersion: integer("rule_book_version").notNull(),
    legalBasis: text("legal_basis").notNull(),
    notation: text("notation").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.invoiceId, table.lineId, table.jurisdiction],
    }),
    index("core_invoice_tax_lines_jurisdiction_idx").on(
      table.jurisdiction,
      table.treatment,
    ),
    index("core_invoice_tax_lines_book_idx").on(table.ruleBookId),
    check(
      "core_invoice_tax_lines_line_id_check",
      sql`${table.lineId} = 'amendment-delta' or ${table.lineId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "core_invoice_tax_lines_jurisdiction_check",
      sql`${table.jurisdiction} ~ '^[A-Z]{2}(-[A-Z0-9]{1,10}){0,4}$'`,
    ),
    check(
      "core_invoice_tax_lines_treatment_check",
      sql`${table.treatment} in ('standard','reverse_charge','zero_rated','exempt','out_of_scope','not_registered')`,
    ),
    check(
      "core_invoice_tax_lines_tax_code_check",
      sql`length(trim(${table.taxCode})) > 0`,
    ),
    check("core_invoice_tax_lines_rate_ppm_check", sql`${table.ratePpm} >= 0`),
    check(
      "core_invoice_tax_lines_rate_kind_check",
      sql`length(trim(${table.rateKind})) > 0`,
    ),
    check(
      "core_invoice_tax_lines_rule_book_version_check",
      sql`${table.ruleBookVersion} > 0`,
    ),
    check(
      "core_invoice_tax_lines_legal_basis_check",
      sql`length(trim(${table.legalBasis})) > 0`,
    ),
    // Only a standard supply carries an amount or a rate, on this grain too.
    check(
      "core_invoice_tax_lines_amount_check",
      sql`${table.treatment} = 'standard' or (${table.taxMinor} = 0 and ${table.ratePpm} = 0)`,
    ),
  ],
);

/**
 * Append-only record of every rule book activation, retirement, schedule and
 * signature change. Two more actions than the price book's, because provenance
 * is a decision this object has and that one does not.
 */
export const taxRuleBookActivationEvents = pgTable(
  "core_tax_rule_book_activation_events",
  {
    id: id(),
    taxRuleBookId: uuid("tax_rule_book_id")
      .notNull()
      .references(() => taxRuleBooks.id),
    action: text("action").notNull(),
    previousStatus: text("previous_status"),
    resultingStatus: text("resulting_status").notNull(),
    previousProvenance: text("previous_provenance"),
    resultingProvenance: text("resulting_provenance"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_tax_activation_timeline_idx").on(
      table.taxRuleBookId,
      table.effectiveAt,
    ),
    check(
      "core_tax_rule_book_activation_events_action_check",
      sql`${table.action} in ('activate','retire','schedule','cancel_schedule','sign','withdraw_signature')`,
    ),
    check(
      "core_tax_rule_book_activation_events_reason_check",
      sql`length(trim(${table.reason})) > 0`,
    ),
    check(
      "core_tax_rule_book_activation_events_request_id_check",
      sql`length(trim(${table.requestId})) > 0`,
    ),
    // A signature decision that does not say what the provenance became is not
    // a record of the decision.
    check(
      "core_tax_activation_signature_check",
      sql`${table.action} not in ('sign','withdraw_signature') or (${table.previousProvenance} is not null and ${table.resultingProvenance} is not null)`,
    ),
  ],
);
