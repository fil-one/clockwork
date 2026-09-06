import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts, commerceUsers } from "../../schema";
import * as providerSchema from "./providers";

export * from "./providers";

const uuidV7Default = sql`public.uuid_v7()`;

export const externalGates = pgTable(
  "system_external_gates",
  {
    id: uuid("id").primaryKey().default(uuidV7Default),
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
    emergencyDisabledAt: timestamp("emergency_disabled_at", {
      withTimezone: true,
    }),
    emergencyDisabledBy: text("emergency_disabled_by"),
    emergencyDisableReason: text("emergency_disable_reason"),
    emergencyDisableEvidenceReference: text(
      "emergency_disable_evidence_reference",
    ),
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
    check(
      "system_external_gates_emergency_state_check",
      sql`(${table.emergencyDisabledAt} is null and ${table.emergencyDisabledBy} is null and ${table.emergencyDisableReason} is null and ${table.emergencyDisableEvidenceReference} is null) or (${table.emergencyDisabledAt} is not null and ${table.emergencyDisabledBy} is not null and ${table.emergencyDisableReason} is not null and ${table.emergencyDisableEvidenceReference} is not null and length(trim(${table.emergencyDisabledBy})) > 0 and length(trim(${table.emergencyDisableReason})) >= 8 and length(trim(${table.emergencyDisableEvidenceReference})) > 0)`,
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

export const systemCapabilityRequests = pgTable(
  "system_capability_requests",
  {
    id: uuid("id").primaryKey().default(uuidV7Default),
    capabilityKey: text("capability_key")
      .notNull()
      .references(() => systemCapabilities.capabilityKey),
    baseVersion: integer("base_version").notNull(),
    enableRecovery: boolean("enable_recovery").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => commerceUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
  },
  (table) => [
    uniqueIndex("system_capability_requests_pending_unique")
      .on(table.capabilityKey)
      .where(sql`${table.status} = 'pending'`),
    check(
      "system_capability_requests_status_check",
      sql`${table.status} in ('pending','approved','rejected','canceled')`,
    ),
    check(
      "system_capability_requests_separation_check",
      sql`${table.status} <> 'approved' or ${table.decidedBy} <> ${table.requestedBy}`,
    ),
    check(
      "system_capability_requests_decision_check",
      sql`(${table.status} = 'pending' and ${table.decidedBy} is null and ${table.decidedAt} is null and ${table.decisionReason} is null) or (${table.status} <> 'pending' and ${table.decidedBy} is not null and ${table.decidedAt} is not null and length(trim(${table.decisionReason})) >= 8)`,
    ),
    check(
      "system_capability_requests_reason_check",
      sql`length(trim(${table.reason})) >= 8 and length(trim(${table.evidenceReference})) > 0 and ${table.baseVersion} > 0`,
    ),
  ],
);

export const systemProductionBootstraps = pgTable(
  "system_production_bootstraps",
  {
    id: uuid("id").primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    manifest: jsonb("manifest").notNull(),
    appliedBy: uuid("applied_by")
      .notNull()
      .references(() => commerceUsers.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "system_production_bootstraps_manifest_hash_check",
      sql`${table.manifestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "system_production_bootstraps_manifest_check",
      sql`jsonb_typeof(${table.manifest}) = 'object'`,
    ),
  ],
);

export const systemExceptionRoster = pgTable(
  "system_exception_roster",
  {
    id: uuid("id").primaryKey().default(uuidV7Default),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    queue: text("queue").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceUsers.id),
    role: text("role").notNull(),
    active: boolean("active").notNull().default(false),
    qualificationEvidenceReference: text(
      "qualification_evidence_reference",
    ).notNull(),
    qualifiedUntil: timestamp("qualified_until", {
      withTimezone: true,
    }).notNull(),
    absentFrom: timestamp("absent_from", { withTimezone: true }),
    absentUntil: timestamp("absent_until", { withTimezone: true }),
    targetMinutes: integer("target_minutes").notNull(),
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("system_exception_roster_assignment_unique").on(
      table.accountId,
      table.queue,
      table.userId,
      table.role,
    ),
    index("system_exception_roster_resolution_idx").on(
      table.accountId,
      table.queue,
      table.active,
      table.role,
      table.priority,
    ),
    check(
      "system_exception_roster_queue_check",
      sql`${table.queue} ~ '^[a-z][a-z0-9_]{1,63}$'`,
    ),
    check(
      "system_exception_roster_role_check",
      sql`${table.role} in ('primary','backup','escalation')`,
    ),
    check(
      "system_exception_roster_target_check",
      sql`${table.targetMinutes} between 1 and 43200`,
    ),
    check(
      "system_exception_roster_priority_check",
      sql`${table.priority} between 0 and 1000000`,
    ),
    check(
      "system_exception_roster_qualification_evidence_check",
      sql`length(trim(${table.qualificationEvidenceReference})) > 0`,
    ),
    check(
      "system_exception_roster_absence_check",
      sql`(${table.absentFrom} is null and ${table.absentUntil} is null) or (${table.absentFrom} is not null and ${table.absentUntil} is not null and ${table.absentFrom} < ${table.absentUntil})`,
    ),
  ],
);

export const systemExternalGateActivationTasks = pgTable(
  "system_external_gate_activation_tasks",
  {
    id: uuid("id").primaryKey().default(uuidV7Default),
    taskKey: text("task_key").notNull().unique(),
    gateKey: text("gate_key")
      .notNull()
      .references(() => externalGates.gateKey),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    probeResult: jsonb("probe_result"),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    index("system_gate_activation_recovery_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("system_gate_activation_gate_idx").on(
      table.gateKey,
      table.provider,
      table.createdAt,
    ),
    check(
      "system_gate_activation_mode_check",
      sql`${table.mode} in ('live','simulator')`,
    ),
    check(
      "system_gate_activation_task_key_check",
      sql`length(trim(${table.taskKey})) >= 8`,
    ),
    check(
      "system_gate_activation_provider_check",
      sql`length(trim(${table.provider})) > 0`,
    ),
    check(
      "system_gate_activation_status_check",
      sql`${table.status} in ('pending','probing','provider_succeeded','succeeded','retrying','dead_letter')`,
    ),
    check(
      "system_gate_activation_attempt_check",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "system_gate_activation_result_check",
      sql`${table.status} not in ('provider_succeeded','succeeded') or ${table.probeResult} is not null`,
    ),
    check(
      "system_gate_activation_completed_check",
      sql`(${table.status} = 'succeeded' and ${table.completedAt} is not null) or (${table.status} <> 'succeeded' and ${table.completedAt} is null)`,
    ),
    check(
      "system_gate_activation_lease_check",
      sql`(${table.status} in ('probing','provider_succeeded') and ${table.leaseToken} is not null and ${table.leaseUntil} is not null) or (${table.status} not in ('probing','provider_succeeded') and ${table.leaseToken} is null and ${table.leaseUntil} is null)`,
    ),
  ],
);

export const systemSchema = {
  externalGates,
  systemCapabilities,
  systemCapabilityRequests,
  systemProductionBootstraps,
  systemExceptionRoster,
  systemExternalGateActivationTasks,
  ...providerSchema,
};
