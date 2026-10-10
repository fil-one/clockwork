import { describe, expect, it } from "vitest";
import {
  TemplateFieldSchema,
  TemplateLineItemsSchema,
  templateLineItemLimit,
  templateLineItemPricingLines,
} from "./contract-templates";

const row = {
  sku: "STORAGE-TB",
  region: "us-east",
  unit: "TB-month",
  quantity: "500",
  termMonths: 12,
  unitPriceMinor: "1500",
  minimumQuantity: "10",
  discountBps: 1000,
  extendedMinor: "8100000",
};
const table = { currency: "USD", rows: [row] };
const issue = (value: unknown) =>
  TemplateLineItemsSchema.safeParse(value).error?.issues[0]?.message;

describe("line-item fields", () => {
  it("declares a required table with a label and nothing else", () => {
    const field = {
      id: "order_lines",
      kind: "line_items",
      required: true,
      label: { en: "Order lines" },
    };
    expect(TemplateFieldSchema.safeParse(field).success).toBe(true);
    for (const change of [
      { required: false },
      { maxLength: 80 },
      {
        options: [
          { value: "a", label: { en: "A" } },
          { value: "b", label: { en: "B" } },
        ],
      },
    ])
      expect(
        TemplateFieldSchema.safeParse({ ...field, ...change }).success,
      ).toBe(false);
  });

  it("accepts rows in one currency, filling description, region and minimum", () => {
    const parsed = TemplateLineItemsSchema.parse({
      ...table,
      rows: [{ ...row, region: undefined, minimumQuantity: undefined }],
    });
    expect(parsed.rows[0]).toMatchObject({
      description: "",
      region: "",
      minimumQuantity: "0",
    });
    expect(templateLineItemPricingLines(parsed)[0]).toEqual({
      unitPrice: { currency: "USD", minor: "1500" },
      minimumQuantity: "0",
      quantity: "500",
      termMonths: 12,
      discountBps: 1000,
    });
  });

  it("holds at most twenty rows and at least one", () => {
    expect(templateLineItemLimit).toBe(20);
    expect(issue({ ...table, rows: [] })).toBe("required");
    expect(
      issue({ ...table, rows: Array.from({ length: 21 }, () => row) }),
    ).toBe("too_big");
    expect(
      TemplateLineItemsSchema.safeParse({
        ...table,
        rows: Array.from({ length: 20 }, () => row),
      }).success,
    ).toBe(true);
  });

  it("follows the pricing scenario entry rules", () => {
    for (const change of [
      { quantity: "0" },
      { quantity: "1.1234567" },
      { termMonths: 0 },
      { termMonths: 121 },
      { discountBps: 10_001 },
      { unitPriceMinor: "-1" },
      { unitPriceMinor: "12.5" },
      { extendedMinor: "01" },
      { scenarioLine: 20 },
    ])
      expect(
        TemplateLineItemsSchema.safeParse({
          ...table,
          rows: [{ ...row, ...change }],
        }).success,
      ).toBe(false);
    expect(
      TemplateLineItemsSchema.safeParse({ ...table, currency: "JPY" }).success,
    ).toBe(false);
  });

  it("refuses unknown row and table keys", () => {
    expect(
      TemplateLineItemsSchema.safeParse({
        ...table,
        rows: [{ ...row, currency: "EUR" }],
      }).success,
    ).toBe(false);
    expect(
      TemplateLineItemsSchema.safeParse({
        ...table,
        scenarioId: "019a44ac-0000-7000-8000-00000000ab01",
      }).success,
    ).toBe(false);
  });

  it("links a table to the scenario it was imported from, as it stood then", () => {
    const scenario = {
      id: "019a44ac-0000-7000-8000-00000000ab01",
      name: "Acme Q4",
      version: 2,
      asOf: "2026-10-09",
    };
    expect(
      TemplateLineItemsSchema.safeParse({
        ...table,
        scenario,
        rows: [{ ...row, scenarioLine: 0 }],
      }).success,
    ).toBe(true);
    for (const change of [
      { version: 0 },
      { asOf: "October 9" },
      { name: "" },
      { id: "acme" },
    ])
      expect(
        TemplateLineItemsSchema.safeParse({
          ...table,
          scenario: { ...scenario, ...change },
        }).success,
      ).toBe(false);
  });

  it("refuses text the table cannot print or that could form a tag", () => {
    for (const sku of ["{{signature:1:y}}", "[[x]]", "<b>", "株式会社", "a\nb"])
      expect(issue({ ...table, rows: [{ ...row, sku }] })).toBe("characters");
    // Invisible format characters: a right-to-left override that would
    // print "STORAGE-TB" reversed, a zero-width space, a soft hyphen and the
    // Unicode line and paragraph separators.
    for (const sku of [
      "STORAGE\u202e-TB",
      "STORAGE\u200b-TB",
      "STORAGE\u00ad-TB",
      "STORAGE\u2028-TB",
      "STORAGE\u2029-TB",
    ])
      expect(issue({ ...table, rows: [{ ...row, sku }] })).toBe("characters");
    expect(
      TemplateLineItemsSchema.safeParse({
        ...table,
        rows: [{ ...row, description: "Łódź, Nguyễn" }],
      }).success,
    ).toBe(true);
  });
});
