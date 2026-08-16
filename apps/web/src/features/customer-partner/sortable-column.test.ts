import { describe, expect, it } from "vitest";

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
    expect(columnSortLabel(title, "value-desc", "Record")).toBe(
      "Record. Sort ascending",
    );
    expect(columnSortLabel(title, "title-asc", "Record")).toBe(
      "Record, sorted ascending. Sort descending",
    );
    expect(columnSortLabel(title, "title-desc", "Record")).toBe(
      "Record, sorted descending. Sort ascending",
    );
    expect(columnSortLabel(value, "title-asc", "Value")).toBe(
      "Value. Sort descending",
    );
  });
});
