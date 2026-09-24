import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  demoLocales,
  demoText,
  resolveDemoText,
  type DemoLocale,
} from "@clockwork/testing/demo-localized-text";

import { formatMoney } from "@/src/features/shared/format";

import { catalogs, messageModules, translatorFor } from "./catalogs";
import {
  isPluralMessage,
  isSameInAllLanguages,
  pluralCategoriesByLocale,
  type MessageDefinition,
} from "./define";
import { legacyEnglish } from "./legacy-english";
import {
  formattingLocales,
  locales,
  resolveLocale,
  type Locale,
} from "./locales";
import { customerMessages } from "./messages/customer";
import { customerCommercialMessages } from "./messages/customer-commercial";
import { experienceMessages } from "./messages/experience";
import { experienceDataMessages } from "./messages/experience-data";
import { operationsMessages } from "./messages/operations";
import { operationsFinanceMessages } from "./messages/operations-finance";
import { laneModules, laneOf } from "./ownership";
import type { CatalogEntry } from "./translator";

const translated = locales.filter(
  (locale): locale is Exclude<Locale, "en"> => locale !== "en",
);
const definitions = Object.entries(messageModules).flatMap(
  ([module, { messages }]) =>
    Object.entries(messages as Readonly<Record<string, MessageDefinition>>).map(
      ([id, message]) => ({ module, id, message }),
    ),
);

/** Every string a catalog entry can render, with a label for failures. */
function forms(entry: CatalogEntry): readonly [string, string][] {
  return typeof entry === "string"
    ? [["", entry]]
    : Object.entries(entry.forms).map(([category, form]) => [
        `[${category}]`,
        form,
      ]);
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^{}]+)\}/gu)]
    .map((match) => match[1] ?? "")
    .sort();
}

/** Letters outside placeholders; a value without any has nothing to translate. */
function hasWords(value: string): boolean {
  return /\p{L}/u.test(value.replace(/\{[^{}]*\}/gu, ""));
}

describe("catalog structure", () => {
  it("composes one entry per ID in every language", () => {
    for (const locale of locales)
      expect(Object.keys(catalogs[locale]).sort(), locale).toEqual(
        Object.keys(catalogs.en).sort(),
      );
    const ids = definitions.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps placeholders identical across languages and plural forms", () => {
    for (const { id } of definitions) {
      const english = catalogs.en[id as keyof typeof catalogs.en];
      const expected = [
        ...new Set(forms(english).flatMap(([, form]) => placeholders(form))),
      ].sort();
      for (const locale of locales) {
        const entry = catalogs[locale][id as keyof typeof catalogs.en];
        const count = typeof entry === "string" ? undefined : entry.count;
        for (const [category, form] of forms(entry)) {
          expect(form.trim(), `${locale} ${id}${category}`).not.toBe("");
          expect(form, `${locale} ${id}${category}`).not.toMatch(
            /<\/?(?:script|iframe)|\bTODO\b|\bTRANSLATE\b/u,
          );
          // A plural form may say the number in words ("Un résultat").
          const used = placeholders(form);
          expect(
            used.filter((name) => name !== count),
            `${locale} ${id}${category}`,
          ).toEqual(expected.filter((name) => name !== count));
        }
      }
    }
  });

  it("gives every plural message exactly the categories CLDR selects", () => {
    for (const locale of locales) {
      const runtime = new Intl.PluralRules(formattingLocales[locale])
        .resolvedOptions()
        .pluralCategories.slice()
        .sort();
      expect([...pluralCategoriesByLocale[locale]].sort(), locale).toEqual(
        runtime,
      );
      for (const { id, message } of definitions) {
        if (!isPluralMessage(message)) continue;
        expect(Object.keys(message[locale]).sort(), `${locale} ${id}`).toEqual(
          runtime,
        );
      }
    }
  });
});

