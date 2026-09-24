import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import {
  basisLabel,
  merchantLabel,
  methodologyLabel,
  monthLabel,
  stageLabel,
} from "./model";

const en = translatorFor("en");
const de = translatorFor("de");

describe("revenue presentation", () => {
  it("keeps the revenue basis explicit", () => {
    expect(basisLabel("transfer_price", en)).toContain("not gross");
    expect(basisLabel("gross", en)).toBe("Gross");
    expect(basisLabel("gross", de)).toBe("Brutto");
    // An unknown basis is shown as stored rather than as a plausible label.
    expect(basisLabel("net_of_fees", en)).toBe("net_of_fees");
  });

  it("does not describe pipeline as weighted", () => {
    expect(stageLabel("pipeline", en)).toBe("Pipeline");
    expect(stageLabel("committed_backlog", en)).toBe("Contracted backlog");
  });

  it("words stored codes as business labels and keeps versions and names", () => {
    expect(methodologyLabel("merchant_of_record.v1", en)).toBe(
      "Merchant-of-record basis · v1",
    );
    expect(methodologyLabel("merchant_of_record.v1", de)).toBe(
      "Merchant-of-Record-Basis · v1",
    );
    expect(methodologyLabel("contracted-v1", en)).toBe("contracted-v1");
    expect(merchantLabel("fil_one", de)).toBe("Fil One");
    expect(merchantLabel("partner", de)).toBe("Partner");
    expect(monthLabel("2026-08-01", "en-US")).toBe("Aug 2026");
  });
});
