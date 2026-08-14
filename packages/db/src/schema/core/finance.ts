import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  accounts,
  agreements,
  amendments,
  commerceUsers,
  commissionAccruals,
  commitmentEntries,
  commitmentLedgers,
  dealRegistrations,
  documents,
  entitlements,
  invoices,
  orderLines,
  orders,
  priceBooks,
  quotes,
  rateCards,
} from "../../schema";

const id = (name = "id") =>
  uuid(name)
    .primaryKey()
    .default(sql`public.uuid_v7()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rowVersion = () => integer("row_version").notNull().default(1);
const minor = (name: string) => bigint(name, { mode: "bigint" }).notNull();
const quantity = (name: string) =>
  numeric(name, { precision: 38, scale: 18 }).notNull();

export const accountCommercialProfiles = pgTable(
  "core_account_commercial_profiles",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id),
    legalEntityFingerprint: text("legal_entity_fingerprint").notNull(),
    billingModel: text("billing_model").notNull().default("auto_charge"),
    paymentTermsDays: integer("payment_terms_days"),
    creditStatus: text("credit_status").notNull().default("not_requested"),
    approvedCreditLimitMinor: minor("approved_credit_limit_minor").default(
      sql`0`,
    ),
    currentExposureMinor: minor("current_exposure_minor").default(sql`0`),
    newServiceBlocked: boolean("new_service_blocked").notNull().default(false),
    blockReason: text("block_reason"),
    collectionsOwnerId: uuid("collections_owner_id").references(
      () => commerceUsers.id,
    ),
    contractualTimeZone: text("contractual_time_zone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en-US"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_account_entity_fingerprint_unique").on(
      table.legalEntityFingerprint,
    ),
    index("core_account_credit_queue_idx").on(
      table.creditStatus,
      table.newServiceBlocked,
    ),
    check(
      "core_account_fingerprint_check",
      sql`${table.legalEntityFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "core_account_billing_model_check",
      sql`${table.billingModel} in ('prepay','auto_charge','net_terms')`,
    ),
    check(
      "core_account_terms_check",
      sql`(${table.billingModel} = 'net_terms' and ${table.paymentTermsDays} between 1 and 365) or (${table.billingModel} <> 'net_terms' and ${table.paymentTermsDays} is null)`,
    ),
    check(
      "core_account_credit_amounts_check",
      sql`${table.approvedCreditLimitMinor} >= 0 and ${table.currentExposureMinor} >= 0`,
    ),
  ],
);

export const accountRelationshipRoles = pgTable(
  "core_account_relationship_roles",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    role: text("role").notNull(),
    source: text("source").notNull().default("self_declared"),
    effectiveFrom: date("effective_from").notNull().defaultNow(),
    effectiveTo: date("effective_to"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.role] }),
    check(
      "core_account_relationship_role_check",
      sql`${table.role} in ('direct_client','partner','end_client')`,
    ),
    check(
      "core_account_relationship_dates_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const accountContacts = pgTable(
  "core_account_contacts",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email").notNull(),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    receivesInvoices: boolean("receives_invoices").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_account_contacts_account_idx").on(
      table.accountId,
      table.kind,
      table.active,
    ),
    uniqueIndex("core_account_contacts_primary_unique")
      .on(table.accountId, table.kind)
      .where(sql`${table.isPrimary} and ${table.active}`),
    check(
      "core_account_contacts_kind_check",
      sql`${table.kind} in ('billing','accounts_payable','remit_to','tax','procurement','commercial','technical')`,
    ),
  ],
);

export const accountTaxIdentifiers = pgTable(
  "core_account_tax_identifiers",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    jurisdiction: text("jurisdiction").notNull(),
    type: text("type").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    validationStatus: text("validation_status").notNull().default("pending"),
    verificationReference: text("verification_reference"),
    reverseChargeEligible: boolean("reverse_charge_eligible")
      .notNull()
      .default(false),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_tax_identifier_entity_unique").on(
      table.jurisdiction,
      table.type,
      table.normalizedValue,
    ),
    index("core_tax_identifier_account_idx").on(table.accountId),
    check(
      "core_tax_identifier_status_check",
      sql`${table.validationStatus} in ('pending','valid','invalid','expired')`,
    ),
  ],
);

