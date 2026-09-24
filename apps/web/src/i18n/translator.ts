import { formattingLocales, rtlLocales, type Locale } from "./locales";

/** A plural message as one language's catalog carries it. */
export interface PluralEntry {
  /** The value that selects the form. */
  readonly count: string;
  readonly forms: Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;
}
export type CatalogEntry = string | PluralEntry;

export type MessageValues = Readonly<Record<string, string | number>>;

/** Unicode first-strong isolate and pop-directional isolate. */
const FSI = "\u2068";
const PDI = "\u2069";

/**
 * Builds the translator for one language's catalog.
 *
 * Interpolation is single pass: a record value that contains `{braces}` is
 * inserted as written and never read as a placeholder.
 *
 * In a right-to-left language every inserted value is wrapped in a directional
 * isolate. Without it an identifier such as `INV-2026-0781`, an email address
 * or an amount next to Arabic punctuation is laid out by the bidi algorithm as
 * part of the surrounding sentence, and the sentence visibly reorders. The
 * isolate marks are invisible and do not change what a screen reader says.
 *
 * Plural messages select their form with `Intl.PluralRules` for the interface
 * language and format the count with the same locale. Every other number is
 * inserted with `String()`, so years and version numbers are never grouped;
 * format amounts and quantities before passing them.
 */
export function createTranslator<Id extends string>(
  catalog: Readonly<Record<Id, CatalogEntry>>,
  locale: Locale,
): (id: Id, values?: MessageValues) => string {
  const formatting = formattingLocales[locale];
  const isolate = rtlLocales.has(locale);
  let rules: Intl.PluralRules | undefined;
  let numbers: Intl.NumberFormat | undefined;
  return (id, values = {}) => {
    const entry = catalog[id] as CatalogEntry | undefined;
    // A typed ID cannot miss; a cast one can. Showing the ID is visible in
    // review and in tests, where falling back to English would not be.
    if (entry === undefined) return id;
    let template: string;
    let countKey: string | undefined;
    if (typeof entry === "string") template = entry;
    else {
      countKey = entry.count;
      const count = Number(values[countKey]);
      rules ??= new Intl.PluralRules(formatting);
      template =
        entry.forms[rules.select(Number.isFinite(count) ? count : 0)] ??
        entry.forms.other ??
        "";
    }
    return template.replace(/\{([^{}]+)\}/gu, (placeholder, key: string) => {
      if (!Object.hasOwn(values, key)) return placeholder;
      const value = values[key];
      let text: string;
      if (key === countKey && typeof value === "number") {
        numbers ??= new Intl.NumberFormat(formatting);
        text = numbers.format(value);
      } else text = String(value);
      return isolate ? `${FSI}${text}${PDI}` : text;
    });
  };
}
