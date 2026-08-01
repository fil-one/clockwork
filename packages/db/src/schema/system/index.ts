import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import * as providerSchema from "./providers";

export * from "./providers";

export const externalGates = pgTable(
  "system_external_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gateKey: text("gate_key").notNull().unique(),
    title: text("title").notNull(),
    owner: text("owner").notNull(),
    inputRequired: text("input_required").notNull(),
    affectedFeature: text("affected_feature").notNull(),
    severity: text("severity").notNull(),
    configuredStatus: text("configured_status").notNull().default("blocked"),
    simulatorState: text("simulator_state").notNull().default("unavailable"),
    simulatorDetails: text("simulator_details").notNull(),
    inputProvenance: text("input_provenance").notNull().default("unverified"),
    lastActivationTestStatus: text("last_activation_test_status")
      .notNull()
      .default("never"),
    lastActivationTestAt: timestamp("last_activation_test_at", {
      withTimezone: true,
    }),
    lastActivationTestedBy: text("last_activation_tested_by"),
    activationEvidenceReference: text("activation_evidence_reference"),
    reviewOn: date("review_on"),
    statusReason: text("status_reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("system_external_gates_status_idx").on(
      table.configuredStatus,
      table.reviewOn,
    ),
    check(
      "system_external_gates_key_check",
      sql`${table.gateKey} ~ '^EXT-[A-Z]+-[0-9]{2}$'`,
    ),
    check(
      "system_external_gates_status_check",
      sql`${table.configuredStatus} in ('blocked','review','pending','active','not_required')`,
    ),
    check(
      "system_external_gates_simulator_check",
      sql`${table.simulatorState} in ('ready','degraded','unavailable')`,
    ),
    check(
      "system_external_gates_test_status_check",
      sql`${table.lastActivationTestStatus} in ('never','passed','failed')`,
    ),
    check(
      "system_external_gates_input_provenance_check",
      sql`${table.inputProvenance} in ('unverified','repository_fixture','live_signed')`,
    ),
    check(
      "system_external_gates_signed_input_activation_check",
      sql`${table.configuredStatus} <> 'active' or ${table.gateKey} not in ('EXT-COMMERCIAL-01','EXT-TAX-01') or ${table.inputProvenance} = 'live_signed'`,
    ),
  ],
);

export const systemCapabilities = pgTable(
  "system_capabilities",
  {
    capabilityKey: text("capability_key").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    recoveryEnabled: boolean("recovery_enabled").notNull().default(false),
    changeReason: text("change_reason").notNull(),
    changedBy: text("changed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    check(
      "system_capabilities_key_check",
      sql`${table.capabilityKey} in ('new_business','legal','billing','partner','marketplace','teardown')`,
    ),
  ],
);

export const systemSchema = {
  externalGates,
  systemCapabilities,
  ...providerSchema,
};
