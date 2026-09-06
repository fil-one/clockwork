import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { accounts, organizations, commerceUsers } from "../../schema";
import { paygOfferVersions } from "./payg-offers";
import { paygEnrollments } from "./payg-billing";
import { trialClaims } from "./trials";
export const customerAcquisitionRequests = pgTable(
  "core_customer_acquisition_requests",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => paygOfferVersions.id),
    requestHash: text("request_hash").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    trialId: uuid("trial_id").references(() => trialClaims.id),
    enrollmentId: uuid("enrollment_id").references(() => paygEnrollments.id),
    resolvedBy: uuid("resolved_by").references(() => commerceUsers.id),
    resolutionReason: text("resolution_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
);
