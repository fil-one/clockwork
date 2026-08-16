/**
 * The arithmetic behind a sortable column header, kept away from the three
 * surfaces that need it so they cannot drift.
 *
 * Every collection here already carried a sort in its URL and already applied
 * it to the *whole* filtered set before paginating -- `filterAndSortRecords`
 * then `slice`, in all three. What was missing was the affordance and the
 * announcement: the sort lived in a `<select>`, the column headers were inert
 * text, and no `<th>` carried `aria-sort`, so a screen-reader user was never
 * told which column the rows were ordered by or that they could change it.
 *
 * Sorting a page rather than the set is the failure this must not introduce.
 * It cannot here: the ordering is a URL parameter read by the surface, applied
 * before the page slice is taken, so the first page after a sort is the first
 * page of the whole ordering. Where a surface renders a *server* page instead
 * -- a top-N read -- the ordering has to travel to the server, and this helper
 * is not enough on its own.
 */
export type SortDirection = "ascending" | "descending";

/**
 * The two sort tokens a single column can put in the URL.
 *
 * Both directions are required. A column offering only one is a header that
 * cannot be un-sorted, and a reader who sorted by it has no way back to the
 * ordering they started from without editing the address bar.
 */
export interface SortableColumn<Token extends string> {
  ascending: Token;
  descending: Token;
  /**
   * Which direction the first activation chooses. Names read best ascending;
   * money, risk and recency read best descending, which is also the ordering
   * those columns already defaulted to.
   */
  first?: SortDirection;
}

/** `null` means "sortable, but not what the rows are ordered by right now". */
export function columnSortDirection<Token extends string>(
  column: SortableColumn<Token>,
  active: Token,
): SortDirection | null {
  if (active === column.ascending) return "ascending";
  if (active === column.descending) return "descending";
  return null;
}

/**
 * The token the header's control moves to.
 *
 * An active column flips. An inactive one takes its natural first direction,
 * never "whatever the previous column was doing", because carrying a
 * descending name sort over from a descending value sort is not what anyone
 * clicking a column name asked for.
 */
export function nextColumnSort<Token extends string>(
  column: SortableColumn<Token>,
  active: Token,
): Token {
  const direction = columnSortDirection(column, active);
  if (direction === "ascending") return column.descending;
  if (direction === "descending") return column.ascending;
  return (column.first ?? "ascending") === "descending"
    ? column.descending
    : column.ascending;
}

/**
 * The accessible name of the control.
 *
 * The column name has to be in it -- the control replaces the header label, so
 * this string is the only thing naming the column to a reader tabbing through
 * the header row -- and so does what activating it will do, because
 * `aria-sort` says what the state *is* and never what the control does.
 */
export function columnSortLabel<Token extends string>(
  column: SortableColumn<Token>,
  active: Token,
  name: string,
): string {
  const next = columnSortDirection(column, active);
  if (next === "ascending") return `${name}, sorted ascending. Sort descending`;
  if (next === "descending")
    return `${name}, sorted descending. Sort ascending`;
  return `${name}. Sort ${
    (column.first ?? "ascending") === "descending" ? "descending" : "ascending"
  }`;
}
