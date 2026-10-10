import "server-only";

import {
  contractHomeStatusFilters,
  countSalesHomeContracts,
  type SalesHomeContractCounts,
} from "@clockwork/db";

import { getRequestCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import type { MessageId } from "@/src/i18n";

import { contractStaff } from "../contracts/server";
import type { SalesHomeContext, SalesHomeRow, SalesHomeSource } from "./model";

type Group = keyof SalesHomeContractCounts;

/** Rows in the order the reader acts on them: their decision first. */
const rows: readonly { group: Group; title: MessageId; hint: MessageId }[] = [
  {
    group: "awaitingApproval",
    title: "operations.sales.home.contracts.awaitingApproval.title",
    hint: "operations.sales.home.contracts.awaitingApproval.hint",
  },
  {
    group: "needsAttention",
    title: "operations.sales.home.contracts.needsAttention.title",
    hint: "operations.sales.home.contracts.needsAttention.hint",
  },
  {
    group: "outForSignature",
    title: "operations.sales.home.contracts.outForSignature.title",
    hint: "operations.sales.home.contracts.outForSignature.hint",
  },
];

/** Each count links to exactly the rows it counted. "Mine" opens the
 * register's "recorded by me" filter, except for approvals: there the reader's
 * count is what others prepared for them to decide, which no register filter
 * expresses, so only the team count links. */
export function contractHomeRows(
  counts: SalesHomeContractCounts,
  canApprove: boolean,
): SalesHomeRow[] {
  return rows
    .filter(({ group }) => canApprove || group !== "awaitingApproval")
    .map(({ group, title, hint }) => {
      const teamHref = `/internal/contracts?status=${contractHomeStatusFilters[group]}`;
      return {
        id: `contracts-${group}`,
        title,
        hint,
        mine: counts[group].mine,
        team: counts[group].team,
        ...(group === "awaitingApproval" ? {} : { href: `${teamHref}&mine=1` }),
        teamHref,
      };
    });
}

export const contractHomeSource: SalesHomeSource = {
  id: "contracts",
  heading: "operations.sales.home.contracts.heading",
  requiredPermission: "contract:read",
  unavailable: {
    message: "operations.sales.home.contracts.unavailable",
    href: "/internal/contracts",
    action: "operations.sales.home.contracts.openRegister",
  },
  async load(context: SalesHomeContext) {
    // The guided demo's register has no signing requests; the section stays
    // hidden.
    if (context.demo) return [];
    // Every contract read passes the register's own check (second factor,
    // staff session), not only the page's. It reuses the session the page
    // already read for this request.
    await contractStaff("contract:read", getRequestCommerceSession);
    const database = getOptionalServiceDatabase();
    // i18n-exempt: thrown to the home loader, which shows its own unavailable state; never rendered
    if (!database) throw new Error("SALES_HOME_DATABASE_UNAVAILABLE");
    const counts = await countSalesHomeContracts(database, {
      viewerId: context.userId,
    });
    return contractHomeRows(
      counts,
      context.permissions.includes("contract:approve"),
    );
  },
};
