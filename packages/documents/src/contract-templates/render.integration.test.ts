import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { TemplateLineItems } from "@clockwork/contracts";
import { fixtureContractTemplate } from "../__fixtures__/contract-template";
import type { PreparedTemplateInput } from "./definition";

const lines: TemplateLineItems = {
  currency: "USD",
  scenario: {
    id: "019a44ac-0000-7000-8000-00000000ab01",
    name: "Bluefin Q4",
    version: 2,
    asOf: "2026-10-04",
  },
  rows: [
    {
      sku: "STORAGE-TB",
      description: "Hot storage, three copies",
      region: "us-east",
      unit: "TB-month",
      quantity: "500",
      termMonths: 12,
      unitPriceMinor: "1500",
      minimumQuantity: "10",
      discountBps: 1000,
      extendedMinor: "8100000",
    },
    {
      sku: "ARCHIVE-TB",
      description: "",
      region: "eu-west",
      unit: "TB-month",
      quantity: "1250.5",
      termMonths: 36,
      unitPriceMinor: "400",
      minimumQuantity: "10",
      discountBps: 1250,
      extendedMinor: "15756300",
    },
    {
      sku: "ONBOARDING",
      description: "Onboarding services",
      region: "",
      unit: "engagement",
      quantity: "1",
      termMonths: 1,
      unitPriceMinor: "250000",
      minimumQuantity: "0",
      discountBps: 0,
      extendedMinor: "250000",
    },
  ],
};

const input: PreparedTemplateInput = {
  contractId: "019a44ac-0000-7000-8000-00000000c0de",
  counterpartyName: "Bluefin Data Co.",
  effectiveDate: "2026-10-05",
  values: {
    fixture_reference: "REF-7",
    fixture_tier: "beta",
    fixture_note: "",
    fixture_lines: lines,
  },
  signer: { name: "Alex Example", email: "alex@example.com", title: "CEO" },
  countersigner: {
    name: "James Kurz",
    email: "james@example.com",
    title: "CFO/CSO",
  },
};

