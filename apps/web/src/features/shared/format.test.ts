import { describe, expect, it } from "vitest";

import { formatAddress, formatDate, formatMoney, taxLabel } from "./format";

describe("locale-aware experience formatting", () => {
  it("formats supported currencies without floating-point storage", () => {
    expect(formatMoney("18480000", "USD", "en-US")).toBe("$184,800.00");
    expect(formatMoney("3168000", "EUR", "es-ES")).toContain("31.680,00");
    expect(formatMoney("7299000", "GBP", "en-GB")).toBe("£72,990.00");
    expect(formatMoney("-50", "USD", "en-US")).toBe("-$0.50");
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
    expect(taxLabel("US")).toBe("Sales tax");
    expect(taxLabel("ES")).toBe("VAT");
  });
});
