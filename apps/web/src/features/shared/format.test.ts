import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import { formatAddress, formatDate, formatMoney, taxLabel } from "./format";

describe("locale-aware experience formatting", () => {
  it("formats supported currencies without floating-point storage", () => {
    expect(formatMoney("18480000", "USD", "en-US")).toBe("$184,800.00");
    expect(formatMoney("3168000", "EUR", "es-ES")).toContain("31.680,00");
    expect(formatMoney("7299000", "GBP", "en-GB")).toBe("£72,990.00");
    expect(formatMoney("-50", "USD", "en-US")).toBe("-$0.50");
  });

  it("lets the reader's locale place the minus sign of a negative amount", () => {
    // A credit or a clawback. In ar-AE the sign sits after the direction
    // marks Intl emits; a hand-prepended "-" put it outside them.
    for (const locale of ["ar-AE", "de-DE", "fr-FR", "pt-BR"])
      expect(formatMoney("-840050", "USD", locale), locale).toBe(
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "USD",
        }).format(-8400.5),
      );
    expect(formatMoney("-50", "USD", "ar-AE")).toBe(
      new Intl.NumberFormat("ar-AE", {
        style: "currency",
        currency: "USD",
      }).format(-0.5),
    );
  });

  it("formats contractual dates, addresses, and jurisdictional tax labels", () => {
    expect(formatDate("2026-12-31", "en-GB")).toBe("31 Dec 2026");
    expect(
      formatAddress({
        line1: "14 Signal Row",
        city: "Madrid",
        postalCode: "28001",
        country: "Spain",
      }),
    ).toContain("Madrid");
    const t = translatorFor("en");
    expect(taxLabel("US", t)).toBe("Sales tax");
    expect(taxLabel("ES", t)).toBe("VAT");
  });
});
