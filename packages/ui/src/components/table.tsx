import type { ReactNode } from "react";

export interface TableProps {
  caption: ReactNode;
  captionDescription?: ReactNode;
  headers: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  rowKeys?: readonly string[];
  numericColumns?: readonly number[];
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  footer?: readonly ReactNode[];
  emptyState?: ReactNode;
  className?: string;
}
export function Table({
  caption,
  captionDescription,
  headers,
  rows,
  rowKeys,
  numericColumns = [],
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
    >
      <table className="cw-table">
        <caption>
          <strong>{caption}</strong>
          {captionDescription ? <span>{captionDescription}</span> : null}
        </caption>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                scope="col"
                className={isNumeric(index) ? "cw-table__numeric" : undefined}
                key={index}
              >
                {header}
              </th>
            ))}
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
