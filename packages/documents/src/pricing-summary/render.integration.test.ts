import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { PricingScenarioLine } from "@clockwork/contracts";
import {
  indicativePartnerNotice,
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
  productNames: { "STORAGE-TB": "Storage", "ARCHIVE-TB": "Archive storage" },
  regionNames: { "us-east": "US East (N. Virginia)" },
  lines: [
    line({ entered: { quantity: "0.5", unit: "PB" } }),
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
    "Storage US East (N. Virginia)",
    // An unnamed code prints as it is.
    "EGRESS-TB US East",
    "Archive storage eu-west",
    "$15.00 / TB-month",
    "0.5 PB = 500 TB",
    "1,250.5 TB",
    "12.5%",
    // 6,750.00 + 4,376.75 + 300.00 a month; the first year is 81,000 +
    // 52,521 + the one-month line's 300.00.
    "Per month $11,426.75",
    "Year 1 $133,821.00",
    // 13.50 x 500 x 12 + 3.50 x 1,250.5 x 36 + 15.00 x 20 = 238,863.00.
    "Subtotal at list price $270,372.00",
    "Discounts -$31,509.00",
    "Term total (USD) $238,863.00",
    "Prices are per decimal terabyte (TB) per month: 1 TB is 1,000 GB.",
    "List prices are as of October 10, 2026 and can change.",
    "Ref 019a44ac · 1 / 1",
  ])
    expect(text).toContain(expected);
  expect(text).toContain(indicativePricingSummaryNotice);
  expect(text).not.toContain("Partner");
  // A line here prices egress, so the summary does not call it free.
  expect(text).not.toContain("No egress fees");
}, 30_000);

const referral = {
  scenarioId: "019a44ac-0000-7000-8000-00000000ab01",
  company: "Meridian Data Vaults",
  asOf: "2026-10-10",
  productNames: { "STORAGE-TB": "Storage" },
  lines: [
    line({
      unitPrice: { currency: "USD", minor: "599" },
      minimumQuantity: "1",
      quantity: "11258.99906842624",
      entered: { quantity: "10", unit: "PiB" },
      termMonths: 36,
      discountBps: 0,
    }),
  ],
  partnerEconomics: {
    model: "referral",
    partnerName: "Copperline Partners",
    commissionBps: 3000,
    steps: [
      { fromMonth: 13, commissionBps: 2000 },
      { fromMonth: 25, commissionBps: 1000 },
    ],
  },
} satisfies IndicativePricingSummaryInput;

it("adds the partner's earnings for a partner and never Fil One's net", async () => {
  const [a, b] = await Promise.all([
    renderIndicativePricingSummary({ ...referral, audience: "partner" }),
    renderIndicativePricingSummary({ ...referral, audience: "partner" }),
  ]);
  expect(a.sha256).toBe(b.sha256);
  const { text } = await extract({ ...referral, audience: "partner" });
  for (const expected of [
    "Partner Copperline Partners",
    "10 PiB = 11,258.99906842624 TB",
    "Per month $67,441.40",
    "Year 1 $809,296.85",
    "No egress fees: reading and downloading stored data is free.",
    "Term total (USD) $2,427,890.56",
    "Partner economics",
    "Model Referral",
    "Commission 30% from month 1; 20% from month 13; 10% from month 25",
    "PER TB-MONTH",
    // 67,441.40 a month at 30%, 20% and 10%; $5.99 per TB at each rate.
    "Months 1-12 at 30%, per month $20,232.42 $1.80",
    "Months 13-24 at 20%, per month $13,488.28 $1.20",
    "Months 25-36 at 10%, per month $6,744.14 $0.60",
    "Year 1 $242,789.06",
    "Year 2 $161,859.37",
    "Year 3 $80,929.68",
    "Term, 36 months $485,578.11",
    indicativePartnerNotice,
  ])
    expect(text).toContain(expected);
  // Fil One keeps 2,427,890.56 - 485,578.11 = 1,942,312.45; it never prints.
  expect(text).not.toContain("1,942,312.45");
  expect(text).not.toMatch(/net/iu);
}, 30_000);

it("prints a resale partner's prices and margin, and no partner figures for a customer", async () => {
  const resale = {
    ...referral,
    partnerEconomics: {
      model: "resale" as const,
      customerPriceMinor: "650",
      marginBps: 3200,
    },
  };
  const partner = await extract({ ...resale, audience: "partner" });
  for (const expected of [
    "Model Resale",
    "Customer price $6.50 / TB-month",
    "Partner buy price $4.42 / TB-month",
    "Partner margin $2.08 / TB-month (32%)",
  ])
    expect(partner.text).toContain(expected);
  const customer = await extract({ ...resale, audience: "customer" });
  expect(customer.text).not.toContain("Partner");
  expect(customer.text).not.toContain("$4.42");
  expect(customer.text).not.toContain(indicativePartnerNotice);
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

it("runs a long partner schedule onto another page and leaves out steps past the term", async () => {
  const steps = Array.from({ length: 11 }, (_, index) => ({
    fromMonth: 10 * (index + 1) + 1,
    commissionBps: 3000 - index * 200,
  }));
  const lines = Array.from({ length: 11 }, (_, index) =>
    line({ quantity: "100", termMonths: 10 * (index + 1) - 3 }),
  );
  const { pdf, text } = await extract({
    ...referral,
    lines,
    audience: "partner",
    partnerEconomics: { model: "referral", commissionBps: 3000, steps },
  });
  expect(pdf.pages).toBeGreaterThan(1);
  for (let page = 1; page <= pdf.pages; page++)
    expect(text).toContain(`Ref 019a44ac · ${page} / ${pdf.pages}`);
  expect(text).toContain("Term, 107 months");
  expect(text).toContain("Year 9, months 97-107");
  // The longest term is 107 months, so the step from month 111 never prints.
  expect(text).not.toContain("from month 111");
  expect(text).toContain("from month 101");
}, 30_000);

it("prints no partner figures when lines are in different units", async () => {
  const { text } = await extract({
    ...referral,
    audience: "partner",
    lines: [
      ...referral.lines,
      line({ unit: "GB-month", quantity: "1000", termMonths: 36 }),
    ],
  });
  expect(text).not.toContain("Partner economics");
  expect(text).not.toContain(indicativePartnerNotice);
}, 30_000);
