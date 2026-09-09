import { createTranslator, en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

import { de } from "./de";
import { ja } from "./ja";
import { pt } from "./pt";
import { zh } from "./zh";
import { ar } from "./ar";

export const catalogs = { en, es, fr, de, ja, pt, zh, ar } as const;
export type Locale = keyof typeof catalogs;
export const localeCookie = "clockwork-language";
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
export function resolveLocale(value: string | undefined | null): Locale {
  const language = value?.toLowerCase().split(/[-_]/u)[0];
  return language && Object.hasOwn(catalogs, language)
    ? (language as Locale)
    : "en";
}
export function translatorFor(locale: string) {
  return createTranslator(catalogs[resolveLocale(locale)]);
}
export * from "./en";

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
