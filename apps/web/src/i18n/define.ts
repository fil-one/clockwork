import type { Locale } from "./locales";

/**
 * How messages are written.
 *
 * Every message names all eight languages. Leaving one out is a type error,
 * and a value that is identical to English is a test failure unless it is
 * marked with one of the two explicit forms below, which a reviewer can grep:
 *
 * - `sameAsEnglish("Status")` for one language where the English word is the
 *   right word (German and Brazilian Portuguese both say "Status").
 * - `sameInAllLanguages("Fil One", "product name")` for text that is never
 *   translated. The reason is required and is read in review.
 *
 * Plural messages give each language the CLDR categories it uses. The
 * categories are part of the type, so Arabic cannot ship without `few` and
 * Japanese cannot invent a `one` form.
 */

export type TranslatedLocale = Exclude<Locale, "en">;

/** A value reviewed and kept identical to the English text in one language. */
export interface SameAsEnglish {
  readonly sameAsEnglish: string;
}

export function sameAsEnglish(text: string): SameAsEnglish {
  return { sameAsEnglish: text };
}

export type TextMessage = { readonly en: string } & {
  readonly [L in TranslatedLocale]: string | SameAsEnglish;
};

/** Text that is never translated: product names, codes, units. */
export interface SameInAllLanguagesMessage {
  readonly en: string;
  /** Why this text is not translated. Required; reviewers read it. */
  readonly sameInAllLanguages: string;
}

export function sameInAllLanguages(
  text: string,
  reason: string,
): SameInAllLanguagesMessage {
  return { en: text, sameInAllLanguages: reason };
}

/**
 * The plural categories `Intl.PluralRules` selects for each interface
 * language's formatting locale. `catalogs.test.ts` checks this table against
 * the runtime's CLDR data, so it cannot drift from what the translator selects.
 */
export interface PluralCategoriesByLocale {
  readonly en: "one" | "other";
  readonly es: "one" | "many" | "other";
  readonly fr: "one" | "many" | "other";
  readonly de: "one" | "other";
  readonly ja: "other";
  readonly pt: "one" | "many" | "other";
  readonly zh: "other";
  readonly ar: "zero" | "one" | "two" | "few" | "many" | "other";
}

export type PluralForms<L extends Locale> = {
  readonly [C in PluralCategoriesByLocale[L]]: L extends "en"
    ? string
    : string | SameAsEnglish;
};

/**
 * The same table as a value, for the test that holds it to the runtime's CLDR
 * data and for the translator's harness checks.
 */
export const pluralCategoriesByLocale = {
  en: ["one", "other"],
  es: ["one", "many", "other"],
  fr: ["one", "many", "other"],
  de: ["one", "other"],
  ja: ["other"],
  pt: ["one", "many", "other"],
  zh: ["other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
} as const satisfies {
  readonly [L in Locale]: readonly PluralCategoriesByLocale[L][];
};

/**
 * One message whose wording depends on a count. `count` names the value that
 * selects the form; the translator formats it with the interface language, so
 * write `{count}` where the number goes, or leave it out of a form that says
 * the number in words ("No results", "Un résultat").
 */
export type PluralMessage = { readonly count: string } & {
  readonly [L in Locale]: PluralForms<L>;
};

export type MessageDefinition =
  TextMessage | SameInAllLanguagesMessage | PluralMessage;

export type MessageDefinitions = Readonly<Record<string, MessageDefinition>>;

/** Identity at runtime; exists so a missing language is a compile error. */
export function defineMessages<T extends MessageDefinitions>(messages: T): T {
  return messages;
}

export function isPluralMessage(
  message: MessageDefinition,
): message is PluralMessage {
  return "count" in message && typeof message.en === "object";
}

export function isSameInAllLanguages(
  message: MessageDefinition,
): message is SameInAllLanguagesMessage {
  return "sameInAllLanguages" in message;
}
