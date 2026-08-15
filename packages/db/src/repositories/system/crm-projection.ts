import { and, eq, isNull } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { accounts } from "../../schema";
import { withInternalTransaction } from "../../transaction";

/**
 * Writes `accounts.crm_record_id`, the commerce end of the one-way outbound CRM
 * projection (§15). The column existed from `000001_foundation.sql` and nothing
 * ever assigned it, so a registered account carried no reference to the pipeline
 * record the projection created.
 *
 * Commerce stays the customer master, which is why this is a bind rather than an
 * upsert: the predicate matches only a row whose reference is absent or already
 * identical, so a redelivered outbox message is a no-op and a provider that
 * answers with a different record for the same account raises instead of
 * silently repointing the account at it.
 *
 * The bind is not conditioned on an expected `row_version`, because the
 * projection is not replacing a commercial value and has no version to expect;
 * the reference predicate is the whole concurrency control. A successful bind
 * does bump `row_version` -- `touch_versioned_row` fires on every `accounts`
 * update -- which is the same effect the background screening refresh already
 * has on the row, so a concurrent commercial edit conflicts and retries exactly
 * as it does today.
 */
export class DatabaseCrmAccountRecordStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async bindAccountRecord(input: {
    accountId: string;
    crmRecordId: string;
    requestId: string;
  }): Promise<void> {
    await withInternalTransaction(
      this.database,
      `crm-account-record:${input.requestId}`,
      async (transaction) => {
        const [bound] = await transaction
          .update(accounts)
          .set({ crmRecordId: input.crmRecordId })
          .where(
            and(eq(accounts.id, input.accountId), isNull(accounts.crmRecordId)),
          )
          .returning({ crmRecordId: accounts.crmRecordId });
        if (bound) return;
        const existing = await transaction.query.accounts.findFirst({
          columns: { crmRecordId: true },
          where: eq(accounts.id, input.accountId),
        });
        if (!existing) throw new Error("CRM_ACCOUNT_NOT_FOUND");
        // A redelivery re-presents the reference it already wrote. Returning
        // without an UPDATE is what keeps at-least-once delivery from churning
        // `row_version` on an account nobody edited.
        if (existing.crmRecordId === input.crmRecordId) return;
        throw new Error("CRM_ACCOUNT_RECORD_CONFLICT");
      },
    );
  }
}
