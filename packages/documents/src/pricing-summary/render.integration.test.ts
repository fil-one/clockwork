import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { PricingScenarioLine } from "@clockwork/contracts";
import {
  indicativePricingSummaryNotice,
  renderIndicativePricingSummary,
  type IndicativePricingSummaryInput,
} from "./render";

const line = (
  overrides: Partial<Record<keyof PricingScenarioLine, unknown>> = {},
) =>
  ({
    bookId: "60000000-0000-4000-8000-000000000001",
    bookVersion: 3,
    rateId: "61000000-0000-4000-8000-000000000001",
    sku: "STORAGE-TB",
    region: "us-east",
    unit: "TB-month",
    unitPrice: { currency: "USD", minor: "1500" },
    minimumQuantity: "10.000000000000000000",
    quantity: "500",
    termMonths: 12,
    discountBps: 1000,
    ...overrides,
  }) as PricingScenarioLine;

const input: IndicativePricingSummaryInput = {
  scenarioId: "019a44ac-0000-7000-8000-00000000ab01",
  company: "Société Générale Nguyễn, Inc.",
  asOf: "2026-10-10",
  lines: [
    line(),
    line({
      sku: "ARCHIVE-TB",
      region: "eu-west",
      unitPrice: { currency: "USD", minor: "400" },
      quantity: "1250.5",
      termMonths: 36,
      discountBps: 1250,
    }),
    line({ sku: "EGRESS-TB", quantity: "20", termMonths: 1, discountBps: 0 }),
  ],
};

/** Renders and returns what Poppler reads, whitespace collapsed. */
async function extract(value: IndicativePricingSummaryInput) {
  const pdf = await renderIndicativePricingSummary(value);
  const dir = mkdtempSync(join(tmpdir(), "pricing-summary-"));
  try {
    const path = join(dir, "summary.pdf");
    writeFileSync(path, pdf.bytes);
    return {
      pdf,
      text: execFileSync("pdftotext", ["-raw", path, "-"], {
        encoding: "utf8",
      })
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .trim(),
      fonts: execFileSync("pdffonts", [path], { encoding: "utf8" }),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("prints list prices, entered discounts and recomputed totals deterministically", async () => {
  const [a, b] = await Promise.all([
    renderIndicativePricingSummary(input),
    renderIndicativePricingSummary(input),
  ]);
  expect(a.sha256).toBe(b.sha256);
  expect(a.pages).toBe(1);
  const { text } = await extract(input);
  // The text golden is independent of zlib, so it runs on any Node build.
  // `UPDATE_GOLDEN=1` rewrites it after a reviewed layout or copy change.
  const golden = new URL(
    "../__fixtures__/pricing-summary.golden.txt",
    import.meta.url,
  );
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, `${text}\n`);
  expect(text).toBe(readFileSync(golden, "utf8").trim());
  for (const expected of [
    "Indicative Pricing Summary",
    "Prepared for Société Générale Nguyễn, Inc.",
    "Prepared by FIL One LLC",
    "List prices as of October 10, 2026",
    "$15.00 / TB-month",
    "1,250.5 TB-month",
    "12.5%",
    // 13.50 x 500 x 12 + 3.50 x 1,250.5 x 36 + 15.00 x 20 = 238,863.00.
    "Subtotal at list price $270,372.00",
    "Discounts -$31,509.00",
    "Total (USD) $238,863.00",
    "Ref 019a44ac · 1 / 1",
  ])
    expect(text).toContain(expected);
  expect(text).toContain(indicativePricingSummaryNotice);
}, 30_000);

it("embeds every font", async () => {
  const { fonts } = await extract(input);
  const rows = fonts.split("\n").slice(2).filter(Boolean);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for (const row of rows) expect(row).toMatch(/ yes +yes +yes /);
}, 30_000);

it("runs to a second page with the notice on each", async () => {
  const lines = Array.from({ length: 20 }, (_, index) =>
    line({ sku: `SKU-${index + 1}`, region: "ap-southeast-2" }),
  );
  const { pdf, text } = await extract({ ...input, lines });
  expect(pdf.pages).toBeLessThanOrEqual(2);
  for (let page = 1; page <= pdf.pages; page++)
    expect(text).toContain(`Ref 019a44ac · ${page} / ${pdf.pages}`);
  expect(text.split(indicativePricingSummaryNotice)).toHaveLength(
    pdf.pages + 1,
  );
}, 30_000);

it("accepts saved list-price lines only and refuses what it cannot print", async () => {
  await expect(
    renderIndicativePricingSummary({
      ...input,
      lines: [{ ...line(), floorPrice: { currency: "USD", minor: "1111" } }],
    } as unknown as IndicativePricingSummaryInput),
  ).rejects.toThrow();
  await expect(
    renderIndicativePricingSummary({
      ...input,
      lines: [line(), line({ unitPrice: { currency: "EUR", minor: "1" } })],
    }),
  ).rejects.toThrow();
  await expect(
    renderIndicativePricingSummary({ ...input, company: "株式会社" }),
  ).rejects.toThrow("PRICING_SUMMARY_UNPRINTABLE");
});
