import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./styles.css", import.meta.url), {
  encoding: "utf8",
}).replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector contains `fragment`. */
function rulesFor(fragment: string): string[] {
  const rules: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stylesheet.matchAll(pattern))
    if (match[1]?.includes(fragment)) rules.push(match[2] ?? "");
  return rules;
}

describe("typesetting for hyphenating languages", () => {
  /**
   * `hyphens: auto` on table cells for de, fr, es and pt split identifiers
   * like words ("PROCESSING_ATTEM-PTS_EXHAUSTED", "invoice.-payment_-failed").
   * Anything marked as not language keeps its characters.
   */
  it("never hyphenates code or identifier text", () => {
    const identifierRules = rulesFor('[translate="no"]');
    expect(identifierRules.length).toBeGreaterThan(0);
    expect(identifierRules.join(";")).toMatch(/hyphens:\s*manual/u);
    for (const selector of ["code", "bdi", "[data-identifier]"])
      expect(
        stylesheet.match(/:is\(code, kbd, samp, pre, bdi[^)]*\)/u)?.[0],
      ).toContain(selector);
  });
});
