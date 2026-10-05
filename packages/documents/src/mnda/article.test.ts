import { expect, it } from "vitest";
import { mndaEntityArticle } from "./article";
import { formatMndaEffectiveDate, mndaBreakable } from "./render";

it.each([
  ["Ontario corporation", "an"],
  ["Illinois limited liability company", "an"],
  ["Oregon nonprofit corporation", "an"],
  ["Alberta corporation", "an"],
  ["English private limited company", "an"],
  ["unlimited company", "an"],
  ["Unincorporated association", "an"],
  ["Uzbek joint-stock company", "an"],
  ["Österreichische GmbH", "an"],
  ["Île-de-France société", "an"],
  ["LLC organized in Wyoming", "an"],
  ["S corporation", "an"],
  ["S.A. organized in Spain", "an"],
  ["SRL organized in Italy", "an"],
  ["EU company", "an"],
  ["Delaware corporation", "a"],
  ["Utah limited liability company", "a"],
  ["United Kingdom private limited company", "a"],
  ["Uruguayan sociedad anónima", "a"],
  ["UK private limited company", "a"],
  ["U.S. corporation", "a"],
  ["European company (SE)", "a"],
  ["one-member limited liability company", "a"],
  ["BV organized in the Netherlands", "a"],
  ["C corporation", "a"],
  ["New York corporation", "a"],
  ["", "a"],
] as const)("%s takes %s", (value, article) => {
  expect(mndaEntityArticle(value)).toBe(article);
});

it("formats the effective date as written in a US agreement", () => {
  expect(formatMndaEffectiveDate("2026-10-02")).toBe("October 2, 2026");
  expect(formatMndaEffectiveDate("2027-01-31")).toBe("January 31, 2027");
  expect(() => formatMndaEffectiveDate("2026-13-02")).toThrow("DATE");
});

it("wraps only words wider than their column, at email and URL separators", () => {
  expect(mndaBreakable("legal@example.com", 196)).toBe("legal@example.com");
  const sentence = "Executive Vice President, General Counsel and Secretary";
  expect(mndaBreakable(sentence, 196)).toBe(sentence);
  const email =
    "legal.notices.and.contracts.department@very-long-subsidiary-name.example.com";
  const lines = mndaBreakable(email, 196).split("\n");
  expect(lines.join("")).toBe(email);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(0, -1)) expect(line).toMatch(/[@./_]$/);
  // A hyphen ends a line only when nothing else fits.
  const domain =
    "legal@notices-for-contracts.example-holdings-international-group.com";
  expect(mndaBreakable(domain, 196).split("\n")).toEqual([
    "legal@notices-for-contracts.",
    "example-holdings-international-group.com",
  ]);
  const hyphenated =
    "a".repeat(20) + "-" + "b".repeat(20) + "-" + "c".repeat(20);
  const fallback = mndaBreakable(hyphenated, 196).split("\n");
  expect(fallback.join("")).toBe(hyphenated);
  expect(fallback[0]).toMatch(/-$/);
  // A body line holds the same address unbroken.
  expect(mndaBreakable(email, 516)).toBe(email);
  const word = "W".repeat(60);
  const pieces = mndaBreakable(word, 196).split("\n");
  expect(pieces.join("")).toBe(word);
  expect(Math.max(...pieces.map((p) => p.length))).toBeLessThan(25);
});
