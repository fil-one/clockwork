import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Immutable provider-to-commerce identity bindings used before webhook apply. */
export const providerResourceBindings = pgTable(
  "system_provider_resource_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerResourceType: text("provider_resource_type").notNull(),
    providerResourceId: text("provider_resource_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    binding: jsonb("binding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("system_provider_resource_binding_unique").on(
      table.provider,
      table.providerResourceType,
      table.providerResourceId,
    ),
    index("system_provider_aggregate_binding_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    check(
      "system_provider_binding_names_check",
      sql`length(trim(${table.provider})) > 0 and length(trim(${table.providerResourceType})) > 0 and length(trim(${table.providerResourceId})) > 0 and length(trim(${table.aggregateType})) > 0`,
    ),
  ],
);

/**
 * Per-aggregate provider watermark. It prevents a verified but delayed event
 * from regressing a newer projection while retaining the signed inbox event.
 */
export const providerProjectionCheckpoints = pgTable(
  "system_provider_projection_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    aggregateKey: text("aggregate_key").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("system_provider_projection_checkpoint_unique").on(
      table.provider,
      table.aggregateKey,
    ),
    index("system_provider_projection_checkpoint_time_idx").on(
      table.provider,
      table.occurredAt,
    ),
  ],
);
