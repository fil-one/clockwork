import "server-only";

import {
  PartnerListQuerySchema,
  type PartnerDueFilter,
} from "@clockwork/contracts";
import {
  countPartnerNextSteps,
  type PartnerNextStepCounts,
} from "@clockwork/db";
import { contractToday } from "@clockwork/domain/contract-terms";

import { getRequestCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { contractStaff } from "../contracts/server";
import { demoPartnerRegister } from "../partners/demo-register";
import { partnerListHref } from "../partners/model";
import type { SalesHomeContext, SalesHomeRow, SalesHomeSource } from "./model";

/**
 * Each count opens the partner list filtered to exactly the rows counted.
 * With no partner step due anywhere on the team the section is left out.
 */
export function partnerHomeRows(counts: PartnerNextStepCounts): SalesHomeRow[] {
  if (counts.dueThisWeek.team === 0 && counts.overdue.team === 0) return [];
  const row = (
    id: string,
    due: PartnerDueFilter,
    count: { mine: number; team: number },
    copy: Pick<SalesHomeRow, "title" | "hint">,
  ): SalesHomeRow => ({
    id,
    ...copy,
    mine: count.mine,
    team: count.team,
    href: partnerListHref({ due, mine: true }),
    teamHref: partnerListHref({ due }),
  });
  return [
    {
      ...row("partners-overdue", "overdue", counts.overdue, {
        title: "operations.sales.home.partners.overdue.title",
        hint: "operations.sales.home.partners.overdue.hint",
      }),
      attention: true,
    },
    row("partners-week", "week", counts.dueThisWeek, {
      title: "operations.sales.home.partners.week.title",
      hint: "operations.sales.home.partners.week.hint",
    }),
  ];
}

/** The demo's fictional partners, counted through the list's own filters. */
async function demoCounts(
  context: SalesHomeContext,
): Promise<PartnerNextStepCounts> {
  const register = demoPartnerRegister(context.now, {
    id: context.userId,
    name: "",
  });
  const scope = { viewerId: context.userId, today: contractToday(context.now) };
  const count = async (due: PartnerDueFilter, mine: boolean) =>
    (
      await register.list(
        PartnerListQuerySchema.parse({ due, ...(mine ? { mine: "1" } : {}) }),
        scope,
      )
    ).rows.length;
  return {
    overdue: {
      mine: await count("overdue", true),
      team: await count("overdue", false),
    },
    dueThisWeek: {
      mine: await count("week", true),
      team: await count("week", false),
    },
  };
}

export const partnerHomeSource: SalesHomeSource = {
  id: "partners",
  heading: "operations.sales.home.partners.heading",
  requiredPermission: "sales:read",
  unavailable: {
    message: "operations.sales.home.partners.unavailable",
    href: "/internal/partners",
    action: "operations.sales.home.partners.open",
  },
  async load(context: SalesHomeContext) {
    if (context.demo) return partnerHomeRows(await demoCounts(context));
    // The same check as the partner pages: a staff session with a second factor.
    await contractStaff("sales:read", getRequestCommerceSession);
    const database = getOptionalServiceDatabase();
    // i18n-exempt: thrown to the home loader, which shows its own unavailable state; never rendered
    if (!database) throw new Error("SALES_HOME_DATABASE_UNAVAILABLE");
    return partnerHomeRows(
      await countPartnerNextSteps(database, {
        viewerId: context.userId,
        today: contractToday(context.now),
      }),
    );
  },
};