export const procurementCertificates = pgTable(
  "core_procurement_certificates",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    kind: text("kind").notNull(),
    jurisdiction: text("jurisdiction"),
    certificateNumber: text("certificate_number"),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    validFrom: date("valid_from"),
    expiresOn: date("expires_on"),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_procurement_cert_expiry_idx").on(
      table.accountId,
      table.status,
      table.expiresOn,
    ),
    uniqueIndex("core_procurement_cert_identity_unique").on(
      table.accountId,
      table.kind,
      table.jurisdiction,
      table.documentId,
    ),
    check(
      "core_procurement_cert_dates_check",
      sql`${table.expiresOn} is null or ${table.validFrom} is null or ${table.expiresOn} >= ${table.validFrom}`,
    ),
    // Declared in 000100_core_finance.sql since the foundation migration; the
    // Drizzle model omitted it, which is the drift this records.
    check(
      "core_procurement_certificates_status_check",
      sql`${table.status} in ('pending','valid','expired','revoked')`,
    ),
  ],
);

export const priceBookActivationEvents = pgTable(
  "core_price_book_activation_events",
  {
    id: id(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id),
    action: text("action").notNull(),
    previousStatus: text("previous_status"),
    resultingStatus: text("resulting_status").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    reason: text("reason").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_price_activation_timeline_idx").on(
      table.priceBookId,
      table.effectiveAt,
    ),
    check(
      "core_price_activation_action_check",
      sql`${table.action} in ('activate','retire','schedule','cancel_schedule')`,
    ),
  ],
);