describe("nothing is left in English by accident", () => {
  it("fails on a translation identical to English unless it is marked", () => {
    const unmarked: string[] = [];
    for (const { id, message } of definitions) {
      if (isSameInAllLanguages(message)) {
        expect(message.sameInAllLanguages.trim(), id).not.toBe("");
        continue;
      }
      for (const locale of translated) {
        const pairs: [string, unknown, string][] = isPluralMessage(message)
          ? Object.entries(message[locale]).map(([category, value]) => [
              `${id}[${category}]`,
              value,
              message.en[category as "one" | "other"] ?? message.en.other,
            ])
          : [[id, message[locale], message.en]];
        for (const [label, value, english] of pairs) {
          if (typeof value === "string") {
            if (value === english && hasWords(value))
              unmarked.push(`${locale} ${label}: ${JSON.stringify(value)}`);
          } else {
            // A marker must still match the English it vouches for, so an
            // English edit forces the translator to look again.
            expect(
              (value as { sameAsEnglish: string }).sameAsEnglish,
              `${locale} ${label} is marked sameAsEnglish but differs`,
            ).toBe(english);
          }
        }
      }
    }
    expect(
      unmarked,
      "Translate these, or mark a deliberate match with sameAsEnglish(...)",
    ).toEqual([]);
  });

  it("allows no new opaque ui.<number> IDs", () => {
    const legacy = new Set(
      Object.keys(legacyEnglish).filter((id) => /^ui\.\d+$/u.test(id)),
    );
    const opaque = definitions
      .map(({ id }) => id)
      .filter((id) => /^ui\.\d+$/u.test(id) && !legacy.has(id));
    expect(opaque, "Give new messages a descriptive ID").toEqual([]);
  });

  it("keeps new IDs in the owning module's namespace", () => {
    const misplaced = definitions
      .filter(
        ({ module, id }) =>
          !Object.hasOwn(legacyEnglish, id) &&
          !messageModules[module as keyof typeof messageModules].prefixes.some(
            (prefix) => id.startsWith(prefix),
          ),
      )
      .map(({ module, id }) => `${module}: ${id}`);
    expect(misplaced).toEqual([]);
  });

  // A split lane composes two files into one module by spreading them, and a
  // spread keeps only the last of two equal keys. Each half mints IDs under
  // its own sub-prefix, and no ID may appear in both halves.
  it("keeps the two halves of a split module disjoint", () => {
    const halves = [
      [customerMessages, customerCommercialMessages, "customer.commercial."],
      [experienceMessages, experienceDataMessages, "experience.data."],
      [operationsMessages, operationsFinanceMessages, "operations.finance."],
    ] as const;
    for (const [main, half, prefix] of halves) {
      const shared = Object.keys(half).filter((id) => Object.hasOwn(main, id));
      expect(shared, `IDs defined in both halves of ${prefix}`).toEqual([]);
      const strayInHalf = Object.keys(half).filter(
        (id) => !Object.hasOwn(legacyEnglish, id) && !id.startsWith(prefix),
      );
      expect(strayInHalf, `new IDs in the ${prefix} half`).toEqual([]);
      const strayInMain = Object.keys(main).filter((id) =>
        id.startsWith(prefix),
      );
      expect(strayInMain, `${prefix} IDs outside their half`).toEqual([]);
    }
  });
});

/**
 * The mechanically checkable part of the glossary's typography rules
 * (docs/operations/localization-glossary.md). Everything else is review.
 */
