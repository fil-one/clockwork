import type { ReactNode } from "react";

export interface TableProps {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}
export function Table({ caption, headers, rows }: TableProps) {
  return (
    <div className="cw-table-wrap">
      <table className="cw-table">
        <caption
          style={{ padding: "1rem", textAlign: "left", fontWeight: 700 }}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th scope="col" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th scope="row" key={cellIndex}>
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
