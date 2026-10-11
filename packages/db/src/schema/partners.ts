import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  PartnerCommissionStep,
  PartnerContact,
  PartnerCurrency,
  PartnerDealModel,
  PartnerDealStatus,
  PartnerExclusivity,
  PartnerModel,
  PartnerSizeUnit,
  PartnerStatus,
  PartnerTermRow,
} from "@clockwork/contracts";

/** Mirrors supabase/migrations/001466_commerce_partners.sql. */
export const commercePartners = pgTable(
  "commerce_partners",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").generatedAlwaysAs(
      sql`public.commerce_mnda_normalize_company(name)`,
    ),
    website: text("website").notNull().default(""),
    region: text("region").notNull().default(""),
    models: text("models")
      .array()
      .$type<PartnerModel[]>()
      .notNull()
      .default([]),
    status: text("status").$type<PartnerStatus>().notNull().default("prospect"),
    ownerId: uuid("owner_id"),
    ownerName: text("owner_name"),
    organizationId: uuid("organization_id"),
    contacts: jsonb("contacts").$type<PartnerContact[]>().notNull().default([]),
    nextStep: text("next_step").notNull().default(""),
    nextStepDue: date("next_step_due", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    commissionPct: numeric("commission_pct", { precision: 7, scale: 4 }),
    commissionSchedule: text("commission_schedule").notNull().default(""),
    commissionSteps: jsonb("commission_steps")
      .$type<PartnerCommissionStep[]>()
      .notNull()
      .default([]),
    marginPct: numeric("margin_pct", { precision: 7, scale: 4 }),
    territory: text("territory").notNull().default(""),
    exclusivity: text("exclusivity").$type<PartnerExclusivity>(),
    exclusivityNote: text("exclusivity_note").notNull().default(""),
    currency: text("currency").$type<PartnerCurrency>(),
    nfrAllowance: text("nfr_allowance").notNull().default(""),
    trialPeriod: text("trial_period").notNull().default(""),
    trialTargets: text("trial_targets").notNull().default(""),
    termRows: jsonb("term_rows")
      .$type<PartnerTermRow[]>()
      .notNull()
      .default([]),
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
    index("commerce_partners_updated").on(t.updatedAt.desc(), t.id.desc()),
    index("commerce_partners_normalized_name").on(t.normalizedName),
  ],
);

export const commercePartnerDeals = pgTable(
  "commerce_partner_deals",
  {
    id: uuid("id").primaryKey(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => commercePartners.id),
    endClient: text("end_client").notNull(),
    normalizedEndClient: text("normalized_end_client").generatedAlwaysAs(
      sql`public.commerce_mnda_normalize_company(end_client)`,
    ),
    organizationId: uuid("organization_id"),
    registeredOn: date("registered_on", { mode: "string" }).notNull(),
    protectedUntil: date("protected_until", { mode: "string" }).notNull(),
    estimatedSize: numeric("estimated_size", { precision: 15, scale: 3 }),
    sizeUnit: text("size_unit").$type<PartnerSizeUnit>(),
    model: text("model")
      .$type<PartnerDealModel>()
      .notNull()
      .default("referral"),
    status: text("status")
      .$type<PartnerDealStatus>()
      .notNull()
      .default("registered"),
    notes: text("notes").notNull().default(""),
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
    index("commerce_partner_deals_partner").on(
      t.partnerId,
      t.registeredOn.desc(),
      t.id.desc(),
    ),
  ],
);

export const partnersSchema = { commercePartners, commercePartnerDeals };
