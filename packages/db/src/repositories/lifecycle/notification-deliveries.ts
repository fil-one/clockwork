import { Buffer } from "node:buffer";

import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase } from "../../client";
import { notificationDeliveries } from "../../schema";
import { withAuthorizedTransaction } from "../../transaction";

export interface NotificationDeliveryRecord {
  id: string;
  accountId: string;
  channel: string;
  alertKind: string;
  subjectType: string;
  subjectId: string;
  template: string;
  recipients: string[];
  status: string;
  providerMessageId: string | null;
  failureCode: string | null;
  requestedAt: string;
  deliveredAt: string | null;
}

export interface NotificationDeliveryListInput {
  accountId: string;
  alertKind?: string;
  cursor?: string;
  limit: number;
  authorization: AuthorizationContext;
  requestId: string;
}

const CursorSchema = z.object({ id: z.string().min(1) });

/**
 * Reads the append-only delivery record `001330_notification_deliveries.sql`
 * writes on every lifecycle notification effect. The rows existed and no
 * operation exposed them, so §18's `/notifications` catalogue entry had nothing
 * behind it and an account could not see what the platform had sent it.
 *
 * The read runs inside an authorized transaction, so `notification_delivery_read`
 * -- `app_has_account(account_id)` -- is the tenant boundary rather than a
 * predicate this class could get wrong.
 */
export class DatabaseNotificationDeliveryRepository {
  public constructor(
    private readonly options: {
      database: RuntimeDatabase;
      authorizationSecret: string;
    },
  ) {}

  public list(input: NotificationDeliveryListInput): Promise<{
    items: NotificationDeliveryRecord[];
    nextCursor: string | null;
  }> {
    const decoded: unknown = input.cursor
      ? JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))
      : undefined;
    const cursor = CursorSchema.safeParse(decoded);
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
      async (transaction) => {
        const rows = await transaction.query.notificationDeliveries.findMany({
          where: and(
            eq(notificationDeliveries.accountId, input.accountId),
            ...(input.alertKind
              ? [eq(notificationDeliveries.alertKind, input.alertKind)]
              : []),
            ...(cursor.success
              ? [lt(notificationDeliveries.id, cursor.data.id)]
              : []),
          ),
          // Identifiers are UUIDv7, so descending id is newest-first and stays
          // a stable page boundary while later attempts append.
          orderBy: desc(notificationDeliveries.id),
          limit: input.limit + 1,
        });
        const page = rows.slice(0, input.limit);
        const last = page.at(-1);
        return {
          items: page.map((row) => ({
            id: row.id,
            accountId: row.accountId,
            channel: row.channel,
            alertKind: row.alertKind,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            template: row.template,
            recipients: row.recipients,
            status: row.status,
            providerMessageId: row.providerMessageId,
            failureCode: row.failureCode,
            requestedAt: row.requestedAt.toISOString(),
            deliveredAt: row.deliveredAt?.toISOString() ?? null,
          })),
          nextCursor:
            rows.length > input.limit && last
              ? Buffer.from(JSON.stringify({ id: last.id })).toString(
                  "base64url",
                )
              : null,
        };
      },
    );
  }
}
