import { describe, expect, it } from "vitest";
import {
  catalogs,
  en,
  resolveLocale,
  translatorFor,
  type MessageId,
} from "./index";
import { customerPartnerCopy } from "@/src/features/customer-partner/copy";
import { localizeCopy } from "./copy";
import { formatMoney } from "@/src/features/shared/format";

const placeholders = (value: string) =>
  [...value.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]).sort();

describe("interface translations", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has complete messages and unchanged placeholders`, () => {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
      for (const id of Object.keys(en) as MessageId[]) {
        expect(catalog[id].trim(), id).not.toBe("");
        expect(placeholders(catalog[id]), id).toEqual(placeholders(en[id]));
        expect(catalog[id], id).not.toMatch(
          /<\/?(?:script|iframe)|\bTODO\b|\bTRANSLATE\b/u,
        );
      }
    });
  }
  it("covers customer and partner interface copy without changing interpolated records", () => {
    const known = new Set<string>(Object.values(en));
    const visit = (value: unknown): void => {
      if (typeof value === "string") expect(known.has(value), value).toBe(true);
      else if (value && typeof value === "object")
        Object.values(value).forEach(visit);
    };
    visit(customerPartnerCopy);
    for (const locale of Object.keys(catalogs)) {
      const translated = localizeCopy(
        customerPartnerCopy,
        translatorFor(locale),
      );
      expect(placeholders(translated.commercial.orderTermsHelp)).toEqual([
        "agreementTitle",
        "agreementVersion",
        "quoteReference",
        "quoteVersion",
      ]);
      expect(translated.commercial.externalPayment).toBe(
        translatorFor(locale)("cp.commercial.externalPayment"),
      );
    }
  });
  it("normalizes regional locales and rejects unsupported values without prototype lookup", () => {
    expect(
      ["pt-BR", "zh-Hans", "ar-AE", "de-DE", "ja-JP", "es-MX", "fr-CA"].map(
        resolveLocale,
      ),
    ).toEqual(["pt", "zh", "ar", "de", "ja", "es", "fr"]);
    expect(
      [undefined, "xx", "constructor", "__proto__", "<script>"].map(
        resolveLocale,
      ),
    ).toEqual(["en", "en", "en", "en", "en"]);
  });
  it("keeps user references and monetary facts verbatim in translated messages", () => {
    for (const locale of Object.keys(catalogs)) {
      const t = translatorFor(locale);
      expect(
        t("orders.accept.source", { reference: "ACME-Q-928", version: 42 }),
      ).toContain("ACME-Q-928");
      expect(
        t("orders.accept.source", { reference: "ACME-Q-928", version: 42 }),
      ).toContain("42");
    }
  });
  it("does not interpret placeholder-like text inside record values", () => {
    for (const locale of Object.keys(catalogs)) {
      expect(
        translatorFor(locale)("orders.accept.source", {
          reference: "ACME-{version}",
          version: 42,
        }),
      ).toContain("ACME-{version}");
    }
  });
  it("preserves fractional minor units and Arabic digit formatting", () => {
    expect(formatMoney(12345n, "USD", "de-DE")).toBe(
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "USD",
      }).format(123.45),
    );
    expect(formatMoney(12345n, "USD", "ar-AE")).toBe(
      new Intl.NumberFormat("ar-AE", {
        style: "currency",
        currency: "USD",
      }).format(123.45),
    );
  });
  it("distinguishes recording payment, approving and destructive teardown", () => {
    expect(catalogs.es["projection.action.pay"]).toBe("Registrar pago");
    expect(catalogs.fr["projection.action.pay"]).toBe(
      "Enregistrer le paiement",
    );
    expect(catalogs.de["projection.action.pay"]).toBe("Zahlung erfassen");
    expect(catalogs.ja["projection.action.pay"]).toBe("支払いを記録");
    expect(catalogs.pt["projection.action.pay"]).toBe("Registrar pagamento");
    expect(catalogs.zh["projection.action.pay"]).toBe("记录付款");
    expect(catalogs.ar["projection.action.pay"]).toBe("تسجيل دفعة");
  });
});
