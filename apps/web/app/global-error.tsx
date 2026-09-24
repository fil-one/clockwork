"use client";

import { useEffect, useState } from "react";

import { documentLanguages, type Locale } from "@/src/i18n/locales";

import {
  globalErrorCopy,
  globalErrorLocale,
  isRightToLeft,
} from "./global-error-copy";

/**
 * The language of the page this boundary replaced, read once when the bundle
 * loads. The root layout wrote the reader's choice into `<html lang>`; this
 * boundary renders its own `<html>` and would otherwise erase it. The marker
 * attribute tells a document that already is this boundary apart from a page.
 */
const pageLanguage =
  typeof document === "undefined" ||
  document.documentElement.hasAttribute("data-global-error")
    ? undefined
    : document.documentElement.lang || undefined;

/**
 * Last-resort boundary for an error thrown in the root layout itself.
 *
 * It must render its own `html` and `body` because the failing layout never
 * produced them, and it cannot rely on the design system or the locale catalog
 * for the same reason. Its words come from `global-error-copy.ts`, a copy of
 * the catalog's `platform.globalError.*` messages held equal by a test. The
 * first paint is English (the server cannot know the language here); the
 * reader's language follows as soon as the page is interactive.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    setLocale(globalErrorLocale(pageLanguage, navigator.languages ?? []));
  }, []);
  useEffect(() => {
    console.error("Root layout error", { digest: error.digest }); // i18n-exempt: console diagnostic
  }, [error]);
  const copy = globalErrorCopy[locale];
  const [beforeReference = "", afterReference = ""] =
    copy.reference.split("{reference}");
  return (
    <html
      lang={documentLanguages[locale]}
      dir={isRightToLeft(locale) ? "rtl" : "ltr"}
      data-global-error=""
    >
      <body>
        <main id="main-content">
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          {error.digest ? (
            <p>
              {beforeReference}
              <code>
                <bdi>{error.digest}</bdi>
              </code>
              {afterReference}
            </p>
          ) : null}
          <button type="button" onClick={reset}>
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
