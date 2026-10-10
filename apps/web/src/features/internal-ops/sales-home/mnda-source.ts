import "server-only";

import {
  countSalesHomeMndas,
  salesHomeMndaGroups,
  type SalesHomeMndaCounts,
  type SalesHomeMndaGroup,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoMndaHomeCounts } from "../mnda/demo-register";
import type { MessageId } from "@/src/i18n";

import {
  mndaRegisterHref,
  type SalesHomeContext,
  type SalesHomeRow,
  type SalesHomeSource,
} from "./model";

const RECENT_DAYS = 30;

/** Rows in the order a seller acts on them: what waits on someone first. */
const rows: readonly {
  group: SalesHomeMndaGroup;
  title: MessageId;
  hint: MessageId;
  showTeam: boolean;
}[] = [
  {
    group: "waitingPartner",
    title: "operations.sales.home.card.waitingPartner.title",
    hint: "operations.sales.home.card.waitingPartner.hint",
    showTeam: true,
  },
  {
    group: "waitingFilOne",
    title: "operations.sales.home.card.waitingFilOne.title",
    hint: "operations.sales.home.card.waitingFilOne.hint",
    showTeam: true,
  },
  {
    group: "completed",
    title: "operations.sales.home.card.completed.title",
    hint: "operations.sales.home.card.completed.hint",
    showTeam: true,
  },
  {
    group: "drafts",
    title: "operations.sales.home.card.drafts.title",
    hint: "operations.sales.home.card.drafts.hint",
    showTeam: false,
  },
];

export function mndaHomeRows(counts: SalesHomeMndaCounts): SalesHomeRow[] {
  return rows.map(({ group, title, hint, showTeam }) => {
    const states = salesHomeMndaGroups[group];
    return {
      id: `mnda-${group}`,
      title,
      hint,
      mine: counts.mine[group],
      ...(showTeam ? { team: counts.team[group] } : {}),
      href: mndaRegisterHref(states, true),
      ...(showTeam ? { teamHref: mndaRegisterHref(states, false) } : {}),
    };
  });
}

export const mndaHomeSource: SalesHomeSource = {
  id: "mndas",
  heading: "operations.sales.home.cards",
  requiredPermission: "mnda:send",
  unavailable: {
    message: "operations.sales.home.unavailable",
    href: "/internal/mndas",
    action: "operations.sales.home.openRegister",
  },
  async load(context: SalesHomeContext) {
    const completedSince = new Date(
      context.now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000,
    );
    // The guided demo counts its fictional register, so each row opens the
    // same filtered list it counted.
    if (!context.providerBacked)
      return mndaHomeRows(
        demoMndaHomeCounts(
          { id: context.userId, name: "", email: "" },
          context.now,
          completedSince,
        ),
      );
    const database = getOptionalServiceDatabase();
    // i18n-exempt: thrown to the home loader, which shows its own unavailable state; never rendered
    if (!database) throw new Error("SALES_HOME_DATABASE_UNAVAILABLE");
    const counts = await countSalesHomeMndas(database, {
      ownerId: context.userId,
      completedSince,
    });
    return mndaHomeRows(counts);
  },
};