export const partnerTransferTiers = pgTable(
  "core_partner_transfer_tiers",
  {
    id: id(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id),
    agreementType: text("agreement_type").notNull(),
    tier: text("tier").notNull(),
    transferPriceMinor: minor("transfer_price_minor"),
    floorPriceMinor: minor("floor_price_minor"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_transfer_tier_unique").on(
      table.rateCardId,
      table.agreementType,
      table.tier,
      table.effectiveFrom,
    ),
    check(
      "core_transfer_tier_prices_check",
      sql`${table.transferPriceMinor} >= ${table.floorPriceMinor} and ${table.floorPriceMinor} >= 0`,
    ),
    check(
      "core_transfer_tier_dates_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const quoteCommercialProfiles = pgTable(
  "core_quote_commercial_profiles",
  {
    quoteId: uuid("quote_id")
      .primaryKey()
      .references(() => quotes.id),
    channelShape: text("channel_shape").notNull(),
    merchantOfRecord: text("merchant_of_record").notNull(),
    pricingAuthority: text("pricing_authority").notNull(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => accounts.id),
    distributorAccountId: uuid("distributor_account_id").references(
      () => accounts.id,
    ),
    marketplaceProvider: text("marketplace_provider"),
    transferTotalMinor: bigint("transfer_total_minor", { mode: "bigint" }),
    partnerResaleTotalMinor: bigint("partner_resale_total_minor", {
      mode: "bigint",
    }),
    whiteLabelMetadata: jsonb("white_label_metadata").notNull().default({}),
    pricingInputs: jsonb("pricing_inputs").notNull(),
    pricingCalculatedAt: timestamp("pricing_calculated_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_quote_channel_idx").on(
      table.channelShape,
      table.merchantOfRecord,
    ),
    check(
      "core_quote_channel_shape_check",
      sql`${table.channelShape} in ('direct','referral','resale','distributor','marketplace')`,
    ),
    check(
      "core_quote_mor_check",
      sql`${table.merchantOfRecord} in ('fil_one','partner','marketplace')`,
    ),
    check(
      "core_quote_pricing_authority_check",
      sql`${table.pricingAuthority} in ('fil_one','partner','marketplace')`,
    ),
  ],
);

export const quoteSnapshots = pgTable(
  "core_quote_snapshots",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => commerceUsers.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_quote_snapshot_quote_unique").on(table.quoteId),
    uniqueIndex("core_quote_snapshot_hash_unique").on(table.snapshotHash),
    check(
      "core_quote_snapshot_hash_check",
      sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const pricingExceptionDecisions = pgTable(
  "core_pricing_exception_decisions",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    floorTotalMinor: minor("floor_total_minor"),
    quotedTotalMinor: minor("quoted_total_minor"),
    modeledMarginBps: integer("modeled_margin_bps").notNull(),
    impactMinor: minor("impact_minor"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    assignedTo: uuid("assigned_to")
      .notNull()
      .references(() => commerceUsers.id),
    decidedBy: uuid("decided_by").references(() => commerceUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_pricing_exception_open_unique")
      .on(table.quoteId)
      .where(sql`${table.status} = 'pending'`),
    index("core_pricing_exception_queue_idx").on(table.status, table.createdAt),
    check(
      "core_pricing_exception_status_check",
      sql`${table.status} in ('pending','approved','rejected','withdrawn')`,
    ),
  ],
);

export const orderCommercialProfiles = pgTable(
  "core_order_commercial_profiles",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id),
    merchantOfRecord: text("merchant_of_record").notNull(),
    billingShape: text("billing_shape").notNull(),
    provisioningIdempotencyKey: text("provisioning_idempotency_key")
      .notNull()
      .unique(),
    governingAgreementVersion: integer("governing_agreement_version").notNull(),
    buyerAgreementId: uuid("buyer_agreement_id")
      .notNull()
      .references(() => agreements.id),
    buyerAgreementVersion: integer("buyer_agreement_version").notNull(),
    partnerAgreementId: uuid("partner_agreement_id").references(
      () => agreements.id,
    ),
    partnerAgreementVersion: integer("partner_agreement_version"),
    dealRegistrationId: uuid("deal_registration_id").references(
      () => dealRegistrations.id,
    ),
    distributorAccountId: uuid("distributor_account_id").references(
      () => accounts.id,
    ),
    coTermParentOrderId: uuid("co_term_parent_order_id").references(
      (): AnyPgColumn => orders.id,
    ),
    invoiceGroupingKey: text("invoice_grouping_key"),
    contractualTimeZone: text("contractual_time_zone").notNull().default("UTC"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_order_mor_idx").on(table.merchantOfRecord, table.billingShape),
    index("core_order_registration_idx").on(table.dealRegistrationId),
    check(
      "core_order_mor_check",
      sql`${table.merchantOfRecord} in ('fil_one','partner','marketplace')`,
    ),
    check(
      "core_order_billing_shape_check",
      sql`${table.billingShape} in ('direct','referral','resale','distributor','marketplace')`,
    ),
    check(
      "core_order_agreement_version_check",
      sql`${table.governingAgreementVersion} > 0 and ${table.buyerAgreementVersion} > 0 and (${table.partnerAgreementId} is null) = (${table.partnerAgreementVersion} is null) and (${table.partnerAgreementVersion} is null or ${table.partnerAgreementVersion} > 0)`,
    ),
    check(
      "core_order_partner_agreement_route_check",
      sql`(${table.billingShape} in ('referral','resale','distributor')) = (${table.partnerAgreementId} is not null)`,
    ),
  ],
);

export const orderLineSnapshots = pgTable(
  "core_order_line_snapshots",
  {
    id: id(),
    orderLineId: uuid("order_line_id")
      .notNull()
      .unique()
      .references(() => orderLines.id),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_order_line_snapshot_hash_unique").on(table.snapshotHash),
    check(
      "core_order_line_snapshot_hash_check",
      sql`${table.snapshotHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const amendmentFinancialTerms = pgTable(
  "core_amendment_financial_terms",
  {
    amendmentId: uuid("amendment_id")
      .primaryKey()
      .references(() => amendments.id),
    contractualTimeZone: text("contractual_time_zone").notNull(),
    prorationConvention: text("proration_convention").notNull(),
    periodStartsOn: date("period_starts_on").notNull(),
    periodEndsOn: date("period_ends_on").notNull(),
    billableNumerator: integer("billable_numerator").notNull(),
    billableDenominator: integer("billable_denominator").notNull(),
    currency: text("currency").notNull(),
    forecastDeltaMinor: bigint("forecast_delta_minor", {
      mode: "bigint",
    }).notNull(),
    monthlyDeltaMinor: bigint("monthly_delta_minor", {
      mode: "bigint",
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "core_amendment_proration_check",
      sql`${table.prorationConvention} in ('actual_actual','actual_365','thirty_360','none') and ${table.billableNumerator} >= 0 and ${table.billableDenominator} > 0 and ${table.billableNumerator} <= ${table.billableDenominator}`,
    ),
    check(
      "core_amendment_period_check",
      sql`${table.periodEndsOn} >= ${table.periodStartsOn}`,
    ),
    check(
      "core_amendment_financial_terms_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const amendmentLineSupersessions = pgTable(
  "core_amendment_line_supersessions",
  {
    id: id(),
    amendmentId: uuid("amendment_id")
      .notNull()
      .references(() => amendments.id),
    supersededOrderLineId: uuid("superseded_order_line_id")
      .notNull()
      .references(() => orderLines.id),
    replacementSnapshot: jsonb("replacement_snapshot").notNull(),
    effectiveOn: date("effective_on").notNull(),
    netQuantityDelta: quantity("net_quantity_delta"),
    netRevenueDeltaMinor: bigint("net_revenue_delta_minor", {
      mode: "bigint",
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_amendment_line_supersession_unique").on(
      table.amendmentId,
      table.supersededOrderLineId,
    ),
  ],
);

export const commitmentPeriods = pgTable(
  "core_commitment_periods",
  {
    id: id(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => commitmentLedgers.id),
    sequence: integer("sequence").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    contractualTimeZone: text("contractual_time_zone").notNull(),
    allowanceQuantity: quantity("allowance_quantity"),
    consumedQuantity: quantity("consumed_quantity").default("0"),
    overageQuantity: quantity("overage_quantity").default("0"),
    contractedOverageRateMinor: minor("contracted_overage_rate_minor"),
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_commitment_period_sequence_unique").on(
      table.ledgerId,
      table.sequence,
    ),
    uniqueIndex("core_commitment_period_boundary_unique").on(
      table.ledgerId,
      table.startsAt,
      table.endsAt,
    ),
    index("core_commitment_period_open_idx").on(table.status, table.endsAt),
    check(
      "core_commitment_period_bounds_check",
      sql`${table.endsAt} > ${table.startsAt} and ${table.sequence} > 0`,
    ),
    check(
      "core_commitment_period_quantities_check",
      sql`${table.allowanceQuantity} >= 0 and ${table.consumedQuantity} >= 0 and ${table.overageQuantity} >= 0 and ${table.contractedOverageRateMinor} >= 0`,
    ),
  ],
);

export const commitmentLedgerCorrections = pgTable(
  "core_commitment_ledger_corrections",
  {
    id: id(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => commitmentLedgers.id),
    periodId: uuid("period_id").references(() => commitmentPeriods.id),
    reversesEntryId: uuid("reverses_entry_id").references(
      () => commitmentEntries.id,
    ),
    quantityDelta: quantity("quantity_delta"),
    overageDelta: quantity("overage_delta"),
    reasonCode: text("reason_code").notNull(),
    sourceReference: text("source_reference").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => commerceUsers.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_ledger_correction_source_unique").on(
      table.ledgerId,
      table.sourceReference,
    ),
    index("core_ledger_correction_period_idx").on(table.periodId),
  ],
);

export const commitmentAllowanceAdjustments = pgTable(
  "core_commitment_allowance_adjustments",
  {
    id: id(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => commitmentLedgers.id),
    periodId: uuid("period_id").references(() => commitmentPeriods.id),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    quantityDelta: quantity("quantity_delta"),
    reason: text("reason").notNull(),
    sourceReference: text("source_reference").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => commerceUsers.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_commitment_allowance_adjustment_source_unique").on(
      table.ledgerId,
      table.sourceReference,
    ),
    index("core_commitment_allowance_adjustment_replay_idx").on(
      table.ledgerId,
      table.effectiveAt,
      table.id,
    ),
    check(
      "core_commitment_allowance_adjustment_reason_check",
      sql`${table.reason} in ('amendment','renewal','correction')`,
    ),
  ],
);

export const usageReconciliations = pgTable(
  "core_usage_reconciliations",
  {
    id: id(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id),
    periodStartsAt: timestamp("period_starts_at", {
      withTimezone: true,
    }).notNull(),
    periodEndsAt: timestamp("period_ends_at", {
      withTimezone: true,
    }).notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceQuantity: quantity("source_quantity"),
    ledgerQuantity: quantity("ledger_quantity"),
    varianceQuantity: quantity("variance_quantity"),
    status: text("status").notNull(),
    resolution: text("resolution"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_usage_reconciliation_unique").on(
      table.entitlementId,
      table.periodStartsAt,
      table.periodEndsAt,
      table.sourceSystem,
    ),
    index("core_usage_reconciliation_queue_idx").on(table.status),
    check(
      "core_usage_reconciliation_period_check",
      sql`${table.periodEndsAt} > ${table.periodStartsAt}`,
    ),
  ],
);

export const billingPolicies = pgTable(
  "core_billing_policies",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id),
    collectionMethod: text("collection_method").notNull(),
    paymentRail: text("payment_rail").notNull(),
    termsDays: integer("terms_days"),
    consolidatePartnerInvoices: boolean("consolidate_partner_invoices")
      .notNull()
      .default(false),
    dunningPolicyVersion: text("dunning_policy_version").notNull(),
    requirePo: boolean("require_po").notNull().default(false),
    requireVendorSetup: boolean("require_vendor_setup")
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    check(
      "core_billing_policy_collection_check",
      sql`${table.collectionMethod} in ('prepay','auto_charge','net_terms')`,
    ),
    check(
      "core_billing_policy_rail_check",
      sql`${table.paymentRail} in ('card','ach_debit','wire','sepa_credit','bacs','marketplace')`,
    ),
    check(
      "core_billing_policy_terms_check",
      sql`(${table.collectionMethod} = 'net_terms' and ${table.termsDays} between 1 and 365) or (${table.collectionMethod} <> 'net_terms' and ${table.termsDays} is null)`,
    ),
  ],
);

export const invoiceEndClientAllocations = pgTable(
  "core_invoice_end_client_allocations",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    endClientAccountId: uuid("end_client_account_id")
      .notNull()
      .references(() => accounts.id),
    currency: text("currency").notNull(),
    subtotalMinor: minor("subtotal_minor"),
    taxMinor: minor("tax_minor"),
    totalMinor: minor("total_minor"),
    stripeInvoiceLineIds: text("stripe_invoice_line_ids").array().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_invoice_end_client_allocation_unique").on(
      table.invoiceId,
      table.orderId,
      table.endClientAccountId,
    ),
    index("core_invoice_end_client_idx").on(table.endClientAccountId),
    check(
      "core_invoice_allocation_amounts_check",
      sql`${table.subtotalMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.totalMinor} = ${table.subtotalMinor} + ${table.taxMinor}`,
    ),
    check(
      "core_invoice_end_client_allocations_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

/**
 * Exact billable lines captured when the draft invoice is created. Invoice
 * documents must never be rebuilt from mutable catalog or order projections.
 */
export const invoiceDocumentSnapshots = pgTable(
  "core_invoice_document_snapshots",
  {
    invoiceId: uuid("invoice_id")
      .primaryKey()
      .references(() => invoices.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    currency: text("currency").notNull(),
    lineItems: jsonb("line_items").notNull(),
    subtotalMinor: minor("subtotal_minor"),
    taxMinor: minor("tax_minor"),
    totalMinor: minor("total_minor"),
    sourceHash: text("source_hash").notNull(),
    sourceVersion: text("source_version").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_invoice_document_snapshot_source_unique").on(
      table.sourceHash,
    ),
    check(
      "core_invoice_document_snapshot_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
    check(
      "core_invoice_document_snapshot_lines_check",
      sql`jsonb_typeof(${table.lineItems}) = 'array' and jsonb_array_length(${table.lineItems}) > 0`,
    ),
    check(
      "core_invoice_document_snapshot_amounts_check",
      sql`${table.subtotalMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.totalMinor} = ${table.subtotalMinor} + ${table.taxMinor}`,
    ),
    check(
      "core_invoice_document_snapshot_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "core_invoice_document_snapshot_version_check",
      sql`length(${table.sourceVersion}) between 1 and 80`,
    ),
  ],
);

export const collectionCases = pgTable(
  "core_collection_cases",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .unique()
      .references(() => invoices.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    agingBucket: text("aging_bucket").notNull(),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    newServiceBlocked: boolean("new_service_blocked").notNull().default(false),
    runningServiceDecision: text("running_service_decision")
      .notNull()
      .default("continue"),
    maximumRetentionAt: timestamp("maximum_retention_at", {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_collection_queue_idx").on(table.status, table.nextActionAt),
    check(
      "core_collection_status_check",
      sql`${table.status} in ('open','promised','escalated','resolved','written_off')`,
    ),
    check(
      "core_collection_service_decision_check",
      sql`${table.runningServiceDecision} in ('continue','human_review','suspend_write')`,
    ),
  ],
);

export const collectionActions = pgTable(
  "core_collection_actions",
  {
    id: id(),
    collectionCaseId: uuid("collection_case_id")
      .notNull()
      .references(() => collectionCases.id),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_collection_action_timeline_idx").on(
      table.collectionCaseId,
      table.occurredAt,
    ),
  ],
);

export const partnerHierarchyEdges = pgTable(
  "core_partner_hierarchy_edges",
  {
    id: id(),
    distributorAccountId: uuid("distributor_account_id")
      .notNull()
      .references(() => accounts.id),
    resellerAccountId: uuid("reseller_account_id")
      .notNull()
      .references(() => accounts.id),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull(),
    settlementResponsibility: text("settlement_responsibility").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_partner_hierarchy_active_reseller_unique")
      .on(table.resellerAccountId)
      .where(sql`${table.status} = 'active'`),
    index("core_partner_hierarchy_distributor_idx").on(
      table.distributorAccountId,
      table.status,
    ),
    check(
      "core_partner_hierarchy_self_check",
      sql`${table.distributorAccountId} <> ${table.resellerAccountId}`,
    ),
    check(
      "core_partner_hierarchy_dates_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const dealRegistrationAttributions = pgTable(
  "core_deal_registration_attributions",
  {
    registrationId: uuid("registration_id")
      .primaryKey()
      .references(() => dealRegistrations.id),
    attribution: text("attribution").notNull(),
    influenceBps: integer("influence_bps").notNull(),
    decisionBasis: text("decision_basis").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => commerceUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "core_deal_attribution_check",
      sql`${table.attribution} in ('sourced','influenced','none') and ${table.influenceBps} between 0 and 10000`,
    ),
  ],
);

export const dealRegistrationExclusions = pgTable(
  "core_deal_registration_exclusions",
  {
    id: id(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => dealRegistrations.id),
    kind: text("kind").notNull(),
    matchedAccountId: uuid("matched_account_id").references(() => accounts.id),
    evidence: jsonb("evidence").notNull(),
    status: text("status").notNull(),
    resolvedBy: uuid("resolved_by").references(() => commerceUsers.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_deal_exclusion_queue_idx").on(table.status, table.createdAt),
    check(
      "core_deal_exclusion_kind_check",
      sql`${table.kind} in ('house_account','prior_deal','duplicate_entity','restricted_party','territory')`,
    ),
  ],
);

export const dealRegistrationDisputes = pgTable(
  "core_deal_registration_disputes",
  {
    id: id(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => dealRegistrations.id),
    challengerPartnerAccountId: uuid("challenger_partner_account_id")
      .notNull()
      .references(() => accounts.id),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    status: text("status").notNull(),
    tiebreak: text("tiebreak"),
    decidedBy: uuid("decided_by").references(() => commerceUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_deal_dispute_open_unique")
      .on(table.registrationId)
      .where(sql`${table.status} in ('open','under_review')`),
    index("core_deal_dispute_queue_idx").on(table.status, table.createdAt),
  ],
);

export const commissionStatements = pgTable(
  "core_commission_statements",
  {
    id: id(),
    partnerAccountId: uuid("partner_account_id")
      .notNull()
      .references(() => accounts.id),
    periodStartsOn: date("period_starts_on").notNull(),
    periodEndsOn: date("period_ends_on").notNull(),
    currency: text("currency").notNull(),
    grossAccruedMinor: bigint("gross_accrued_minor", {
      mode: "bigint",
    }).notNull(),
    clawbackMinor: bigint("clawback_minor", { mode: "bigint" }).notNull(),
    holdbackMinor: bigint("holdback_minor", { mode: "bigint" }).notNull(),
    payableMinor: bigint("payable_minor", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_commission_statement_period_unique").on(
      table.partnerAccountId,
      table.periodStartsOn,
      table.periodEndsOn,
      table.currency,
    ),
    index("core_commission_statement_queue_idx").on(table.status),
    check(
      "core_commission_statement_total_check",
      sql`${table.payableMinor} = ${table.grossAccruedMinor} - ${table.clawbackMinor} - ${table.holdbackMinor}`,
    ),
    check(
      "core_commission_statement_period_check",
      sql`${table.periodEndsOn} >= ${table.periodStartsOn}`,
    ),
    check(
      "core_commission_statement_status_check",
      sql`${table.status} in ('draft','issued','approved','exported','paid','void')`,
    ),
    check(
      "core_commission_statements_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const commissionStatementLines = pgTable(
  "core_commission_statement_lines",
  {
    id: id(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => commissionStatements.id),
    accrualId: uuid("accrual_id")
      .notNull()
      .unique()
      .references(() => commissionAccruals.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    netCollectedRevenueMinor: bigint("net_collected_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    commissionMinor: bigint("commission_minor", { mode: "bigint" }).notNull(),
    holdbackMinor: bigint("holdback_minor", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("core_commission_statement_line_idx").on(table.statementId),
    check(
      "core_commission_statement_line_source_check",
      sql`${table.sourceType} in ('payment','credit_note','credit_note_void','refund','dispute')`,
    ),
  ],
);

export const commissionSettlementExports = pgTable(
  "core_commission_settlement_exports",
  {
    id: id(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => commissionStatements.id),
    exportKey: text("export_key").notNull().unique(),
    format: text("format").notNull(),
    status: text("status").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    providerReference: text("provider_reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [index("core_commission_settlement_queue_idx").on(table.status)],
);

/**
 * Service-owned binding from the persisted partner account to a verified QBO
 * vendor. Raw realm identifiers and provider credentials are intentionally not
 * stored here; the realm reference is a one-way fingerprint.
 */
export const partnerQboVendorMappings = pgTable(
  "core_partner_qbo_vendor_mappings",
  {
    partnerAccountId: uuid("partner_account_id")
      .primaryKey()
      .references(() => accounts.id),
    provider: text("provider").notNull().default("qbo"),
    realmReferenceHash: text("realm_reference_hash").notNull(),
    vendorId: text("vendor_id").notNull(),
    verificationStatus: text("verification_status").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    verifiedBy: uuid("verified_by")
      .notNull()
      .references(() => commerceUsers.id),
    sourceReference: text("source_reference").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_partner_qbo_vendor_provider_unique").on(
      table.provider,
      table.vendorId,
    ),
    check(
      "core_partner_qbo_vendor_provider_check",
      sql`${table.provider} = 'qbo'`,
    ),
    check(
      "core_partner_qbo_vendor_realm_hash_check",
      sql`${table.realmReferenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "core_partner_qbo_vendor_status_check",
      sql`${table.verificationStatus} in ('verified','revoked')`,
    ),
  ],
);

export const stripeAdjustmentOperations = pgTable(
  "core_stripe_adjustment_operations",
  {
    adjustmentId: uuid("adjustment_id").primaryKey(),
    kind: text("kind").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    sourceId: uuid("source_id").notNull(),
    sourceCurrency: text("source_currency").notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    providerPaymentIntentId: text("provider_payment_intent_id"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    individualCapMinor: bigint("individual_cap_minor", {
      mode: "bigint",
    }).notNull(),
    aggregateCapMinor: bigint("aggregate_cap_minor", {
      mode: "bigint",
    }).notNull(),
    providerReason: text("provider_reason").notNull(),
    internalReasonCode: text("internal_reason_code").notNull(),
    providerIdempotencyKey: text("provider_idempotency_key").notNull().unique(),
    state: text("state").notNull().default("approved"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    providerObjectId: text("provider_object_id").unique(),
    providerStatus: text("provider_status"),
    lastErrorCode: text("last_error_code"),
    commandVersion: integer("command_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_stripe_adjustment_source_idx").on(
      table.kind,
      table.sourceId,
      table.sourceCurrency,
      table.state,
    ),
    check(
      "core_stripe_adjustment_kind_check",
      sql`${table.kind} in ('credit_note','refund')`,
    ),
    check(
      "core_stripe_adjustment_state_check",
      sql`${table.state} in ('approved','submitting','retrying','provider_accepted','rejected')`,
    ),
    check(
      "core_stripe_adjustment_amount_check",
      sql`${table.amountMinor} > 0 and ${table.amountMinor} <= ${table.individualCapMinor} and ${table.individualCapMinor} <= ${table.aggregateCapMinor}`,
    ),
    check(
      "core_stripe_adjustment_operations_source_currency_check",
      sql`${table.sourceCurrency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const marketplaceEvents = pgTable(
  "core_marketplace_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerAccountReference: text("provider_account_reference").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    orderId: uuid("order_id").references(() => orders.id),
    entitlementId: uuid("entitlement_id").references(() => entitlements.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    currency: text("currency"),
    grossMinor: bigint("gross_minor", { mode: "bigint" }),
    feeMinor: bigint("fee_minor", { mode: "bigint" }),
    taxMinor: bigint("tax_minor", { mode: "bigint" }),
    netMinor: bigint("net_minor", { mode: "bigint" }),
    quantity: numeric("quantity", { precision: 38, scale: 18 }),
    payloadHash: text("payload_hash").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_marketplace_event_dedup_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("core_marketplace_event_queue_idx").on(
      table.provider,
      table.processingStatus,
      table.occurredAt,
    ),
    check(
      "core_marketplace_provider_check",
      sql`${table.provider} in ('aws','azure','google')`,
    ),
    check(
      "core_marketplace_payload_hash_check",
      sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "core_marketplace_events_currency_check",
      sql`${table.currency} is null or ${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const marketplaceFinancialEntries = pgTable(
  "core_marketplace_financial_entries",
  {
    id: id(),
    marketplaceEventId: uuid("marketplace_event_id")
      .notNull()
      .references(() => marketplaceEvents.id),
    entryType: text("entry_type").notNull(),
    providerLineReference: text("provider_line_reference").notNull(),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    servicePeriodStartsOn: date("service_period_starts_on"),
    servicePeriodEndsOn: date("service_period_ends_on"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_marketplace_financial_line_unique").on(
      table.marketplaceEventId,
      table.providerLineReference,
      table.entryType,
    ),
    check(
      "core_marketplace_entry_type_check",
      sql`${table.entryType} in ('order','entitlement','metering','fee','invoice','settlement','refund','tax')`,
    ),
    check(
      "core_marketplace_financial_entries_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const marketplaceReconciliations = pgTable(
  "core_marketplace_reconciliations",
  {
    id: id(),
    provider: text("provider").notNull(),
    periodStartsOn: date("period_starts_on").notNull(),
    periodEndsOn: date("period_ends_on").notNull(),
    currency: text("currency").notNull(),
    providerGrossMinor: bigint("provider_gross_minor", {
      mode: "bigint",
    }).notNull(),
    platformGrossMinor: bigint("platform_gross_minor", {
      mode: "bigint",
    }).notNull(),
    providerFeesMinor: bigint("provider_fees_minor", {
      mode: "bigint",
    }).notNull(),
    platformFeesMinor: bigint("platform_fees_minor", {
      mode: "bigint",
    }).notNull(),
    varianceMinor: bigint("variance_minor", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    resolution: text("resolution"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_marketplace_reconciliation_period_unique").on(
      table.provider,
      table.periodStartsOn,
      table.periodEndsOn,
      table.currency,
    ),
    index("core_marketplace_reconciliation_queue_idx").on(table.status),
    check(
      "core_marketplace_reconciliations_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const accountingExports = pgTable(
  "core_accounting_exports",
  {
    id: id(),
    exportType: text("export_type").notNull(),
    periodStartsOn: date("period_starts_on").notNull(),
    periodEndsOn: date("period_ends_on").notNull(),
    currency: text("currency").notNull(),
    adapter: text("adapter").notNull().default("qbo_neutral"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull(),
    totalDebitMinor: minor("total_debit_minor"),
    totalCreditMinor: minor("total_credit_minor"),
    providerReference: text("provider_reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("core_accounting_export_queue_idx").on(table.status, table.createdAt),
    check(
      "core_accounting_export_balance_check",
      sql`${table.totalDebitMinor} = ${table.totalCreditMinor}`,
    ),
    check(
      "core_accounting_export_type_check",
      sql`${table.exportType} in ('ar_issuance','payout_summary','deferred_revenue','commission_bill','tax_liability','cost_summary')`,
    ),
    check(
      "core_accounting_exports_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const accountingExportEntries = pgTable(
  "core_accounting_export_entries",
  {
    id: id(),
    exportId: uuid("export_id")
      .notNull()
      .references(() => accountingExports.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    accountCode: text("account_code").notNull(),
    description: text("description").notNull(),
    debitMinor: bigint("debit_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    creditMinor: bigint("credit_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    servicePeriodStartsOn: date("service_period_starts_on"),
    servicePeriodEndsOn: date("service_period_ends_on"),
    dimensions: jsonb("dimensions").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("core_accounting_export_source_unique").on(
      table.exportId,
      table.sourceType,
      table.sourceId,
      table.accountCode,
    ),
    check(
      "core_accounting_entry_sided_check",
      sql`${table.debitMinor} >= 0 and ${table.creditMinor} >= 0 and ((${table.debitMinor} = 0) <> (${table.creditMinor} = 0))`,
    ),
  ],
);

export const threeWayTieOuts = pgTable(
  "core_three_way_tie_outs",
  {
    id: id(),
    periodStartsOn: date("period_starts_on").notNull(),
    periodEndsOn: date("period_ends_on").notNull(),
    currency: text("currency").notNull(),
    platformRevenueMinor: bigint("platform_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    stripeRevenueMinor: bigint("stripe_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    qboRevenueMinor: bigint("qbo_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    stripeVarianceMinor: bigint("stripe_variance_minor", {
      mode: "bigint",
    }).notNull(),
    qboVarianceMinor: bigint("qbo_variance_minor", {
      mode: "bigint",
    }).notNull(),
    status: text("status").notNull(),
    variances: jsonb("variances").notNull().default([]),
    reviewedBy: uuid("reviewed_by").references(() => commerceUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("core_three_way_tie_out_period_unique").on(
      table.periodStartsOn,
      table.periodEndsOn,
      table.currency,
    ),
    index("core_three_way_tie_out_queue_idx").on(table.status),
    check(
      "core_three_way_tie_out_math_check",
      sql`${table.stripeVarianceMinor} = ${table.platformRevenueMinor} - ${table.stripeRevenueMinor} and ${table.qboVarianceMinor} = ${table.platformRevenueMinor} - ${table.qboRevenueMinor}`,
    ),
    check(
      "core_three_way_tie_outs_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
  ],
);

export const coreFinanceTables = {
  accountCommercialProfiles,
  accountRelationshipRoles,
  accountContacts,
  accountTaxIdentifiers,
  procurementCertificates,
  priceBookActivationEvents,
  partnerTransferTiers,
  quoteCommercialProfiles,
  quoteSnapshots,
  pricingExceptionDecisions,
  orderCommercialProfiles,
  orderLineSnapshots,
  amendmentFinancialTerms,
  amendmentLineSupersessions,
  commitmentPeriods,
  commitmentLedgerCorrections,
  commitmentAllowanceAdjustments,
  usageReconciliations,
  billingPolicies,
  invoiceEndClientAllocations,
  invoiceDocumentSnapshots,
  collectionCases,
  collectionActions,
  partnerHierarchyEdges,
  dealRegistrationAttributions,
  dealRegistrationExclusions,
  dealRegistrationDisputes,
  commissionStatements,
  commissionStatementLines,
  commissionSettlementExports,
  partnerQboVendorMappings,
  stripeAdjustmentOperations,
  marketplaceEvents,
  marketplaceFinancialEntries,
  marketplaceReconciliations,
  accountingExports,
  accountingExportEntries,
  threeWayTieOuts,
};
