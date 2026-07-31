import { describe, expect, it } from "vitest";

import {
  assertIsoDate,
  assertIsoInstant,
  formatAddress,
  formatDate,
  formatMoney,
  formatPercentFromBasisPoints,
  groupHash,
  normalizeSha256Hash,
  slugifyFilePart,
  taxIdentityLabel,
} from "./format";

describe("document formatting", () => {
  it("formats integer minor units without binary floating point", () => {
    expect(
      formatMoney({ currency: "USD", minorUnits: "123456" }, "en-US"),
    ).toBe("$1,234.56");
    expect(formatMoney({ currency: "GBP", minorUnits: "-1234" }, "en-GB")).toBe(
      "-£12.34",
    );
    expect(
      formatMoney({ currency: "EUR", minorUnits: "1234" }, "es-ES"),
    ).toMatch(/12,34.*€/);
    expect(
      formatMoney(
        { currency: "USD", minorUnits: "900719925474099312" },
        "en-US",
      ),
    ).toBe("$9,007,199,254,740,993.12");
  });

  it("rejects malformed money and dates", () => {
    expect(() =>
      formatMoney({ currency: "USD", minorUnits: "12.50" }, "en-US"),
    ).toThrow(/integer string/);
    expect(() => assertIsoDate("07/31/2026")).toThrow(/ISO calendar date/);
    expect(() => assertIsoInstant("2026-07-31T16:00:00-04:00")).toThrow(
      /UTC RFC 3339/,
    );
  });

  it("formats dates, percentages, and country-aware addresses", () => {
    expect(formatDate("2026-07-31", "en-US")).toBe("Jul 31, 2026");
    expect(formatPercentFromBasisPoints(1250, "en-US")).toBe("12.5%");
    expect(
      formatAddress({
        countryCode: "US",
        line1: "10 Example Road",
        locality: "New York",
        postalCode: "10001",
        region: "NY",
      }),
    ).toEqual(["10 Example Road", "New York, NY 10001", "United States"]);
  });

  it("selects VAT identity labels without changing the stored value", () => {
    expect(
      taxIdentityLabel({
        address: {
          countryCode: "GB",
          line1: "1 Sample Street",
          locality: "London",
          postalCode: "E1 1AA",
        },
        legalName: "Sample Ltd.",
      }),
    ).toBe("VAT number");
  });

  it("creates safe filenames and readable hash groupings", () => {
    expect(slugifyFilePart("Quote / 2026 #42")).toBe("quote-2026-42");
    expect(groupHash("1234567890abcdef")).toBe("12345678 90abcdef");
    expect(normalizeSha256Hash("SHA256:ABCD")).toBe("abcd");
  });
});
