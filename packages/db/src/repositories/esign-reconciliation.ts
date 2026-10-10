import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
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
 * changed recently and not held by another operation's lease. Oldest change
 * first. Read-only: the sweep syncs each id through its workflow, which takes
 * the lease itself.
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
            // Deleted in SignWell: nothing left to read; a person voids it.
            // `is distinct from`, so a null error still matches.
            or(
              ne(t.state, "attention"),
              sql`${t.error} is distinct from 'deleted_in_signwell'`,
            ),
            lt(t.updatedAt, query.updatedBefore),
            or(isNull(t.leaseUntil), lte(t.leaseUntil, sql`now()`)),
            query.exclude.length
              ? notInArray(t.id, [...query.exclude])
              : undefined,
          ),
        )
        .orderBy(asc(t.updatedAt), asc(t.id))
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
            lt(t.updatedAt, query.updatedBefore),
            or(isNull(t.leaseUntil), lte(t.leaseUntil, sql`now()`)),
            query.exclude.length
              ? notInArray(t.contractId, [...query.exclude])
              : undefined,
          ),
        )
        .orderBy(asc(t.updatedAt), asc(t.contractId))
        .limit(query.limit);
      return rows.map((r) => r.id);
    });
  }
}