describe("typography", () => {
  const cjk = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
  const rules: Readonly<
    Partial<Record<Locale | "all", readonly [RegExp, string][]>>
  > = {
    all: [[/\.\.\./u, "use the ellipsis character …"]],
    fr: [
      [/'/u, "use the typographic apostrophe ’"],
      [/(?<!\u202f)[;!?]/u, "U+202F narrow no-break space before ; ! ?"],
      [/(?<![\u00a0\d])[:](?=\s|$)/u, "U+00A0 no-break space before :"],
      [/«(?!\u00a0)|(?<!\u00a0)»/u, "U+00A0 inside « »"],
    ],
    de: [[/"/u, "use „…“ quotation marks"]],
    pt: [[/"/u, "use “…” quotation marks"]],
    ja: [
      [
        new RegExp(`[${cjk}][,.:;!?()]|[,.:;!?()][${cjk}]`, "u"),
        "full-width punctuation next to Japanese text",
      ],
      [/[\uff21-\uff3a\uff41-\uff5a\uff10-\uff19]/u, "half-width Latin"],
    ],
    zh: [
      [
        new RegExp(`[${cjk}][,.:;!?()]|[,.:;!?()][${cjk}]`, "u"),
        "full-width punctuation next to Chinese text",
      ],
      [/[\uff21-\uff3a\uff41-\uff5a\uff10-\uff19]/u, "half-width Latin"],
      [/\p{Script=Han} \p{Script=Han}/u, "no space between Han characters"],
    ],
    ar: [
      [
        /\p{Script=Arabic}[,;?]|[,;?]\p{Script=Arabic}/u,
        "Arabic punctuation ، ؛ ؟",
      ],
      [/\u0640/u, "no tatweel"],
    ],
  };

  it("follows the enforced typography subset in every language", () => {
    const failures: string[] = [];
    for (const locale of locales)
      for (const [id, entry] of Object.entries(catalogs[locale]))
        for (const [category, form] of forms(entry)) {
          const text = form.replace(/\{[^{}]*\}/gu, "");
          for (const [pattern, rule] of [
            ...(rules.all ?? []),
            ...(rules[locale] ?? []),
          ])
            if (pattern.test(text))
              failures.push(
                `${locale} ${id}${category}: ${rule} — ${JSON.stringify(form)}`,
              );
          if (locale === "es") {
            if (text.includes("?") && !text.includes("¿"))
              failures.push(`es ${id}${category}: ¿ with every ?`);
            if (text.includes("!") && !text.includes("¡"))
              failures.push(`es ${id}${category}: ¡ with every !`);
          }
        }
    expect(failures).toEqual([]);
  });
});

describe("translator", () => {
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
    for (const locale of locales) {
      const text = translatorFor(locale)("orders.accept.source", {
        reference: "ACME-Q-928",
        version: 42,
      });
      expect(text).toContain("ACME-Q-928");
      expect(text).toContain("42");
    }
  });

  it("does not interpret placeholder-like text inside record values", () => {
    for (const locale of locales)
      expect(
        translatorFor(locale)("orders.accept.source", {
          reference: "ACME-{version}",
          version: 42,
        }),
      ).toContain("ACME-{version}");
  });

  it("isolates inserted values in Arabic so identifiers cannot reorder the sentence", () => {
    const text = translatorFor("ar")("common.reference", {
      reference: "INV-2026-0781",
    });
    expect(text).toBe("المرجع \u2068INV-2026-0781\u2069");
    // Left-to-right languages get the value exactly as given.
    expect(
      translatorFor("pt")("common.reference", { reference: "INV-2026-0781" }),
    ).toBe("Referência INV-2026-0781");
  });

  it("selects plural forms by CLDR category and formats the count for the reader", () => {
    const ar = translatorFor("ar");
    expect(
      [0, 1, 2, 3, 11, 100].map((count) => ar("common.results", { count })),
    ).toEqual([
      "لا توجد نتائج",
      "نتيجة واحدة",
      "نتيجتان",
      "\u20683\u2069 نتائج",
      "\u206811\u2069 نتيجة",
      "\u2068100\u2069 نتيجة",
    ]);
    const fr = translatorFor("fr");
    expect(fr("common.results", { count: 0 })).toBe("0 résultat");
    expect(fr("common.results", { count: 1234 })).toBe(
      `${new Intl.NumberFormat("fr-FR").format(1234)} résultats`,
    );
    expect(translatorFor("ja")("common.results", { count: 1 })).toBe(
      "1件の結果",
    );
    expect(translatorFor("en")("common.results", { count: 1 })).toBe(
      "1 result",
    );
  });

  it("shows the ID, never English, for an ID that is not in the catalog", () => {
    expect(translatorFor("pt")("missing.id" as keyof typeof catalogs.en)).toBe(
      "missing.id",
    );
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

describe("demo-authored text", () => {
  it("covers exactly the interface languages", () => {
    const same: [DemoLocale] extends [Locale]
      ? [Locale] extends [DemoLocale]
        ? true
        : false
      : false = true;
    expect(same).toBe(true);
    expect([...demoLocales].sort()).toEqual([...locales].sort());
  });

  it("resolves to one language at the read boundary and leaves facts alone", () => {
    const record = {
      id: "EC-0047",
      context: demoText({
        en: "Two-tier resale",
        es: "Reventa en dos niveles",
        fr: "Revente à deux niveaux",
        de: "Zweistufiger Wiederverkauf",
        ja: "2 階層の再販",
        pt: "Revenda em dois níveis",
        zh: "两级转售",
        ar: "إعادة بيع على مستويين",
      }),
      position: { amountMinor: "840000", currency: "USD" },
    };
    expect(resolveDemoText(record, "pt")).toEqual({
      id: "EC-0047",
      context: "Revenda em dois níveis",
      position: { amountMinor: "840000", currency: "USD" },
    });
    // The stored form survives a JSON round trip, so an override persisted to
    // the demo state store keeps every language.
    expect(
      resolveDemoText(JSON.parse(JSON.stringify(record)) as unknown, "de"),
    ).toMatchObject({ context: "Zweistufiger Wiederverkauf" });
  });
});

/**
 * A lane references only its own module, `common` and `enums`. An ID used by
 * two lanes belongs in `common`; otherwise one lane renaming its own message
 * breaks the other at merge time, which is exactly what the modules exist to
 * prevent.
 */
describe("lane boundaries", () => {
  const root = join(process.cwd(), "../..");
  const ownerOf = new Map<string, string>(
    definitions.map(({ module, id }) => [id, module]),
  );
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      if (name === "node_modules" || name.startsWith(".")) return [];
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(tsx?|mts)$/u.test(name) &&
        !/\.(test|spec|stories)\.tsx?$|\.d\.ts$/u.test(name)
        ? [path]
        : [];
    });
  }

  it("keeps every lane on its own module plus common and enums", () => {
    const crossings: string[] = [];
    for (const base of ["apps/web/src", "apps/web/app", "packages/ui/src"])
      for (const file of sources(join(root, base))) {
        const path = relative(root, file).split("\\").join("/");
        const lane = laneOf(path);
        if (!lane || lane === "foundation") continue;
        const own = laneModules[lane];
        for (const match of readFileSync(file, "utf8").matchAll(
          /["'`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)["'`]/gu,
        )) {
          const id = match[1] ?? "";
          const module = ownerOf.get(id);
          if (
            module &&
            module !== own &&
            module !== "common" &&
            module !== "enums"
          )
            crossings.push(`${path} (${lane}) uses ${id} from ${module}`);
        }
      }
    expect(crossings).toEqual([]);
  });
});
