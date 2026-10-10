import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { contractDeletedInSignWell } from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { contractSigning } from "../schema/contracts";
import { mndaRequests } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";

/**
 * States in which SignWell holds a sent or sending document whose state can
 * move without Commerce acting: a signer signs or declines, or the document
 * expires. A `ready` draft has not been sent, so nothing changes in SignWell
 * until a person continues it here.
 */
const reconcilableStates = [
  "preparing",
  "sending",
  "sent",
  "viewed",
  "awaiting_countersignature",
  "attention",
] as const;

/**
 * Deleted in SignWell: nothing is left to read and a person voids it. Both
 * registers record it as `deleted_in_signwell`. `is distinct from`, so a null
 * error still matches.
 */
function notDeletedInSignWell(state: SQLWrapper, error: SQLWrapper) {
  return or(
    ne(state, "attention"),
    sql`${error} is distinct from ${contractDeletedInSignWell}`,
  );
}

export interface StaleSigningQuery {
  /** Only rows whose last change is older than this. */
  updatedBefore: Date;
  /** Ids already visited in this sweep. */
  exclude: readonly string[];
  limit: number;
}

/**
 * Finds e-signature requests that may have changed in SignWell without a
 * webhook reaching Commerce: bound to a provider document, not closed, not
 * changed recently and not held by another operation's lease. Requests the
 * check has never picked come first, then the one it picked longest ago, so
 * consecutive runs rotate through every open request. The sweep marks each
 * request as it picks it and syncs it through its workflow, which takes the
 * lease itself.
 */
export class ESignReconciliationRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private async read<T>(
    query: StaleSigningQuery,
    fn: (tx: RuntimeTransaction) => Promise<T>,
  ) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1)
      throw new Error("ESIGN_RECONCILE_LIMIT_INVALID");
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  staleMndaRequests(query: StaleSigningQuery) {
    const t = mndaRequests;
    return this.read(query, async (tx) => {
      const rows = await tx
        .select({ id: t.id })
        .from(t)
        .where(
          and(
            isNotNull(t.providerId),
            inArray(t.state, [...reconcilableStates]),
            notDeletedInSignWell(t.state, t.error),
            lt(t.updatedAt, query.updatedBefore),
            or(isNull(t.leaseUntil), lte(t.leaseUntil, sql`now()`)),
            query.exclude.length
              ? notInArray(t.id, [...query.exclude])
              : undefined,
          ),
        )
        .orderBy(
          sql`${t.reconciledAt} asc nulls first`,
          asc(t.updatedAt),
          asc(t.id),
        )
        .limit(query.limit);
      return rows.map((r) => r.id);
    });
  }

  staleContractSignings(query: StaleSigningQuery) {
    const t = contractSigning;
    return this.read(query, async (tx) => {
      const rows = await tx
        .select({ id: t.contractId })
        .from(t)
        .where(
          and(
            isNotNull(t.providerId),
            inArray(t.state, [...reconcilableStates]),
            notDeletedInSignWell(t.state, t.error),
            lt(t.updatedAt, query.updatedBefore),
            or(isNull(t.leaseUntil), lte(t.leaseUntil, sql`now()`)),
            query.exclude.length
              ? notInArray(t.contractId, [...query.exclude])
              : undefined,
          ),
        )
        .orderBy(
          sql`${t.reconciledAt} asc nulls first`,
          asc(t.updatedAt),
          asc(t.contractId),
        )
        .limit(query.limit);
      return rows.map((r) => r.id);
    });
  }

  /**
   * Records that the check picked a request. Only `reconciled_at` is written:
   * no version, `updated_at`, audit row or lease, so it cannot overwrite or
   * reorder a lease holder's change.
   */
  async markMndaReconciled(id: string) {
    await withInternalTransaction(this.db, randomUUID(), (tx) =>
      tx
        .update(mndaRequests)
        .set({ reconciledAt: sql`now()` })
        .where(eq(mndaRequests.id, id)),
    );
  }

  async markContractReconciled(contractId: string) {
    await withInternalTransaction(this.db, randomUUID(), (tx) =>
      tx
        .update(contractSigning)
        .set({ reconciledAt: sql`now()` })
        .where(eq(contractSigning.contractId, contractId)),
    );
  }
}
