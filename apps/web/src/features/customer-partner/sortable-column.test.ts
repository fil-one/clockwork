import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import {
  columnSortDirection,
  columnSortLabel,
  nextColumnSort,
  type SortableColumn,
} from "./sortable-column";

const title: SortableColumn<string> = {
  ascending: "title-asc",
  descending: "title-desc",
};
const value: SortableColumn<string> = {
  ascending: "value-asc",
  descending: "value-desc",
  first: "descending",
};

describe("sortable column state", () => {
  it("reports a direction only for the column the rows are ordered by", () => {
    expect(columnSortDirection(title, "title-asc")).toBe("ascending");
    expect(columnSortDirection(title, "title-desc")).toBe("descending");
    // Sortable, but not the active ordering. This is what becomes
    // `aria-sort="none"`, and it is the case that must not be confused with
    // "not sortable at all", which carries no `aria-sort`.
    expect(columnSortDirection(title, "value-desc")).toBeNull();
  });

  it("flips the active column and never leaves it stuck one way", () => {
    expect(nextColumnSort(title, "title-asc")).toBe("title-desc");
    expect(nextColumnSort(title, "title-desc")).toBe("title-asc");
    expect(nextColumnSort(value, "value-desc")).toBe("value-asc");
    expect(nextColumnSort(value, "value-asc")).toBe("value-desc");
  });

  it("gives an inactive column its own first direction, not the previous column's", () => {
    // Coming from a descending title sort, the value column still opens
    // descending -- its own natural direction -- and the title column still
    // opens ascending, whatever the value column was doing.
    expect(nextColumnSort(value, "title-desc")).toBe("value-desc");
    expect(nextColumnSort(title, "value-desc")).toBe("title-asc");
  });

  it("names the column and what activating it will do", () => {
    // The control replaces the header label, so this string is the only thing
    // naming the column to anyone tabbing through the header row.
    const t = translatorFor("en");
    expect(columnSortLabel(title, "value-desc", "Record", t)).toBe(
      "Record. Sort ascending",
    );
    expect(columnSortLabel(title, "title-asc", "Record", t)).toBe(
      "Record, sorted ascending. Sort descending",
    );
    expect(columnSortLabel(title, "title-desc", "Record", t)).toBe(
      "Record, sorted descending. Sort ascending",
    );
    expect(columnSortLabel(value, "title-asc", "Value", t)).toBe(
      "Value. Sort descending",
    );
  });

  it("says it in the reader's language, with the column name kept whole", () => {
    expect(
      columnSortLabel(title, "title-asc", "Cliente final", translatorFor("pt")),
    ).toBe("Cliente final, em ordem crescente. Ordenar em ordem decrescente");
  });
});
