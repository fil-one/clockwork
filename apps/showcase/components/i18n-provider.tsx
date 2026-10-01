"use client";
import { createContext, useContext, useMemo } from "react";
import { formattingLocales, localizedHref, translator } from "../lib/i18n";
import type { Dictionary, Locale } from "../lib/i18n";
const Context = createContext<{
  locale: Locale;
  dictionary: Dictionary;
} | null>(null);
export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <Context.Provider value={{ locale, dictionary }}>
      {children}
    </Context.Provider>
  );
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing locale provider");
  const { locale, dictionary } = context;
  return useMemo(
    () => ({
      locale,
      t: translator(dictionary, locale),
      href: (path: string) => localizedHref(path, locale),
      number: (value: number) =>
        new Intl.NumberFormat(formattingLocales[locale]).format(value),
      percent: (value: number) =>
        new Intl.NumberFormat(formattingLocales[locale], {
          style: "percent",
        }).format(value),
      money: (amount: number, decimals = 0) =>
        new Intl.NumberFormat(formattingLocales[locale], {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(amount),
    }),
    [locale, dictionary],
  );
}
