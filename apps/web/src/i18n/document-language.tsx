"use client";

import { useLayoutEffect } from "react";

import { documentLanguages, rtlLocales, type Locale } from "./locales";

/**
 * Keeps `<html lang dir>` on a surface's language while the surface is
 * mounted. The root layout survives client-side navigation, so its attributes
 * are those of the first page loaded; a staff page reached from a customer
 * page would otherwise sit inside the customer's `dir="rtl"`, and the reverse
 * would leave a customer page marked English.
 */
export function DocumentLanguage({
  locale,
  readerLocale,
}: {
  locale: Locale;
  readerLocale: Locale;
}) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const set = (language: Locale) => {
      root.lang = documentLanguages[language];
      root.dir = rtlLocales.has(language) ? "rtl" : "ltr";
    };
    set(locale);
    return () => set(readerLocale);
  }, [locale, readerLocale]);
  return null;
}
