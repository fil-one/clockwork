import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";
import { formattingLocales, type Locale } from "@/src/i18n/locales";

import { TrustPage } from "./trust-page";
import {
  tokenDistinctivenessCeiling,
  trustControls,
  trustGaps,
  trustIntegrations,
  trustStatement,
  trustUnselectedIntegrations,
} from "./trust-register";

/**
 * The trust page in the reader's language.
 *
 * vitest.setup.ts settles the server translator on English for every other
 * test. This file replaces that mock with one whose language each test picks,
 * so the page is rendered exactly as a reader with that preference receives it.
 *
 * Confirmed to fail against the unmigrated page: putting the third lede
 * paragraph back as hard-coded English and rendering control statements with
 * the English translator fails "renders every sentence in the reader's
 * language" and "keeps no English sentence" in all seven languages (14 of 28).
 */
const language = vi.hoisted((): { current: Locale } => ({ current: "de" }));

vi.mock("@/src/i18n/server", async () => {
  const catalogs = await import("@/src/i18n/catalogs");
  const locales = await import("@/src/i18n/locales");
  const settled = <T,>(value: T) =>
    Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return {
    getTranslations: () => settled(catalogs.translatorFor(language.current)),
    getLocale: () => settled(language.current),
    getFormattingLocale: () =>
      settled(locales.formattingLocales[language.current]),
  };
});

const translated: readonly Exclude<Locale, "en">[] = [
  "es",
  "fr",
  "de",
  "ja",
  "pt",
  "zh",
  "ar",
];

/** Text as a reader sees it: the right-to-left isolate marks are invisible. */
function visible(text: string): string {
  return text.replace(/[\u2068\u2069]/gu, "");
}

describe.each(translated)("trust page in %s", (locale) => {
  beforeEach(() => {
    language.current = locale;
  });
  const t = translatorFor(locale);

  it("renders every sentence in the reader's language", () => {
    const text = visible(render(<TrustPage />).container.textContent ?? "");
    for (const id of [
      "platform.trust.title",
      "platform.trust.lede.numbers",
      "platform.trust.lede.judgement",
      "platform.trust.footnote",
    ] as const)
      expect(text, id).toContain(visible(t(id)));
    for (const entry of [...trustControls, ...trustGaps])
      expect(text, entry.id).toContain(
        visible(trustStatement(entry.statement, t)),
      );
    for (const entry of trustIntegrations)
      expect(text, entry.name).toContain(visible(t(entry.purpose)));
    for (const entry of trustUnselectedIntegrations)
      expect(text, entry.capability).toContain(visible(t(entry.capability)));
    for (const gap of trustGaps)
      expect(text).toContain(
        visible(t("platform.trust.gaps.requires", { gate: gap.gate })),
      );
  });

  it("formats the distinctiveness ceiling for the reader", () => {
    const text = visible(render(<TrustPage />).container.textContent ?? "");
    const share = new Intl.NumberFormat(formattingLocales[locale], {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(tokenDistinctivenessCeiling);
    expect(text).toContain(share);
  });

  it("prints paths, gate keys and vendor names exactly as the source does", () => {
    const text = render(<TrustPage />).container.textContent ?? "";
    for (const control of trustControls) {
      expect(text).toContain(control.evidencePath);
      for (const citation of control.alsoCites ?? [])
        expect(text).toContain(citation.path);
    }
    for (const entry of trustIntegrations) expect(text).toContain(entry.name);
    for (const entry of trustUnselectedIntegrations)
      expect(text).toContain(entry.gate);
    expect(visible(text)).toContain("/v1/webhooks/");
  });

  it("keeps no English sentence", () => {
    const text = render(<TrustPage />).container.textContent ?? "";
    for (const english of [
      "What the build cannot check at all",
      "That last check is weaker than it sounds",
      "This page publishes no certification",
      "Where to check it",
      "What this page does not claim",
      "Requires EXT-",
      "is exempt from",
      "Every state-changing API request",
    ])
      expect(text, english).not.toContain(english);
  });
});
