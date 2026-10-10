import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ContractApprovalState,
  ContractCurrency,
  ContractFileKind,
  ContractPaper,
  ContractSigner,
  ContractSigningState,
  ContractStatus,
  ContractType,
  SalesAudience,
  SalesCollateralKind,
  SalesCollateralStatus,
} from "@clockwork/contracts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const storedDocuments = pgTable("commerce_stored_documents", {
  id: uuid("id").primaryKey(),
  purpose: text("purpose").$type<"contract" | "collateral">().notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const commerceContracts = pgTable(
  "commerce_contracts",
  {
    id: uuid("id").primaryKey(),
    counterpartyName: text("counterparty_name").notNull(),
    title: text("title").notNull().default(""),
    contractType: text("contract_type").$type<ContractType>().notNull(),
    paper: text("paper").$type<ContractPaper>().notNull(),
    status: text("status").$type<ContractStatus>().notNull(),
    effectiveDate: date("effective_date", { mode: "string" }),
    initialTermMonths: integer("initial_term_months"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    renewalTermMonths: integer("renewal_term_months"),
    noticePeriodDays: integer("notice_period_days"),
    valueMinor: bigint("value_minor", { mode: "number" }),
    currency: text("currency").$type<ContractCurrency>(),
    pricingNotes: text("pricing_notes").notNull().default(""),
    ownerName: text("owner_name").notNull(),
    internalNotes: text("internal_notes").notNull().default(""),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: text("source")
      .$type<"register" | "template">()
      .notNull()
      .default("register"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_contracts_type_status").on(t.contractType, t.status),
    index("commerce_contracts_updated").on(t.updatedAt.desc()),
  ],
);

export const contractFiles = pgTable(
  "commerce_contract_files",
  {
    id: uuid("id").primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => commerceContracts.id),
    kind: text("kind").$type<ContractFileKind>().notNull(),
    fileName: text("file_name").notNull(),
    storageBackend: text("storage_backend").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    uploadedById: uuid("uploaded_by_id"),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.storageBackend, t.storageKey),
    index("commerce_contract_files_contract").on(t.contractId, t.createdAt),
    uniqueIndex("commerce_contract_files_one_generated")
      .on(t.contractId)
      .where(sql`${t.kind} = 'generated'`),
    uniqueIndex("commerce_contract_files_one_executed")
      .on(t.contractId)
      .where(sql`${t.kind} = 'executed'`),
  ],
);

export const contractEvents = pgTable(
  "commerce_contract_events",
  {
    id: uuid("id").primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => commerceContracts.id),
    eventType: text("event_type").notNull(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name").notNull(),
    changes: jsonb("changes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("commerce_contract_events_contract").on(t.contractId, t.occurredAt),
  ],
);

export const contractSigning = pgTable("commerce_contract_signing", {
  contractId: uuid("contract_id")
    .primaryKey()
    .references(() => commerceContracts.id),
  templateId: text("template_id").notNull(),
  templateVersion: text("template_version").notNull(),
  templateHash: text("template_hash").notNull(),
  documentName: text("document_name").notNull(),
  input: jsonb("input").$type<Record<string, string>>().notNull(),
  counterpartySigner: jsonb("counterparty_signer")
    .$type<ContractSigner>()
    .notNull(),
  countersigner: jsonb("countersigner")
    .$type<ContractSigner & { id: string }>()
    .notNull(),
  preparerId: uuid("preparer_id").notNull(),
  preparerName: text("preparer_name").notNull(),
  approvalRequired: boolean("approval_required").notNull(),
  approvalState: text("approval_state")
    .$type<ContractApprovalState>()
    .notNull(),
  approverId: uuid("approver_id"),
  approverName: text("approver_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  state: text("state").$type<ContractSigningState>().notNull().default("draft"),
  providerId: text("provider_id").unique(),
  testMode: boolean("test_mode").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseToken: uuid("lease_token"),
  error: text("error"),
  version: integer("version").notNull().default(1),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  /** Scheduled SignWell check bookkeeping; not a change to the request. */
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
});

export const salesCollateral = pgTable(
  "commerce_sales_collateral",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").$type<SalesCollateralKind>().notNull(),
    audience: text("audience").$type<SalesAudience>().notNull(),
    status: text("status").$type<SalesCollateralStatus>().notNull(),
    contentUpdatedOn: date("content_updated_on", { mode: "string" }).notNull(),
    linkUrl: text("link_url"),
    fileName: text("file_name"),
    storageBackend: text("storage_backend"),
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    sizeBytes: integer("size_bytes"),
    createdById: uuid("created_by_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    updatedByName: text("updated_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_sales_collateral_listing").on(
      t.status,
      t.audience,
      t.contentUpdatedOn.desc(),
    ),
  ],
);

export const contractsSchema = {
  storedDocuments,
  commerceContracts,
  contractFiles,
  contractEvents,
  contractSigning,
  salesCollateral,
};
