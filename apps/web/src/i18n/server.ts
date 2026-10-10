import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { translatorFor } from "./catalogs";
import { formattingLocales, localeCookie, resolveLocale } from "./locales";
import { routeLocale } from "./route-language";

// React cache is request-scoped: one visitor's preference cannot leak to another.
/**
 * The language the reader saved. The root layout uses it for the document, so
 * a client-side navigation between staff and customer pages, which keeps the
 * root layout, never strands a customer page in English.
 */
export const getReaderLocale = cache(async () =>
  resolveLocale((await cookies()).get(localeCookie)?.value),
);
/** The language this request renders in: English on staff routes. */
export const getLocale = cache(async () =>
  routeLocale(await getReaderLocale(), await headers()),
);
export const getTranslations = cache(async () =>
  translatorFor(await getLocale()),
);
/** The tag numbers, amounts and dates are formatted with for this reader. */
export const getFormattingLocale = cache(
  async () => formattingLocales[await getLocale()],
);
