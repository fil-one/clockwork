/**
 * Demo-authored text in every interface language (translation policy rule 4).
 *
 * A production record's title, description or context line is whatever a
 * person typed, and it is never translated. The demo has no person typing: its
 * fixtures stand in for that content, so a Portuguese reader of the demo would
 * otherwise see English prose in the middle of a Portuguese page. `demoText`
 * marks a fixture field as demo-authored and carries all eight languages; the
 * demo read boundary resolves it to the reader's language.
 *
 * Rules:
 * - Only fixture fields that stand in for user-entered content use this.
 *   Labels, statuses and anything the product itself writes are message IDs.
 * - Names, references, amounts and dates are never inside the text. Keep them
 *   as facts in their own fields, or leave them out of the sentence.
 * - The object is JSON-serializable, so a demo override persisted to the demo
 *   state store keeps the fact (all eight languages) rather than one reader's
 *   rendering of it.
 * - Only the demo read boundary resolves it. Production projection sources
 *   never see these objects and never call the resolver.
 */

/** The interface languages; kept equal to the web app's `Locale` by a test. */
export const demoLocales = [
  "en",
  "es",
  "fr",
  "de",
  "ja",
  "pt",
  "zh",
  "ar",
] as const;
export type DemoLocale = (typeof demoLocales)[number];

const marker = "$demoText";

export interface DemoLocalizedText {
  readonly [marker]: Readonly<Record<DemoLocale, string>>;
}

/** All eight languages are required; a missing one is a type error. */
export function demoText(
  text: Readonly<Record<DemoLocale, string>>,
): DemoLocalizedText {
  for (const locale of demoLocales)
    if (typeof text[locale] !== "string" || !text[locale].trim())
      throw new Error(`demoText is missing ${locale}`);
  return { [marker]: { ...text } };
}

export function isDemoLocalizedText(
  value: unknown,
): value is DemoLocalizedText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const text = (value as Record<string, unknown>)[marker];
  return (
    !!text &&
    typeof text === "object" &&
    demoLocales.every(
      (locale) => typeof (text as Record<string, unknown>)[locale] === "string",
    )
  );
}

/** A fixture field that is either plain text or demo-authored text. */
export type DemoTextField = string | DemoLocalizedText;

/** `T` with every demo-authored text resolved to a string. */
export type ResolvedDemoText<T> = T extends DemoLocalizedText
  ? string
  : T extends readonly (infer U)[]
    ? ResolvedDemoText<U>[]
    : T extends object
      ? { [K in keyof T]: ResolvedDemoText<T[K]> }
      : T;

/**
 * Resolves every demo-authored text inside `value` to one language.
 *
 * Deep over plain objects and arrays; everything else is returned as is, so a
 * record's facts pass through untouched. An unknown language falls back to
 * the fixture's source language, English.
 */
export function resolveDemoText<T>(
  value: T,
  locale: string,
): ResolvedDemoText<T> {
  const language = (demoLocales as readonly string[]).includes(locale)
    ? (locale as DemoLocale)
    : "en";
  const visit = (current: unknown): unknown => {
    if (isDemoLocalizedText(current)) return current[marker][language];
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      const prototype = Object.getPrototypeOf(current) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return current;
      return Object.fromEntries(
        Object.entries(current).map(([key, entry]) => [key, visit(entry)]),
      );
    }
    return current;
  };
  return visit(value) as ResolvedDemoText<T>;
}

/** One field, for code that holds a single value rather than a record. */
export function demoTextIn(field: DemoTextField, locale: string): string {
  return resolveDemoText(field, locale);
}
