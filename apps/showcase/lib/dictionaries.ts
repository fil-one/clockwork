import type { Dictionary, Locale } from "./i18n";
const dictionaries = {
  en: () => import("./locales/en.json").then((m) => m.default),
  es: () => import("./locales/es.json").then((m) => m.default),
  fr: () => import("./locales/fr.json").then((m) => m.default),
  de: () => import("./locales/de.json").then((m) => m.default),
  ja: () => import("./locales/ja.json").then((m) => m.default),
  pt: () => import("./locales/pt.json").then((m) => m.default),
  zh: () => import("./locales/zh.json").then((m) => m.default),
  ar: () => import("./locales/ar.json").then((m) => m.default),
};
export const getDictionary = async (locale: Locale): Promise<Dictionary> =>
  dictionaries[locale]();
