import type { ReactNode } from "react";

export type TableSortDirection = "ascending" | "descending";

/**
 * What a sortable column tells assistive technology, and the control that
 * changes the ordering.
 *
 * `aria-sort` is only meaningful on a header the reader can actually act on,
 * so this is per column and optional: a column with no entry keeps a plain
 * header and no `aria-sort` at all, which is what the attribute's own
 * specification asks for. A column that is sortable but is not the current
 * ordering reports `none`; exactly one column in a table should report
 * `ascending` or `descending`.
 *
 * `control` replaces the plain header label rather than sitting beside it, so
 * the accessible name of the control *is* the column name. It is supplied by
 * the caller because what changes the ordering differs by surface -- a link
 * carrying URL state on a server-rendered collection, a button on a client one
 * -- and this component must not reach for a router.
 */
export interface TableColumnSort {
  /** `null` when the column is sortable but is not the active ordering. */
  direction: TableSortDirection | null;
  /** Names the column and says what activating it will do. */
  control: ReactNode;
}

export interface TableProps {
  caption: ReactNode;
  captionDescription?: ReactNode;
  /**
   * Keeps the caption for assistive technology but removes it from the visual
   * flow, for tables that already sit under a heading which names them.
   */
  captionHidden?: boolean;
  headers: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  rowKeys?: readonly string[];
  numericColumns?: readonly number[];
  /**
   * Index-aligned with `headers`. Absent, `null` or `undefined` entries leave
   * that column exactly as it renders today.
   */
  columnSort?: readonly (TableColumnSort | null | undefined)[];
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  footer?: readonly ReactNode[];
  emptyState?: ReactNode;
  className?: string;
}
export function Table({
  caption,
  captionDescription,
  captionHidden = false,
  headers,
  rows,
  rowKeys,
  numericColumns = [],
  columnSort,
  density = "comfortable",
  stickyHeader = false,
  footer,
  emptyState,
  className = "",
}: TableProps) {
  const isNumeric = (index: number) => numericColumns.includes(index);
  return (
    <div
      className={`cw-table-wrap cw-table-wrap--${density} ${stickyHeader ? "cw-table-wrap--sticky" : ""} ${className}`.trim()}
      // The wrapper scrolls horizontally when the table outgrows it, so it has
      // to be reachable by keyboard alone. Without this a keyboard user cannot
      // read the columns that overflow.
      tabIndex={0}
    >
      <table className="cw-table">
        <caption className={captionHidden ? "cw-sr-only" : undefined}>
          <strong>{caption}</strong>
          {captionDescription ? <span>{captionDescription}</span> : null}
        </caption>
        <thead>
          <tr>
            {headers.map((header, index) => {
              const sort = columnSort?.[index];
              return (
                <th
                  scope="col"
                  aria-sort={sort ? (sort.direction ?? "none") : undefined}
                  className={isNumeric(index) ? "cw-table__numeric" : undefined}
                  key={index}
                >
                  {sort ? sort.control : header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowKeys?.[rowIndex] ?? rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th
                    scope="row"
                    className={
                      isNumeric(cellIndex) ? "cw-table__numeric" : undefined
                    }
                    key={cellIndex}
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    className={
                      isNumeric(cellIndex) ? "cw-table__numeric" : undefined
                    }
                    key={cellIndex}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
          {rows.length === 0 && emptyState ? (
            <tr>
              <td className="cw-table__empty" colSpan={headers.length}>
                {emptyState}
              </td>
            </tr>
          ) : null}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              {footer.map((cell, index) =>
                index === 0 ? (
                  <th scope="row" key={index}>
                    {cell}
                  </th>
                ) : (
                  <td
                    className={
                      isNumeric(index) ? "cw-table__numeric" : undefined
                    }
                    key={index}
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
