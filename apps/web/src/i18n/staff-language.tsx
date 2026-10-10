import type { ReactNode } from "react";

import { catalogs } from "./catalogs";
import { LanguageProvider } from "./client";
import { DocumentLanguage } from "./document-language";
import { getReaderLocale } from "./server";

/**
 * Staff routes render in English whatever language the reader saved. Server
 * components below learn it from the request (`./route-language.ts`); this
 * gives client components the English catalog and marks the subtree, and the
 * document while it is shown, as English and left-to-right.
 *
 * An English reader's root provider already carries the full English catalog,
 * so this adds a provider only for other languages; a second one would send
 * the catalog again with every client-side navigation to a staff page.
 */
export async function StaffLanguage({ children }: { children: ReactNode }) {
  const readerLocale = await getReaderLocale();
  const english = (
    <>
      <DocumentLanguage locale="en" readerLocale={readerLocale} />
      <div lang="en" dir="ltr" style={{ display: "contents" }}>
        {children}
      </div>
    </>
  );
  if (readerLocale === "en") return english;
  return (
    <LanguageProvider locale="en" catalog={catalogs.en}>
      {english}
    </LanguageProvider>
  );
}
