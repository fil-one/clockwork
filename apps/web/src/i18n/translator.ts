import { formattingLocales, rtlLocales, type Locale } from "./locales";

/** A plural message as one language's catalog carries it. */
export interface PluralEntry {
  /** The value that selects the form. */
  readonly count: string;
  readonly forms: Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;
  /**
   * The language whose plural rules select the form and format the count,
   * when it is not the catalog's own: staff-only messages are English in
   * every catalog.
   */
  readonly rules?: Locale;
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
 * language and format the count with the same locale, unless the entry names
 * its own `rules` (staff-only messages are English). Every other number is
 * inserted with `String()`, so years and version numbers are never grouped;
 * format amounts and quantities before passing them.
 */
export function createTranslator<Id extends string>(
  catalog: Readonly<Partial<Record<Id, CatalogEntry>>>,
  locale: Locale,
): (id: Id, values?: MessageValues) => string {
  const isolate = rtlLocales.has(locale);
  const rules = new Map<Locale, Intl.PluralRules>();
  const numbers = new Map<Locale, Intl.NumberFormat>();
  const pluralRules = (language: Locale) => {
    let value = rules.get(language);
    if (!value) {
      value = new Intl.PluralRules(formattingLocales[language]);
      rules.set(language, value);
    }
    return value;
  };
  const numberFormat = (language: Locale) => {
    let value = numbers.get(language);
    if (!value) {
      value = new Intl.NumberFormat(formattingLocales[language]);
      numbers.set(language, value);
    }
    return value;
  };
  return (id, values = {}) => {
    const entry = catalog[id];
    // A typed ID misses only when cast, or when a reader catalog without
    // staff-only entries is asked for a staff ID. Showing the ID is visible in
    // review and in tests, where falling back to English would not be.
    if (entry === undefined) return id;
    let template: string;
    let countKey: string | undefined;
    let countLanguage = locale;
    if (typeof entry === "string") template = entry;
    else {
      countKey = entry.count;
      countLanguage = entry.rules ?? locale;
      const count = Number(values[countKey]);
      template =
        entry.forms[
          pluralRules(countLanguage).select(Number.isFinite(count) ? count : 0)
        ] ??
        entry.forms.other ??
        "";
    }
    return template.replace(/\{([^{}]+)\}/gu, (placeholder, key: string) => {
      if (!Object.hasOwn(values, key)) return placeholder;
      const value = values[key];
      let text: string;
      if (key === countKey && typeof value === "number")
        text = numberFormat(countLanguage).format(value);
      else text = String(value);
      return isolate ? `${FSI}${text}${PDI}` : text;
    });
  };
}
