import { randomUUID } from "node:crypto";
import { and, count, gte, inArray, ne, or, sql } from "drizzle-orm";

import type { ContractStatusFilter, MndaState } from "@clockwork/contracts";

import type { RuntimeDatabase } from "../client";
import { mndaRequests } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";
import { contractAwaitingApproval, contractNeedsAttention } from "./contracts";

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

/**
 * The register filter that lists exactly the contracts each home group
 * counts across the team.
 */
export const contractHomeStatusFilters = {
  awaitingApproval: "signing_approval",
  needsAttention: "signing_attention",
  outForSignature: "out_for_signature",
} as const satisfies Record<string, ContractStatusFilter>;

export type SalesHomeContractGroup = keyof typeof contractHomeStatusFilters;

export type SalesHomeContractCounts = Readonly<
  Record<SalesHomeContractGroup, { mine: number; team: number }>
>;

/**
 * Contract work for one reader, in one query. "Mine" is what the reader
 * recorded or prepared; an approval is the reader's when someone else
 * prepared it, because no one decides their own.
 */
export async function countSalesHomeContracts(
  db: RuntimeDatabase,
  input: { viewerId: string; requestId?: string },
): Promise<SalesHomeContractCounts> {
  const [row] = await withInternalTransaction(
    db,
    input.requestId ?? `sales-home:${randomUUID()}`,
    (tx) =>
      tx.execute<Record<string, number | string>>(sql`
        with work as (
          select c.created_by_id = ${input.viewerId}::uuid as mine,
            c.status = 'out_for_signature' as out_for_signature,
            coalesce(${contractAwaitingApproval}, false) as awaiting_approval,
            coalesce(s.preparer_id = ${input.viewerId}::uuid, false)
              as prepared_by_viewer,
            coalesce(${contractNeedsAttention}, false) as needs_attention
          from public.commerce_contracts c
          left join public.commerce_contract_signing s
            on s.contract_id = c.id
        )
        select
          count(*) filter (where awaiting_approval and not prepared_by_viewer)
            as approval_mine,
          count(*) filter (where awaiting_approval) as approval_team,
          count(*) filter (where needs_attention and mine) as attention_mine,
          count(*) filter (where needs_attention) as attention_team,
          count(*) filter (where out_for_signature and mine) as out_mine,
          count(*) filter (where out_for_signature) as out_team
        from work`),
  );
  const tally = (key: string) => Number(row?.[key] ?? 0);
  return {
    awaitingApproval: {
      mine: tally("approval_mine"),
      team: tally("approval_team"),
    },
    needsAttention: {
      mine: tally("attention_mine"),
      team: tally("attention_team"),
    },
    outForSignature: { mine: tally("out_mine"), team: tally("out_team") },
  };
}