function text(bytes: Uint8Array, mode: "-layout" | "-raw" = "-layout") {
  const dir = mkdtempSync(join(tmpdir(), "contract-template-"));
  try {
    writeFileSync(join(dir, "document.pdf"), bytes);
    return execFileSync("pdftotext", [mode, join(dir, "document.pdf"), "-"], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The input with its table's rows changed by `change`. */
function withRows(change: (rows: Record<string, unknown>[]) => void) {
  const changed = structuredClone(lines) as unknown as {
    rows: Record<string, unknown>[];
  };
  change(changed.rows);
  return {
    ...input,
    values: {
      ...input.values,
      fixture_lines: changed as unknown as TemplateLineItems,
    },
  };
}

it("renders resolved fields, both signers and four signing tags deterministically", async () => {
  const [a, b] = await Promise.all([
    fixtureContractTemplate.render(input),
    fixtureContractTemplate.render(input),
  ]);
  expect(a.sha256).toBe(b.sha256);
  expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
  expect(a.pages).toBe(2);
  const rendered = text(a.bytes).replace(/\s+/g, " ");
  expect(rendered).toContain(
    "Counterparty: Bluefin Data Co.. Date: 2026-10-05.",
  );
  expect(rendered).toContain("Reference REF-7, tier beta, note .");
  for (const tag of [
    "{{signature:1:y}}",
    "{{signature:2:y}}",
    "{{af_d_s:1:y}}",
    "{{af_d_s:2:y}}",
  ])
    expect(rendered).toContain(tag);
  expect(rendered).toContain("James Kurz");
  expect(rendered).toContain("Alex Example");
  expect(rendered).toContain("019a44ac · test-fixture fixture-2");
  expect(rendered).not.toContain("[[");
}, 30_000);

it("prints a line-item table with its subtotal, discounts and total", async () => {
  const rendered = await fixtureContractTemplate.render(input);
  const raw = text(rendered.bytes, "-raw")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
  // The text golden is independent of zlib, so it runs on any Node build.
  // `UPDATE_GOLDEN=1` rewrites it after a reviewed layout or copy change.
  const golden = new URL(
    "../__fixtures__/contract-template/render.golden.txt",
    import.meta.url,
  );
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, `${raw}\n`);
  expect(raw).toBe(readFileSync(golden, "utf8").trim());
  for (const expected of [
    "ITEM UNIT PRICE QUANTITY TERM DISCOUNT EXTENDED PRICE",
    "$15.00 / TB-month 500 TB-month 12 months 10% $81,000.00",
    "1,250.5 TB-month 36 months 12.5% $157,563.00",
    "$2,500.00 / engagement",
    // 15.00 x 500 x 12 + 4.00 x 1,250.5 x 36 + 2,500.00 = 272,572.00.
    "Subtotal before discounts $272,572.00",
    "Discounts -$31,509.00",
    "Total (USD) $241,063.00",
  ])
    expect(raw).toContain(expected);
}, 30_000);

it("prints a long converted quantity as entered, wrapped in its own cell", async () => {
  const long = {
    sku: "STORAGE-TB",
    description: "",
    region: "us-east",
    unit: "TB-month",
    // 1,234.567891 TiB in decimal TB.
    quantity: "1357.421751433393340416",
    termMonths: 12,
    unitPriceMinor: "1500",
    minimumQuantity: "0",
    discountBps: 0,
    // 15.00 x 1,357.421751433393340416 x 12 = 244,335.915258...
    extendedMinor: "24433592",
  };
  const rendered = await fixtureContractTemplate.render(
    withRows((rows) => {
      rows.splice(
        0,
        rows.length,
        { ...long, entered: { quantity: "1234.567891", unit: "TiB" } },
        long,
      );
    }),
  );
  const layout = text(rendered.bytes);
  const raw = text(rendered.bytes, "-raw").replace(/\s+/g, " ");
  // An order form states the exact quantity the price uses, as entered
  // where there is an entry, and never rounds it.
  expect(raw).toContain("1,234.567891 TiB = 1,357.421751433393340416 TB");
  expect(raw).toContain("1,357.421751433393340416 TB-month");
  expect(raw).not.toContain("about");
  // A stale entry is ignored and the row's own unit prints.
  const stale = text(
    (
      await fixtureContractTemplate.render(
        withRows((rows) => {
          rows.splice(0, rows.length, {
            ...long,
            entered: { quantity: "1", unit: "PiB" },
          });
        }),
      )
    ).bytes,
    "-raw",
  ).replace(/\s+/g, " ");
  expect(stale).toContain("1,357.421751433393340416 TB-month");
  expect(stale).not.toContain("PiB");
  // Each row's term still reads cleanly beside the quantity.
  expect(layout.match(/ 12 months /gu)).toHaveLength(2);
  expect(raw).toContain("$244,335.92");
}, 30_000);

it("refuses values that could form tags or that the PDF font cannot draw", async () => {
  for (const value of [
    "{{signature:1:y}}",
    "[[fixture_tier]]",
    "<b>",
    "株式会社",
  ]) {
    await expect(
      fixtureContractTemplate.render({
        ...input,
        values: { ...input.values, fixture_reference: value },
      }),
    ).rejects.toThrow("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
    await expect(
      fixtureContractTemplate.render(
        withRows((rows) => {
          if (rows[0]) rows[0].description = value;
        }),
      ),
    ).rejects.toThrow("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
  }
});

it("fails closed when a declared field has no value", async () => {
  for (const missing of ["fixture_note", "fixture_lines"]) {
    const values = Object.fromEntries(
      Object.entries(input.values).filter(([key]) => key !== missing),
    );
    await expect(
      fixtureContractTemplate.render({ ...input, values }),
    ).rejects.toThrow("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
  }
});

it("fails closed on a malformed line-item table", async () => {
  for (const malformed of [
    { ...input, values: { ...input.values, fixture_lines: "3 lines" } },
    { ...input, values: { ...input.values, fixture_reference: lines } },
    // An extended price other than what the pricing functions compute.
    withRows((rows) => {
      if (rows[0]) rows[0].extendedMinor = "8100001";
    }),
    // Below the rate's minimum, which a pricing scenario also refuses.
    withRows((rows) => {
      if (rows[0]) {
        rows[0].quantity = "5";
        rows[0].extendedMinor = "81000";
      }
    }),
    withRows((rows) => rows.splice(0)),
    withRows((rows) => {
      while (rows.length <= 20) rows.push({ ...rows[2] });
    }),
    // An unknown row key, here a per-row currency, is refused.
    withRows((rows) => {
      if (rows[1]) rows[1].currency = "EUR";
    }),
  ])
    await expect(fixtureContractTemplate.render(malformed)).rejects.toThrow(
      /^CONTRACT_TEMPLATE_(LINE_ITEMS|FIELD)_INVALID$/,
    );
});
