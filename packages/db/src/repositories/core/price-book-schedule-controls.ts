import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import type { RuntimeTransaction } from "../../client";
import { commerceUsers, memberships } from "../../schema";
import { DatabaseCoreError } from "./database-core-error";

export async function lockPriceBookCurrency(
  tx: RuntimeTransaction,
  currency: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"price-book-currency:" + currency},0))`,
  );
}

/** Persisted staff authority is checked at approval and again at execution. */
export async function assertPersistedPriceScheduleFinance(
  tx: RuntimeTransaction,
  userId: string,
  command?: { actor: Actor; authorization: AuthorizationContext },
) {
  if (
    command &&
    (command.actor.kind !== "user" ||
      command.actor.id !== userId ||
      command.actor.effectiveUserId ||
      command.actor.impersonatedAccountId ||
      !command.authorization.isInternalStaff ||
      !command.authorization.roles.includes("finance_approver") ||
      !command.authorization.mfaVerified ||
      !command.authorization.recentAuthenticationVerified)
  )
    throw new DatabaseCoreError(
      "INVALID_STATE",
      "Direct finance authority with recent MFA is required for scheduling",
    );
  const [user] = await tx
    .select({ id: commerceUsers.id })
    .from(commerceUsers)
    .innerJoin(memberships, eq(memberships.userId, commerceUsers.id))
    .where(
      and(
        eq(commerceUsers.id, userId),
        eq(commerceUsers.isInternalStaff, true),
        eq(commerceUsers.mfaEnrolled, true),
        eq(memberships.role, "finance_approver"),
      ),
    )
    .limit(1)
    .for("share");
  if (!user)
    throw new DatabaseCoreError(
      "INVALID_STATE",
      "The retained finance authority is no longer eligible; cancel and obtain a new approval",
    );
}
