import "server-only";

import {
  countSalesHomeMndas,
  salesHomeMndaGroups,
  type SalesHomeMndaCounts,
  type SalesHomeMndaGroup,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
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

/**
 * The guided demo has no MNDA register to open, so it shows a fixed, plainly
 * illustrative tally and no links.
 */
const demoCounts: SalesHomeMndaCounts = {
  mine: { waitingPartner: 2, waitingFilOne: 1, completed: 3, drafts: 1 },
  team: { waitingPartner: 4, waitingFilOne: 2, completed: 7, drafts: 2 },
};

export function mndaHomeRows(
  counts: SalesHomeMndaCounts,
  linked: boolean,
): SalesHomeRow[] {
  return rows.map(({ group, title, hint, showTeam }) => {
    const states = salesHomeMndaGroups[group];
    return {
      id: `mnda-${group}`,
      title,
      hint,
      mine: counts.mine[group],
      ...(showTeam ? { team: counts.team[group] } : {}),
      ...(linked
        ? {
            href: mndaRegisterHref(states, true),
            ...(showTeam ? { teamHref: mndaRegisterHref(states, false) } : {}),
          }
        : {}),
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
    if (!context.providerBacked) return mndaHomeRows(demoCounts, false);
    const database = getOptionalServiceDatabase();
    // i18n-exempt: thrown to the home loader, which shows its own unavailable state; never rendered
    if (!database) throw new Error("SALES_HOME_DATABASE_UNAVAILABLE");
    const counts = await countSalesHomeMndas(database, {
      ownerId: context.userId,
      completedSince: new Date(
        context.now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
    return mndaHomeRows(counts, true);
  },
};
