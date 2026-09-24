import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Vitest runs from apps/web.
const web = process.cwd();

function css(path: string): string {
  return readFileSync(join(web, path), "utf8").replace(
    /\/\*[\s\S]*?\*\//gu,
    "",
  );
}

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** The declarations of the last top-level rule with exactly this selector. */
function lastRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = [
    ...source.matchAll(
      new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "gu"),
    ),
  ];
  return matches.at(-1)?.[1] ?? "";
}

describe("filter rows", () => {
  /**
   * The collection and queue filters sat in fixed grid columns, which cut
   * every select off at the column's width in longer languages ("Todos los
   * es…", "SLA, riesgo, antigü…"). They are wrapping rows whose fields are as
   * wide as their widest option.
   */
  it.each([
    ["src/features/customer-partner/partner/partner.module.css", ".filters"],
    [
      "src/features/customer-partner/customer/customer-collection.module.css",
      ".filters",
    ],
    [
      "src/features/customer-partner/commercial/commercial.module.css",
      ".filters",
    ],
    [
      "src/features/internal-ops/queue-search/queue-search.module.css",
      ".filterGrid",
    ],
  ])("%s wraps its fields instead of fixing their width", (path, selector) => {
    const rule = lastRule(css(path), selector);
    expect(rule).toMatch(/display:\s*flex/u);
    expect(rule).toMatch(/flex-wrap:\s*wrap/u);
  });
});

describe("status chips in tables", () => {
  /** "Borrador" broke over two lines in the partner quotes table. */
  it("keeps a partner state chip on one line inside a table", () => {
    expect(
      lastRule(
        css("src/features/customer-partner/partner/partner.module.css"),
        ":where(td, th) .pill",
      ),
    ).toMatch(/white-space:\s*nowrap/u);
  });
});

describe("the demo persona pill", () => {
  /**
   * The closed pill was fixed to the bottom corner of the page and covered
   * whatever reached it (the migrations checkbox, an export button, the last
   * table column). On a desktop shell it is the navigation rail's footer.
   */
  it("sits in the navigation rail's footer on a desktop shell", () => {
    const source = css("src/features/shell/demo-persona-switcher.module.css");
    const desktop = source.slice(source.indexOf("@media (min-width: 64rem)"));
    expect(desktop).toMatch(
      /:global\(body\):has\(:global\(\.cw-shell__rail\)\) \.panel \{[^}]*width: var\(--cw-rail-width\)/u,
    );
  });
});

describe("letter case", () => {
  /**
   * `text-transform: capitalize` title-cases every word, which is English
   * typography: it printed "SLA Violado" in Spanish and capitalises German
   * verbs. Case belongs to the translated text.
   */
  it("never capitalises words with CSS", () => {
    const offenders = [
      join(web, "src"),
      join(web, "app"),
      join(web, "../../packages/ui/src"),
    ]
      .flatMap(stylesheets)
      .filter((path) =>
        /text-transform:\s*capitalize/u.test(readFileSync(path, "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
