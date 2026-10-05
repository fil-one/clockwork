import { randomUUID } from "node:crypto";
import { and, count, gte, inArray, ne, or, sql } from "drizzle-orm";

import type { MndaState } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../client";
import { mndaRequests } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";

/**
 * The MNDA groups the staff home page counts. The state names are the MNDA
 * contract's own, so a link built from a group opens the register filtered to
 * exactly the rows counted here.
 */
export const salesHomeMndaGroups = {
  waitingPartner: ["sent", "viewed"],
  waitingFilOne: ["awaiting_countersignature"],
  completed: ["completed"],
  drafts: ["draft", "preparing", "ready", "sending"],
} as const satisfies Record<string, readonly MndaState[]>;

export type SalesHomeMndaGroup = keyof typeof salesHomeMndaGroups;

export type SalesHomeMndaTally = Readonly<Record<SalesHomeMndaGroup, number>>;

export interface SalesHomeMndaCounts {
  /** Requests the reader created. */
  mine: SalesHomeMndaTally;
  /** Every staff member's requests, the reader's included. */
  team: SalesHomeMndaTally;
}

const groupOfState = new Map<string, SalesHomeMndaGroup>(
  Object.entries(salesHomeMndaGroups).flatMap(([group, states]) =>
    states.map((state) => [state, group as SalesHomeMndaGroup] as const),
  ),
);

function emptyTally(): Record<SalesHomeMndaGroup, number> {
  return { waitingPartner: 0, waitingFilOne: 0, completed: 0, drafts: 0 };
}

/**
 * Counts open, recently completed and draft MNDAs for one reader and for the
 * team. Completed requests count only from `completedSince`, so the home page
 * shows recent work rather than the whole archive.
 */
export async function countSalesHomeMndas(
  db: RuntimeDatabase,
  input: { ownerId: string; completedSince: Date; requestId?: string },
): Promise<SalesHomeMndaCounts> {
  const states = [...groupOfState.keys()];
  const rows = await withInternalTransaction(
    db,
    input.requestId ?? `sales-home:${randomUUID()}`,
    (tx) =>
      tx
        .select({
          state: mndaRequests.state,
          mine: sql<number>`count(*) filter (where ${mndaRequests.ownerId} = ${input.ownerId}::uuid)`,
          total: count(),
        })
        .from(mndaRequests)
        .where(
          and(
            inArray(mndaRequests.state, states as MndaState[]),
            or(
              ne(mndaRequests.state, "completed"),
              gte(mndaRequests.completedAt, input.completedSince),
            ),
          ),
        )
        .groupBy(mndaRequests.state),
  );
  const mine = emptyTally();
  const team = emptyTally();
  for (const row of rows) {
    const group = groupOfState.get(row.state);
    if (!group) continue;
    team[group] += Number(row.total);
    mine[group] += Number(row.mine);
  }
  return { mine, team };
}
