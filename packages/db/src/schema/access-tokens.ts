import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AccessTokenRevokedReason,
  AccessTokenScope,
} from "@clockwork/contracts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Mirrors supabase/migrations/001480_commerce_access_tokens.sql. */
export const commerceAccessTokens = pgTable(
  "commerce_access_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    scope: text("scope").$type<AccessTokenScope>().notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    mfaFactorId: text("mfa_factor_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: uuid("revoked_by_id"),
    revokedReason: text("revoked_reason").$type<AccessTokenRevokedReason>(),
    rateWindowStartedAt: timestamp("rate_window_started_at", {
      withTimezone: true,
    }),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("commerce_access_tokens_user").on(
      t.userId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("commerce_access_tokens_organization").on(
      t.organizationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export const accessTokensSchema = { commerceAccessTokens };
