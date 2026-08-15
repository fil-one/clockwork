import { and, asc, eq } from "drizzle-orm";

import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase } from "../../client";
import { notificationPreferences } from "../../schema";
import { withAuthorizedTransaction } from "../../transaction";

export interface NotificationPreferenceRecord {
  accountId: string;
  alertKind: string;
  channel: string;
  enabled: boolean;
  rowVersion: number;
  updatedAt: string;
}

export class NotificationPreferenceError extends Error {
  public constructor(
    public readonly code: "ALERT_KIND_NOT_MANAGEABLE",
    message: string,
  ) {
    super(message);
    this.name = "NotificationPreferenceError";
  }
}

/**
 * The account surface for `notification_preferences` (001400).
 *
 * Reads and writes run inside an authorized transaction, so
 * `notification_preference_scope` is the tenant boundary. The manageable alert
 * kinds are the check constraint's, not a list restated here: an attempt to
 * disable the contractual notice window or a dunning notice fails on the
 * constraint, and this class only translates that into a stable code.
 */
export class DatabaseNotificationPreferenceRepository {
  public constructor(
    private readonly options: {
      database: RuntimeDatabase;
      authorizationSecret: string;
    },
  ) {}

  public list(input: {
    accountId: string;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<{ items: NotificationPreferenceRecord[] }> {
    return this.transaction(input, async (transaction) => {
      const rows = await transaction.query.notificationPreferences.findMany({
        where: eq(notificationPreferences.accountId, input.accountId),
        orderBy: asc(notificationPreferences.alertKind),
      });
      return { items: rows.map(record) };
    });
  }

  public set(input: {
    accountId: string;
    alertKind: string;
    channel: string;
    enabled: boolean;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<NotificationPreferenceRecord> {
    return this.transaction(input, async (transaction) => {
      const existing =
        await transaction.query.notificationPreferences.findFirst({
          where: and(
            eq(notificationPreferences.accountId, input.accountId),
            eq(notificationPreferences.alertKind, input.alertKind),
            eq(notificationPreferences.channel, input.channel),
          ),
        });
      try {
        if (!existing) {
          const [inserted] = await transaction
            .insert(notificationPreferences)
            .values({
              accountId: input.accountId,
              alertKind: input.alertKind,
              channel: input.channel,
              enabled: input.enabled,
            })
            .returning();
          if (!inserted)
            throw new Error("NOTIFICATION_PREFERENCE_INSERT_FAILED");
          return record(inserted);
        }
        if (existing.enabled === input.enabled) return record(existing);
        const [updated] = await transaction
          .update(notificationPreferences)
          .set({ enabled: input.enabled })
          .where(eq(notificationPreferences.id, existing.id))
          .returning();
        if (!updated) throw new Error("NOTIFICATION_PREFERENCE_UPDATE_FAILED");
        return record(updated);
      } catch (error) {
        if (isAlertKindRejection(error))
          throw new NotificationPreferenceError(
            "ALERT_KIND_NOT_MANAGEABLE",
            `${input.alertKind} is not an optional alert and cannot be switched off`,
          );
        throw error;
      }
    });
  }

  private transaction<T>(
    input: { authorization: AuthorizationContext; requestId: string },
    operation: Parameters<typeof withAuthorizedTransaction<T>>[3],
  ): Promise<T> {
    return withAuthorizedTransaction(
      this.options.database,
      {
        userId: input.authorization.userId,
        accountIds: input.authorization.accountIds,
        roles: input.authorization.roles,
        isInternalStaff: input.authorization.isInternalStaff,
        requestId: input.requestId,
      },
      { secret: this.options.authorizationSecret },
      operation,
    );
  }
}

function record(row: {
  accountId: string;
  alertKind: string;
  channel: string;
  enabled: boolean;
  rowVersion: number;
  updatedAt: Date;
}): NotificationPreferenceRecord {
  return {
    accountId: row.accountId,
    alertKind: row.alertKind,
    channel: row.channel,
    enabled: row.enabled,
    rowVersion: row.rowVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The driver error carries `constraint_name`; drizzle wraps it, so the cause
 * chain is walked rather than only the surface error. Matching the constraint
 * by name is what keeps the manageable vocabulary in one place -- the migration
 * -- instead of copied into a second list here.
 */
function isAlertKindRejection(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "constraint_name" in current &&
      (current as { constraint_name?: unknown }).constraint_name ===
        "notification_preferences_alert_kind_check"
    )
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
