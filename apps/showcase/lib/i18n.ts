import type en from "./locales/en.json";
import type { Route } from "next";
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
export type MessageId = keyof typeof en;
export type Dictionary = Record<MessageId, string>;
export type Translator = (
  key: MessageId,
  values?: Readonly<Record<string, string | number>>,
) => string;
export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  pt: "Português",
  zh: "简体中文",
  ar: "العربية",
};
export const formattingLocales: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  pt: "pt-BR",
  zh: "zh-CN",
  ar: "ar-AE",
};
export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}
export function translator(dictionary: Dictionary, locale: Locale): Translator {
  return (key, values = {}) => {
    const template = dictionary[key];
    if (typeof template !== "string")
      throw new Error(`Missing ${locale} message: ${key}`);
    return template.replace(
      /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
      (_match: string, name: string) => {
        const value = values[name];
        if (value === undefined)
          throw new Error(`Missing interpolation ${name} in ${key}`);
        const text = String(value);
        return locale === "ar" ? `\u2068${text}\u2069` : text;
      },
    );
  };
}
export function localizedHref(path: string, locale: Locale): Route {
  if (path.startsWith("https://clockwork-commerce-demo.netlify.app")) {
    const url = new URL(path);
    url.searchParams.set("lang", locale);
    return url.href as Route;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return path as Route;
  return `/${locale}${path === "/" ? "" : path.startsWith("/#") ? path.slice(1) : path}` as Route;
}
export function preferredLocale(
  cookie: string | undefined,
  accept: string | null,
): Locale {
  if (cookie && isLocale(cookie)) return cookie;
  const preferences = (accept ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      const quality = q ? Number(q.trim().slice(2)) : 1;
      return {
        locale: tag?.split("-")[0]?.toLowerCase() ?? "",
        quality:
          Number.isFinite(quality) && quality > 0 && quality <= 1 ? quality : 0,
      };
    })
    .filter((item) => item.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const item of preferences) if (isLocale(item.locale)) return item.locale;
  return "en";
}
