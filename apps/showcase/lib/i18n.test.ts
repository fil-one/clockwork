import { describe, expect, it } from "vitest";
import { getDictionary } from "./dictionaries";
import { locales, localizedHref, preferredLocale, translator } from "./i18n";
import en from "./locales/en.json";
const placeholders = (value: string) =>
  [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
describe("complete, isolated sales-demo localization", () => {
  for (const locale of locales)
    it(`${locale} has every message with unchanged placeholders`, async () => {
      const dictionary = await getDictionary(locale);
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
      for (const [key, value] of Object.entries(en)) {
        const translated = dictionary[key as keyof typeof en];
        expect(translated.trim().length, `${locale}: ${key}`).toBeGreaterThan(
          0,
        );
        expect(placeholders(translated), `${locale}: ${key}`).toEqual(
          placeholders(value),
        );
        expect(translated, `${locale}: ${key}`).not.toContain("Clockwork");
      }
    });
  it("honors explicit browser preferences and ignores excluded/unsupported languages", () => {
    expect(preferredLocale("fr", "de;q=1")).toBe("fr");
    expect(preferredLocale("unknown", "de;q=0,ja;q=0.8,en;q=0.5")).toBe("ja");
    expect(preferredLocale(undefined, "xx-ZZ,es-ES;q=0.9")).toBe("es");
    expect(preferredLocale(undefined, "xx;q=1,fr;q=oops")).toBe("en");
  });
  it("retains the locale in deep links and the sandbox handoff", () => {
    expect(localizedHref("/tour?step=3&mode=connected", "ar")).toBe(
      "/ar/tour?step=3&mode=connected",
    );
    expect(localizedHref("/#connected", "fr")).toBe("/fr#connected");
    expect(
      localizedHref(
        "https://clockwork-commerce-demo.netlify.app/demo/persona?persona=reseller",
        "ja",
      ),
    ).toContain("persona=reseller&lang=ja");
  });
  it("interpolates once and isolates dynamic values in Arabic", async () => {
    const dictionary = await getDictionary("ar");
    const t = translator(dictionary, "ar");
    expect(t("sales.value.tb.428f9", { capacity: "{literal}" })).toContain(
      "\u2068{literal}\u2069",
    );
    expect(() => t("sales.value.tb.428f9")).toThrow("Missing interpolation");
  });
});
