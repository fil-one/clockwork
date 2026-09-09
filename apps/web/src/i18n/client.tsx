"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, en, type MessageCatalog } from "./en";
import type { Locale } from "./index";

const LanguageContext = createContext<{
  locale: Locale;
  catalog: MessageCatalog;
}>({ locale: "en", catalog: en });

/** The server sends only the selected catalog, not every language to every visitor. */
export function LanguageProvider({
  locale,
  catalog,
  children,
}: {
  locale: Locale;
  catalog: MessageCatalog;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, catalog }), [locale, catalog]);
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useLocale() {
  return useContext(LanguageContext).locale;
}
export function useTranslations() {
  const { catalog } = useContext(LanguageContext);
  return useMemo(() => createTranslator(catalog), [catalog]);
}
