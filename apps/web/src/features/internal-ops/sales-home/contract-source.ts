import "server-only";

import {
  contractHomeStatusFilters,
  countSalesHomeContracts,
  type SalesHomeContractCounts,
} from "@clockwork/db";

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

/** The register has no "mine" filter, so only the team count links, to
 * exactly the rows it counted. */
export function contractHomeRows(
  counts: SalesHomeContractCounts,
  canApprove: boolean,
): SalesHomeRow[] {
  return rows
    .filter(({ group }) => canApprove || group !== "awaitingApproval")
    .map(({ group, title, hint }) => ({
      id: `contracts-${group}`,
      title,
      hint,
      mine: counts[group].mine,
      team: counts[group].team,
      teamHref: `/internal/contracts?status=${contractHomeStatusFilters[group]}`,
    }));
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
    // The guided demo has no contract register; the section stays hidden.
    if (!context.providerBacked) return [];
    // Every contract read passes the register's own check (second factor,
    // own session), not only the page's.
    await contractStaff("contract:read");
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
