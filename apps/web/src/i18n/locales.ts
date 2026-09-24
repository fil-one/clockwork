/**
 * Locale metadata. This module holds no messages, so client components can
 * import it without pulling every catalog into the browser bundle.
 */
export const locales = [
  "en",
  "es",
  "fr",
  "de",
  "ja",
  "pt",
  "zh",
  "ar",
] as const;
export type Locale = (typeof locales)[number];

export const localeCookie = "clockwork-language";
/**
 * The preference lives one year in this browser and is independent of
 * organization, role and session. `secure` is decided by each writer, which
 * knows whether it is answering a production request.
 */
export const localeCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export const languageNames: Readonly<Record<Locale, string>> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  pt: "Português (Brasil)",
  zh: "简体中文",
  ar: "العربية (الخليج)",
};

/**
 * The BCP-47 tag every number, amount, date and plural category is formatted
 * with for a given interface language. The interface language governs
 * formatting; the account governs currency and time zone.
 */
export const formattingLocales: Readonly<Record<Locale, string>> = {
  en: "en-US",
  es: "es",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  pt: "pt-BR",
  zh: "zh-Hans-CN",
  ar: "ar-AE",
};

/** The value for `<html lang>`; regional where the product commits to a region. */
export const documentLanguages: Readonly<Record<Locale, string>> = {
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  ja: "ja",
  pt: "pt-BR",
  zh: "zh-Hans",
  ar: "ar-AE",
};

export const rtlLocales: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(languageNames, value);
}

export function resolveLocale(value: string | undefined | null): Locale {
  const language = value?.toLowerCase().split(/[-_]/u)[0];
  return isLocale(language) ? language : "en";
}

/**
 * Formatting tag for an interface language, keeping a regional variant the
 * account or persona states when it is the same language.
 *
 * A reseller in London reading the English interface keeps `en-GB` dates and
 * grouping; the same reseller reading Portuguese gets `pt-BR`, because the
 * words on the page and the shape of the numbers beside them must agree.
 */
export function formattingLocaleFor(
  locale: Locale,
  regional?: string | null,
): string {
  if (regional && resolveLocale(regional) === locale) {
    try {
      return Intl.getCanonicalLocales(regional)[0] ?? formattingLocales[locale];
    } catch {
      return formattingLocales[locale];
    }
  }
  return formattingLocales[locale];
}
