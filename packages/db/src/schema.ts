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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const id = (name = "id") => uuid(name).primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rowVersion = () => integer("row_version").notNull().default(1);
const currency = () => text("currency").notNull();
const minor = (name: string) => bigint(name, { mode: "bigint" }).notNull();

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    legalName: text("legal_name").notNull(),
    relationshipRoles: text("relationship_roles").array().notNull(),
    registeredAddress: jsonb("registered_address").notNull(),
    taxIds: jsonb("tax_ids").notNull().default([]),
    billingContact: jsonb("billing_contact").notNull(),
    apContact: jsonb("ap_contact").notNull(),
    invoiceDeliveryEmail: text("invoice_delivery_email").notNull(),
    domain: text("domain").notNull(),
    country: text("country").notNull(),
    currency: currency(),
    screeningStatus: text("screening_status").notNull().default("pending"),
    stripeCustomerId: text("stripe_customer_id"),
    crmRecordId: text("crm_record_id"),
    parentPartnerId: uuid("parent_partner_id").references(
      (): AnyPgColumn => accounts.id,
    ),
    partnerAgreementType: text("partner_agreement_type"),
    partnerDiscountTier: text("partner_discount_tier"),
    commissionRateBps: integer("commission_rate_bps"),
    commissionHoldbackBps: integer("commission_holdback_bps"),
    aggregateCreditLimitMinor: minor("aggregate_credit_limit_minor").default(
      sql`0`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("accounts_legal_entity_unique").on(
      table.country,
      table.legalName,
    ),
    uniqueIndex("accounts_domain_unique").on(table.domain),
    uniqueIndex("accounts_stripe_customer_unique").on(table.stripeCustomerId),
    index("accounts_parent_partner_idx").on(table.parentPartnerId),
    check(
      "accounts_currency_check",
      sql`${table.currency} in ('USD','EUR','GBP')`,
    ),
    check(
      "accounts_roles_nonempty_check",
      sql`cardinality(${table.relationshipRoles}) > 0`,
    ),
    check(
      "accounts_credit_nonnegative_check",
      sql`${table.aggregateCreditLimitMinor} >= 0`,
    ),
    check(
      "accounts_commission_policy_check",
      sql`(${table.commissionRateBps} is null) = (${table.commissionHoldbackBps} is null) and (${table.commissionRateBps} is null or (${table.commissionRateBps} between 0 and 10000 and ${table.commissionHoldbackBps} between 0 and 10000))`,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    byteLength: bigint("byte_length", { mode: "bigint" }).notNull(),
    objectLockMode: text("object_lock_mode").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    legalHold: boolean("legal_hold").notNull().default(false),
    storageVersionId: text("storage_version_id").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("documents_content_hash_unique").on(table.contentHash),
    uniqueIndex("documents_storage_version_unique").on(
      table.storageKey,
      table.storageVersionId,
    ),
    check("documents_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check("documents_bytes_nonnegative_check", sql`${table.byteLength} >= 0`),
    check(
      "documents_lock_mode_check",
      sql`${table.objectLockMode} in ('COMPLIANCE','GOVERNANCE')`,
    ),
  ],
);

export const procurementProfiles = pgTable("procurement_profiles", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id),
  poRequired: boolean("po_required").notNull().default(false),
  exemptions: jsonb("exemptions").notNull().default([]),
  supplierPortalStatus: text("supplier_portal_status")
    .notNull()
    .default("not_required"),
  supplierDocuments: jsonb("supplier_documents").notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    isolated: boolean("isolated").notNull().default(false),
    workosOrganizationId: text("workos_organization_id").unique(),
    externalProvisioningId: text("external_provisioning_id").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("organizations_account_name_unique").on(
      table.accountId,
      table.name,
    ),
  ],
);

