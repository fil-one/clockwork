import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Currency } from "@clockwork/contracts";

/**
 * Mirrors supabase/migrations/001456_pricing_scenarios.sql and
 * 001467_pricing_partner_economics.sql.
 */
export const pricingScenarios = pgTable(
  "commerce_pricing_scenarios",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    ownerName: text("owner_name").notNull(),
    name: text("name").notNull(),
    company: text("company").notNull(),
    notes: text("notes").notNull().default(""),
    currency: text("currency").$type<Currency>().notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    priceBooks: jsonb("price_books").$type<unknown>().notNull(),
    lines: jsonb("lines").$type<unknown>().notNull(),
    partnerEconomics: jsonb("partner_economics").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_pricing_scenarios_owner_updated").on(
      t.ownerId,
      t.updatedAt.desc(),
      t.id.desc(),
    ),
    index("commerce_pricing_scenarios_updated").on(
      t.updatedAt.desc(),
      t.id.desc(),
    ),
  ],
);

export const pricingScenariosSchema = { pricingScenarios };
