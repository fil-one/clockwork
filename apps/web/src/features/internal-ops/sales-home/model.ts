import type { Permission } from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";

/**
 * One line of work on the staff home page: a count of the reader's own items,
 * optionally the team's, and where to open them.
 */
export interface SalesHomeRow {
  id: string;
  title: MessageId;
  hint: MessageId;
  mine: number;
  team?: number;
  /** Something is broken and the reader must act: shown in the danger tone
   * while the reader has any. */
  attention?: boolean;
  /** The reader's own items, filtered. Absent where the list cannot open. */
  href?: string;
  /** Everyone's items, filtered the same way. */
  teamHref?: string;
}

export interface SalesHomeContext {
  userId: string;
  permissions: readonly Permission[];
  /** The guided demo: sources read their fictional registers. */
  demo: boolean;
  now: Date;
}

/**
 * A kind of work the home page shows. Adding one (renewal notices due, for
 * example) is one entry in `salesHomeSources`: the page groups its rows under
 * the heading and hides the section from readers without the permission.
 */
export interface SalesHomeSource {
  id: string;
  heading: MessageId;
  requiredPermission: Permission;
  /** What the reader sees, and where they can go instead, when the read fails. */
  unavailable: { message: MessageId; href?: string; action?: MessageId };
  load(context: SalesHomeContext): Promise<readonly SalesHomeRow[]>;
}

/** A source as loaded for one reader. `rows` is null when the read failed. */
export interface SalesHomeSection {
  id: string;
  heading: MessageId;
  unavailable: SalesHomeSource["unavailable"];
  rows: readonly SalesHomeRow[] | null;
}

/** The MNDA register, filtered the way the home page counted. */
export function mndaRegisterHref(
  states: readonly string[],
  mine: boolean,
): string {
  const query = new URLSearchParams({ status: states.join(",") });
  if (mine) query.set("mine", "1");
  return `/internal/mndas?${query.toString().replaceAll("%2C", ",")}`;
}