export const commerceUsers = pgTable("commerce_users", {
  id: id(),
  workosUserId: text("workos_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  isInternalStaff: boolean("is_internal_staff").notNull().default(false),
  mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceUsers.id),
    workosMembershipId: text("workos_membership_id").unique(),
    role: text("role").notNull(),
    approvalLimitMinor: bigint("approval_limit_minor", { mode: "bigint" }),
    approvalLimitCurrency: text("approval_limit_currency"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("invites_org_pending_idx").on(table.organizationId, table.acceptedAt),
  ],
);

export const agreementTemplates = pgTable(
  "agreement_templates",
  {
    id: id(),
    type: text("type").notNull(),
    semanticVersion: text("semantic_version").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    effectiveOn: date("effective_on").notNull(),
    canonicalDocumentId: uuid("canonical_document_id")
      .notNull()
      .references(() => documents.id),
    textHash: text("text_hash").notNull(),
    executionMode: text("execution_mode").notNull(),
    approvalStatus: text("approval_status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => commerceUsers.id),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("agreement_templates_version_unique").on(
      table.type,
      table.semanticVersion,
      table.jurisdiction,
    ),
    check(
      "agreement_templates_execution_mode_check",
      sql`${table.executionMode} in ('click_through','counter_signed')`,
    ),
    check(
      "agreement_templates_approval_status_check",
      sql`${table.approvalStatus} in ('draft','approved','retired')`,
    ),
  ],
);

export const agreements = pgTable(
  "agreements",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    templateId: uuid("template_id").references(() => agreementTemplates.id),
    paper: text("paper").notNull(),
    executionMode: text("execution_mode").notNull(),
    executedDocumentId: uuid("executed_document_id")
      .notNull()
      .references(() => documents.id),
    evidenceDocumentId: uuid("evidence_document_id").references(
      () => documents.id,
    ),
    envelopeId: text("envelope_id"),
    negotiationStatus: text("negotiation_status").notNull(),
    effectiveOn: date("effective_on").notNull(),
    termMonths: integer("term_months"),
    renewalType: text("renewal_type").notNull(),
    noticeDays: integer("notice_days").notNull(),
    status: text("status").notNull(),
    supersededById: uuid("superseded_by_id").references(
      (): AnyPgColumn => agreements.id,
    ),
    signerUserId: uuid("signer_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    authorityTitle: text("authority_title").notNull(),
    authorityAttested: boolean("authority_attested").notNull(),
    acceptedIp: text("accepted_ip").notNull(),
    acceptedUserAgent: text("accepted_user_agent").notNull(),
    textHash: text("text_hash").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("agreements_account_term_idx").on(
      table.accountId,
      table.status,
      table.effectiveOn,
    ),
    check("agreements_authority_check", sql`${table.authorityAttested} = true`),
    check("agreements_paper_check", sql`${table.paper} in ('ours','theirs')`),
    check(
      "agreements_execution_mode_check",
      sql`${table.executionMode} in ('click_through','counter_signed')`,
    ),
    check(
      "agreements_renewal_type_check",
      sql`${table.renewalType} in ('auto_renew','expires')`,
    ),
    check(
      "agreements_status_check",
      sql`${table.status} in ('active','in_notice','expired','terminated')`,
    ),
  ],
);

export const keyTerms = pgTable("key_terms", {
  id: id(),
  agreementId: uuid("agreement_id")
    .notNull()
    .unique()
    .references(() => agreements.id),
  slaCreditSchedule: jsonb("sla_credit_schedule").notNull().default({}),
  liabilityCapMinor: bigint("liability_cap_minor", { mode: "bigint" }),
  liabilityCapCurrency: text("liability_cap_currency"),
  breachNoticeHours: integer("breach_notice_hours").notNull(),
  renewalPriceProtectionBps: integer("renewal_price_protection_bps"),
  auditRights: text("audit_rights").notNull(),
  retentionLiabilityRule: text("retention_liability_rule").notNull(),
  customTerms: jsonb("custom_terms").notNull().default({}),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const priceBooks = pgTable(
  "price_books",
  {
    id: id(),
    name: text("name").notNull(),
    currency: currency(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: text("status").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("price_books_currency_version_unique").on(
      table.currency,
      table.version,
    ),
    uniqueIndex("price_books_one_active_currency_unique")
      .on(table.currency)
      .where(sql`${table.status} = 'active'`),
    check(
      "price_books_status_check",
      sql`${table.status} in ('draft','active','retired')`,
    ),
  ],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: id(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id),
    sku: text("sku").notNull(),
    approvedClaim: text("approved_claim").notNull(),
    region: text("region").notNull(),
    unit: text("unit").notNull(),
    unitPriceMinor: minor("unit_price_minor"),
    floorPriceMinor: bigint("floor_price_minor", { mode: "bigint" }),
    overageRateMinor: minor("overage_rate_minor"),
    minimumQuantity: numeric("minimum_quantity", {
      precision: 38,
      scale: 18,
    }).notNull(),
    trialLimit: numeric("trial_limit", { precision: 38, scale: 18 }),
    egressTreatment: text("egress_treatment").notNull(),
    commitType: text("commit_type").notNull(),
    stripeTaxCode: text("stripe_tax_code").notNull(),
    qboIncomeAccount: text("qbo_income_account").notNull(),
    partnerTransferPrices: jsonb("partner_transfer_prices")
      .notNull()
      .default({}),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("rate_cards_book_sku_region_unique").on(
      table.priceBookId,
      table.sku,
      table.region,
    ),
    check(
      "rate_card_price_check",
      sql`${table.unitPriceMinor} >= 0 and ${table.overageRateMinor} >= 0`,
    ),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    endClientAccountId: uuid("end_client_account_id").references(
      () => accounts.id,
    ),
    partnerAccountId: uuid("partner_account_id").references(() => accounts.id),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id),
    seriesId: uuid("series_id").notNull(),
    previousRevisionId: uuid("previous_revision_id").references(
      (): AnyPgColumn => quotes.id,
    ),
    revision: integer("revision").notNull(),
    status: text("status").notNull(),
    currency: currency(),
    totalMinor: minor("total_minor"),
    marginFloorResult: text("margin_floor_result").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => commerceUsers.id),
    renderedDocumentId: uuid("rendered_document_id").references(
      () => documents.id,
    ),
    partnerDocumentId: uuid("partner_document_id").references(
      () => documents.id,
    ),
    partnerResaleTotalMinor: bigint("partner_resale_total_minor", {
      mode: "bigint",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
    immutableAt: timestamp("immutable_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("quotes_revision_unique").on(table.seriesId, table.revision),
    index("quotes_account_timeline_idx").on(table.accountId, table.createdAt),
    index("quotes_queue_idx").on(
      table.marginFloorResult,
      table.status,
      table.createdAt,
    ),
    check("quotes_total_nonnegative_check", sql`${table.totalMinor} >= 0`),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id),
    sku: text("sku").notNull(),
    quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
    termMonths: integer("term_months").notNull(),
    unitPriceMinor: minor("unit_price_minor"),
    overageRateMinor: minor("overage_rate_minor"),
    discountBps: integer("discount_bps").notNull().default(0),
    lineTotalMinor: minor("line_total_minor"),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "quote_lines_values_check",
      sql`${table.quantity} >= 0 and ${table.termMonths} > 0 and ${table.unitPriceMinor} >= 0 and ${table.overageRateMinor} >= 0 and ${table.discountBps} between 0 and 10000`,
    ),
  ],
);

export const pocs = pgTable(
  "pocs",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    partnerAccountId: uuid("partner_account_id").references(() => accounts.id),
    workload: text("workload").notNull(),
    permittedDataClass: text("permitted_data_class").notNull(),
    successTests: jsonb("success_tests").notNull(),
    commercialRange: jsonb("commercial_range").notNull(),
    capacityCap: numeric("capacity_cap", {
      precision: 38,
      scale: 18,
    }).notNull(),
    egressCap: numeric("egress_cap", { precision: 38, scale: 18 }).notNull(),
    durationDays: integer("duration_days").notNull(),
    namedKeys: text("named_keys").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    supportOwnerId: uuid("support_owner_id")
      .notNull()
      .references(() => commerceUsers.id),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    midpointAt: timestamp("midpoint_at", { withTimezone: true }).notNull(),
    finalReportAt: timestamp("final_report_at", {
      withTimezone: true,
    }).notNull(),
    costMinor: minor("cost_minor").default(sql`0`),
    currency: currency(),
    engineeringMinutes: integer("engineering_minutes").notNull().default(0),
    status: text("status").notNull(),
    convertedQuoteId: uuid("converted_quote_id").references(() => quotes.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("pocs_expiry_queue_idx").on(table.status, table.expiresAt),
    check(
      "pocs_status_check",
      sql`${table.status} in ('proposed','approved','active','expired','converted','closed')`,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .unique()
      .references(() => quotes.id),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    invoicingAccountId: uuid("invoicing_account_id")
      .notNull()
      .references(() => accounts.id),
    partnerAccountId: uuid("partner_account_id").references(() => accounts.id),
    sourcing: text("sourcing").notNull(),
    poNumber: text("po_number"),
    poDocumentId: uuid("po_document_id").references(() => documents.id),
    signerUserId: uuid("signer_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    authorityTitle: text("authority_title").notNull(),
    authorityAttested: boolean("authority_attested").notNull(),
    status: text("status").notNull(),
    serviceStartsOn: date("service_starts_on").notNull(),
    serviceEndsOn: date("service_ends_on"),
    noticeOn: date("notice_on"),
    orderFormDocumentId: uuid("order_form_document_id").references(
      () => documents.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
    immutableAt: timestamp("immutable_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_account_timeline_idx").on(table.accountId, table.createdAt),
    index("orders_renewal_idx").on(
      table.status,
      table.noticeOn,
      table.serviceEndsOn,
    ),
    index("orders_partner_renewal_idx").on(
      table.partnerAccountId,
      table.serviceEndsOn,
    ),
    check(
      "orders_term_check",
      sql`${table.serviceEndsOn} is null or ${table.serviceEndsOn} >= ${table.serviceStartsOn}`,
    ),
    check("orders_authority_check", sql`${table.authorityAttested} = true`),
    check(
      "orders_status_check",
      sql`${table.status} in ('submitted','accepted','provisioning','active','amended','completed','cancelled','terminated')`,
    ),
    check(
      "orders_sourcing_check",
      sql`${table.sourcing} in ('direct','referral','resale','distributor','marketplace')`,
    ),
  ],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  quoteLineId: uuid("quote_line_id")
    .notNull()
    .unique()
    .references(() => quoteLines.id),
  sku: text("sku").notNull(),
  quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
  unitPriceMinor: minor("unit_price_minor"),
  overageRateMinor: minor("overage_rate_minor"),
  supersededByAmendmentId: uuid("superseded_by_amendment_id"),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const amendments = pgTable(
  "amendments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    effectiveOn: date("effective_on").notNull(),
    kind: text("kind").notNull(),
    prorationMethod: text("proration_method").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("amendments_order_effective_idx").on(
      table.orderId,
      table.effectiveOn,
    ),
  ],
);

export const amendmentLines = pgTable("amendment_lines", {
  id: id(),
  amendmentId: uuid("amendment_id")
    .notNull()
    .references(() => amendments.id),
  orderLineId: uuid("order_line_id").references(() => orderLines.id),
  sku: text("sku").notNull(),
  quantityDelta: numeric("quantity_delta", {
    precision: 38,
    scale: 18,
  }).notNull(),
  priceDeltaMinor: bigint("price_delta_minor", { mode: "bigint" }).notNull(),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const commitmentLedgers = pgTable(
  "commitment_ledgers",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    commitType: text("commit_type").notNull(),
    committedQuantity: numeric("committed_quantity", {
      precision: 38,
      scale: 18,
    }).notNull(),
    consumedQuantity: numeric("consumed_quantity", { precision: 38, scale: 18 })
      .notNull()
      .default("0"),
    overageQuantity: numeric("overage_quantity", { precision: 38, scale: 18 })
      .notNull()
      .default("0"),
    periodStartsAt: timestamp("period_starts_at", {
      withTimezone: true,
    }).notNull(),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("commitment_ledgers_period_unique").on(
      table.orderLineId,
      table.periodStartsAt,
      table.periodEndsAt,
    ),
    check(
      "commitment_quantities_check",
      sql`${table.committedQuantity} >= 0 and ${table.consumedQuantity} >= 0 and ${table.overageQuantity} >= 0`,
    ),
  ],
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sku: text("sku").notNull(),
    committedQuantity: numeric("committed_quantity", {
      precision: 38,
      scale: 18,
    }).notNull(),
    region: text("region").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    maximumRetentionAt: timestamp("maximum_retention_at", {
      withTimezone: true,
    }),
    provisionedResourceId: text("provisioned_resource_id"),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("entitlements_order_line_unique").on(table.orderLineId),
    index("entitlements_org_status_idx").on(table.organizationId, table.status),
    index("entitlements_retention_idx").on(
      table.status,
      table.maximumRetentionAt,
    ),
    check(
      "entitlements_status_check",
      sql`${table.status} in ('pending','active','suspended_write','terminated')`,
    ),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id),
    externalEventId: text("external_event_id").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("usage_events_provider_dedup_unique").on(
      table.entitlementId,
      table.externalEventId,
    ),
    index("usage_events_meter_idx").on(table.entitlementId, table.measuredAt),
  ],
);

export const commitmentEntries = pgTable("commitment_entries", {
  id: id(),
  ledgerId: uuid("ledger_id")
    .notNull()
    .references(() => commitmentLedgers.id),
  usageEventId: uuid("usage_event_id")
    .notNull()
    .unique()
    .references(() => usageEvents.id),
  quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
  overageQuantity: numeric("overage_quantity", {
    precision: 38,
    scale: 18,
  }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    accountingPostingId: text("accounting_posting_id").unique(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    poNumber: text("po_number"),
    status: text("status").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    stripeLastOccurredAt: timestamp("stripe_last_occurred_at", {
      withTimezone: true,
    }),
    stripeLastEventId: text("stripe_last_event_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("invoices_account_aging_idx").on(
      table.accountId,
      table.status,
      table.dueAt,
    ),
    index("invoices_order_idx").on(table.orderId),
    check(
      "invoices_status_check",
      sql`${table.status} in ('draft','open','paid','void','uncollectible')`,
    ),
    check(
      "invoices_provider_binding_check",
      sql`(${table.status} = 'draft' and ${table.stripeInvoiceId} is null) or (${table.status} <> 'draft' and ${table.stripeInvoiceId} is not null)`,
    ),
    check(
      "invoices_stripe_watermark_check",
      sql`(${table.stripeLastOccurredAt} is null) = (${table.stripeLastEventId} is null)`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    status: text("status").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    stripeLastOccurredAt: timestamp("stripe_last_occurred_at", {
      withTimezone: true,
    }),
    stripeLastEventId: text("stripe_last_event_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    check(
      "payments_status_check",
      sql`${table.status} in ('pending','succeeded','failed','refunded')`,
    ),
    check(
      "payments_stripe_watermark_check",
      sql`(${table.stripeLastOccurredAt} is null) = (${table.stripeLastEventId} is null)`,
    ),
  ],
);
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    stripeCreditNoteId: text("stripe_credit_note_id").notNull().unique(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    reasonCode: text("reason_code").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => commerceUsers.id),
    status: text("status").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "credit_notes_status_check",
      sql`${table.status} in ('issued','void')`,
    ),
  ],
);
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    stripeRefundId: text("stripe_refund_id").notNull().unique(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    reasonCode: text("reason_code").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check(
      "refunds_status_check",
      sql`${table.status} in ('pending','succeeded','failed')`,
    ),
  ],
);
export const disputeCases = pgTable(
  "dispute_cases",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    evidenceDueAt: timestamp("evidence_due_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("disputes_evidence_queue_idx").on(table.status, table.evidenceDueAt),
    check(
      "dispute_cases_status_check",
      sql`${table.status} in ('needs_response','under_review','won','lost')`,
    ),
  ],
);

export const inboundNotices = pgTable(
  "inbound_notices",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").notNull(),
    servedOn: date("served_on").notNull(),
    evidenceDocumentId: uuid("evidence_document_id")
      .notNull()
      .references(() => documents.id),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => commerceUsers.id),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("inbound_notices_renewal_gate_idx").on(
      table.orderId,
      table.type,
      table.servedOn,
    ),
  ],
);

export const terminations = pgTable(
  "terminations",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    orderId: uuid("order_id").references(() => orders.id),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    finalBillingStatus: text("final_billing_status").notNull(),
    teardownStatus: text("teardown_status").notNull().default("gated"),
    deletionScheduledAt: timestamp("deletion_scheduled_at", {
      withTimezone: true,
    }),
    teardownConfirmedAt: timestamp("teardown_confirmed_at", {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("terminations_teardown_queue_idx").on(
      table.teardownStatus,
      table.effectiveAt,
    ),
  ],
);

export const deletionCertificates = pgTable("deletion_certificates", {
  id: id(),
  terminationId: uuid("termination_id")
    .notNull()
    .unique()
    .references(() => terminations.id),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  scope: text("scope").notNull(),
  method: text("method").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  lockedExclusions: jsonb("locked_exclusions").notNull().default([]),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const dealRegistrations = pgTable(
  "deal_registrations",
  {
    id: id(),
    partnerAccountId: uuid("partner_account_id")
      .notNull()
      .references(() => accounts.id),
    endClientAccountId: uuid("end_client_account_id")
      .notNull()
      .references(() => accounts.id),
    workload: text("workload").notNull(),
    expectedVolume: numeric("expected_volume", {
      precision: 38,
      scale: 18,
    }).notNull(),
    status: text("status").notNull(),
    protectionStartsAt: timestamp("protection_starts_at", {
      withTimezone: true,
    }).notNull(),
    protectionEndsAt: timestamp("protection_ends_at", {
      withTimezone: true,
    }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    convertedOrderId: uuid("converted_order_id").references(() => orders.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("deal_registration_decision_queue_idx").on(
      table.status,
      table.createdAt,
    ),
    uniqueIndex("deal_registration_active_unique")
      .on(table.partnerAccountId, table.endClientAccountId)
      .where(sql`${table.status} in ('registered','approved','disputed')`),
    check(
      "deal_registrations_status_check",
      sql`${table.status} in ('registered','approved','expired','converted','rejected','disputed')`,
    ),
  ],
);

export const novations = pgTable("novations", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  formerPartnerAccountId: uuid("former_partner_account_id")
    .notNull()
    .references(() => accounts.id),
  sourceOrderId: uuid("source_order_id")
    .notNull()
    .references(() => orders.id),
  newAgreementId: uuid("new_agreement_id")
    .notNull()
    .references(() => agreements.id),
  newOrderId: uuid("new_order_id")
    .notNull()
    .references(() => orders.id),
  reason: text("reason").notNull(),
  continuityConfirmedAt: timestamp("continuity_confirmed_at", {
    withTimezone: true,
  }).notNull(),
  createdAt: createdAt(),
  version: integer("version").notNull().default(1),
});

export const commissionAccruals = pgTable(
  "commission_accruals",
  {
    id: id(),
    partnerAccountId: uuid("partner_account_id")
      .notNull()
      .references(() => accounts.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    adjustmentSourceId: uuid("adjustment_source_id").references(
      (): AnyPgColumn => commissionAccruals.id,
    ),
    rateBps: integer("rate_bps").notNull(),
    holdbackBps: integer("holdback_bps").notNull(),
    currency: currency(),
    netCollectedRevenueMinor: bigint("net_collected_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    holdbackMinor: bigint("holdback_minor", { mode: "bigint" }).notNull(),
    period: text("period").notNull(),
    statementDocumentId: uuid("statement_document_id").references(
      () => documents.id,
    ),
    status: text("status").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("commission_accruals_source_unique").on(
      table.sourceType,
      table.sourceId,
    ),
    index("commission_statement_queue_idx").on(
      table.partnerAccountId,
      table.period,
      table.status,
    ),
    check(
      "commission_accruals_status_check",
      sql`${table.status} in ('accrued','stated','paid')`,
    ),
    check(
      "commission_accruals_source_type_check",
      sql`${table.sourceType} in ('payment','credit_note','refund','dispute')`,
    ),
    check(
      "commission_accruals_policy_check",
      sql`${table.rateBps} between 0 and 10000 and ${table.holdbackBps} between 0 and 10000`,
    ),
    check(
      "commission_accruals_sign_check",
      sql`(${table.sourceType} = 'payment' and ${table.adjustmentSourceId} is null and ${table.netCollectedRevenueMinor} >= 0 and ${table.amountMinor} >= 0 and ${table.holdbackMinor} >= 0) or (${table.sourceType} <> 'payment' and ${table.adjustmentSourceId} is not null and ${table.netCollectedRevenueMinor} <= 0 and ${table.amountMinor} <= 0 and ${table.holdbackMinor} <= 0)`,
    ),
  ],
);

export const exceptionCases = pgTable(
  "exception_cases",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    queue: text("queue").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    backupUserId: uuid("backup_user_id").references(() => commerceUsers.id),
    targetAt: timestamp("target_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    decisionReason: text("decision_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("exception_queue_idx").on(table.queue, table.status, table.targetAt),
    uniqueIndex("exception_open_object_unique")
      .on(table.queue, table.objectType, table.objectId)
      .where(sql`${table.status} = 'open'`),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    approvedBy: uuid("approved_by").references(() => commerceUsers.id),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("approvals_pending_queue_idx").on(
      table.action,
      table.status,
      table.requestedAt,
    ),
    check(
      "approvals_two_person_check",
      sql`${table.approvedBy} is null or ${table.approvedBy} <> ${table.requestedBy}`,
    ),
    check(
      "approvals_decision_check",
      sql`(${table.status} = 'pending' and ${table.approvedBy} is null and ${table.decidedAt} is null) or (${table.status} <> 'pending' and ${table.approvedBy} is not null and ${table.decidedAt} is not null)`,
    ),
  ],
);

export const costRecords = pgTable(
  "cost_records",
  {
    id: id(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id),
    period: text("period").notNull(),
    currency: currency(),
    amountMinor: minor("amount_minor"),
    source: text("source").notNull(),
    createdAt: createdAt(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("cost_records_entitlement_period_unique").on(
      table.entitlementId,
      table.period,
      table.source,
    ),
  ],
);

export const reportExports = pgTable(
  "report_exports",
  {
    id: id(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    report: text("report").notNull(),
    parameters: jsonb("parameters").notNull().default({}),
    documentId: uuid("document_id").references(() => documents.id),
    status: text("status").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("report_exports_queue_idx").on(table.status, table.createdAt),
    check(
      "report_exports_status_check",
      sql`${table.status} in ('pending','running','complete','failed')`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),
    actor: jsonb("actor").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    requestId: text("request_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("audit_aggregate_version_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
    index("audit_account_timeline_idx").on(table.accountId, table.occurredAt),
    index("audit_request_idx").on(table.requestId),
  ],
);

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => auditEvents.id),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (table) => [
    index("outbox_dispatch_queue_idx").on(
      table.processedAt,
      table.availableAt,
      table.attemptCount,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseHeaders: jsonb("response_headers"),
    responseBody: jsonb("response_body"),
    lockToken: text("lock_token").notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idempotency_scope_key_unique").on(table.scope, table.key),
    index("idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    signatureVerifiedAt: timestamp("signature_verified_at", {
      withTimezone: true,
    }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    lockToken: uuid("lock_token").notNull().defaultRandom(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("webhook_provider_dedup_unique").on(
      table.provider,
      table.providerEventId,
    ),
    index("webhook_processing_queue_idx").on(
      table.provider,
      table.processedAt,
      table.occurredAt,
    ),
  ],
);

export const providerOperations = pgTable(
  "provider_operations",
  {
    id: id(),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    providerReference: text("provider_reference"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("provider_operations_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
    index("provider_operations_retry_queue_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      "provider_operations_status_check",
      sql`${table.status} in ('pending','running','succeeded','retrying','failed')`,
    ),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    taskIdentifier: text("task_identifier").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    triggerRunId: text("trigger_run_id"),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("workflow_runs_idempotency_unique").on(
      table.taskIdentifier,
      table.idempotencyKey,
    ),
    index("workflow_runs_status_idx").on(table.status, table.updatedAt),
    check(
      "workflow_runs_status_check",
      sql`${table.status} in ('pending','running','succeeded','retrying','failed','cancelled')`,
    ),
  ],
);

export const impersonationSessions = pgTable(
  "impersonation_sessions",
  {
    id: id(),
    internalUserId: uuid("internal_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    targetAccountId: uuid("target_account_id")
      .notNull()
      .references(() => accounts.id),
    reason: text("reason").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("impersonation_active_idx").on(
      table.internalUserId,
      table.endedAt,
      table.expiresAt,
    ),
  ],
);

export const roleSyncEvents = pgTable(
  "role_sync_events",
  {
    id: id(),
    workosEventId: text("workos_event_id").notNull().unique(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    userId: uuid("user_id").references(() => commerceUsers.id),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull(),
    providerOccurredAt: timestamp("provider_occurred_at", {
      withTimezone: true,
    }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [
    index("role_sync_processing_idx").on(table.processedAt, table.createdAt),
  ],
);

export const schemaTables = {
  accounts,
  documents,
  procurementProfiles,
  organizations,
  commerceUsers,
  memberships,
  invites,
  agreementTemplates,
  agreements,
  keyTerms,
  priceBooks,
  rateCards,
  quotes,
  quoteLines,
  pocs,
  orders,
  orderLines,
  amendments,
  amendmentLines,
  commitmentLedgers,
  commitmentEntries,
  entitlements,
  usageEvents,
  invoices,
  payments,
  creditNotes,
  refunds,
  disputeCases,
  inboundNotices,
  terminations,
  deletionCertificates,
  dealRegistrations,
  novations,
  commissionAccruals,
  exceptionCases,
  approvals,
  costRecords,
  reportExports,
  auditEvents,
  outboxMessages,
  idempotencyRecords,
  webhookEvents,
  providerOperations,
  workflowRuns,
  impersonationSessions,
  roleSyncEvents,
};
