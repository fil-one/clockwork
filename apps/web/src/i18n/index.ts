import { createTranslator, en, type MessageCatalog } from "./en";

export const catalogs: Readonly<Record<string, MessageCatalog>> = { en };

export function translatorFor(locale: string) {
  return createTranslator(catalogs[locale] ?? en);
}

// A later Spanish catalog is additive: register `es` with the same MessageCatalog
// shape without changing feature components or formatter storage semantics.
export * from "./en";
