import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Table } from "./table";

const rows = [["Q-1", "Open"]];

/**
 * `aria-sort` did not exist anywhere in this repository, in `packages/ui` or in
 * `apps/web`, so no collection table announced its ordering or offered a way to
 * change it from the header row. Every assertion here fails against the
 * component as it was: it accepted no sort metadata at all.
 */
describe("table column sorting", () => {
  it("announces the ordering on the column the rows are ordered by", () => {
    const html = renderToStaticMarkup(
      <Table
        caption="Quotes"
        columnSort={[
          { direction: "descending", control: <a href="/q?sort=a">Record</a> },
          { direction: null, control: <a href="/q?sort=s">Status</a> },
        ]}
        headers={["Record", "Status"]}
        rows={rows}
      />,
    );

    expect(html).toContain('aria-sort="descending"');
    // Sortable but not active. Distinct from a column with no sort at all,
    // which must carry no `aria-sort` for the attribute to mean anything.
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('href="/q?sort=a"');
  });

  it("leaves a column with no ordering entirely unannotated", () => {
    const html = renderToStaticMarkup(
      <Table
        caption="Quotes"
        columnSort={[
          { direction: "ascending", control: <a href="/q?sort=a">Record</a> },
          null,
        ]}
        headers={["Record", "Status"]}
        rows={rows}
      />,
    );

    const sorted = [...html.matchAll(/aria-sort="([a-z]+)"/gu)].map(
      (match) => match[1],
    );
    expect(sorted).toEqual(["ascending"]);
    // The unsorted column keeps its plain header text.
    expect(html).toContain('<th scope="col">Status</th>');
  });

  it("changes nothing for a table that declares no sorting", () => {
    const html = renderToStaticMarkup(
      <Table caption="Quotes" headers={["Record", "Status"]} rows={rows} />,
    );

    expect(html).not.toContain("aria-sort");
    expect(html).toContain('<th scope="col">Record</th>');
  });
});
