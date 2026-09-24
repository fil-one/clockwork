"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MessageCatalog, Translator } from "./catalogs";
import { formattingLocales, type Locale } from "./locales";
import { createTranslator } from "./translator";

interface Language {
  locale: Locale;
  catalog: MessageCatalog;
}

const LanguageContext = createContext<Language | null>(null);

/**
 * The language a component rendered outside `LanguageProvider` falls back to.
 * Only test and story harnesses set it (`vitest.setup.ts`); in the application
 * every client component is inside the root layout's provider, and one that is
 * not fails loudly rather than rendering English to a reader who chose Arabic.
 */
let harnessLanguage: Language | null = null;
export function setHarnessLanguage(locale: Locale, catalog: MessageCatalog) {
  harnessLanguage = { locale, catalog };
}

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

function useLanguage(): Language {
  const language = useContext(LanguageContext) ?? harnessLanguage;
  if (!language)
    throw new Error(
      "useTranslations and useLocale need a LanguageProvider above them",
    );
  return language;
}

export function useLocale(): Locale {
  return useLanguage().locale;
}

/** The BCP-47 tag numbers, amounts and dates are formatted with. */
export function useFormattingLocale(): string {
  return formattingLocales[useLanguage().locale];
}

export function useTranslations(): Translator {
  const { catalog, locale } = useLanguage();
  return useMemo(() => createTranslator(catalog, locale), [catalog, locale]);
}
