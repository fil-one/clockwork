import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { HandoffRequestedSide, HandoffStatus } from "@clockwork/contracts";

/** Mirrors supabase/migrations/001462_commerce_handoff_requests.sql. */
export const handoffRequests = pgTable(
  "commerce_handoff_requests",
  {
    id: uuid("id").primaryKey(),
    requestedById: uuid("requested_by_id").notNull(),
    requestedByName: text("requested_by_name").notNull(),
    counterpartyLegalName: text("counterparty_legal_name").notNull(),
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email").notNull(),
    signerTitle: text("signer_title").notNull().default(""),
    contractIds: uuid("contract_ids").array().notNull(),
    mndaId: uuid("mnda_id"),
    pricingScenarioId: uuid("pricing_scenario_id"),
    requestedSide: text("requested_side")
      .$type<HandoffRequestedSide>()
      .notNull(),
    notes: text("notes").notNull().default(""),
    status: text("status").$type<HandoffStatus>().notNull().default("open"),
    assigneeId: uuid("assignee_id"),
    assigneeName: text("assignee_name"),
    decisionNote: text("decision_note"),
    decidedById: uuid("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    organizationId: uuid("organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_handoff_requests_requester").on(
      t.requestedById,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("commerce_handoff_requests_queue").on(t.status, t.createdAt, t.id),
  ],
);

export const handoffRequestsSchema = { handoffRequests };
