import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formattingLocales, type Locale } from "@/src/i18n";

import { apiReferenceOperations } from "./api-reference";
import { ApiReferencePage } from "./reference-page";

/**
 * The reference in the reader's language.
 *
 * `vitest.setup.ts` settles `@/src/i18n/server` to English for every unit
 * test. This file replaces that with a language chosen per test, the same
 * settled-thenable shape the setup uses so the page's `use()` reads it
 * synchronously.
 */
const reader = vi.hoisted((): { locale: string } => ({ locale: "en" }));

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const { formattingLocales: tags } = await import("@/src/i18n/locales");
  const settled = <T,>(value: T) =>
    Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return {
    getTranslations: () => settled(translatorFor(reader.locale)),
    getLocale: () => settled(reader.locale),
    getFormattingLocale: () =>
      settled(tags[reader.locale as keyof typeof tags]),
  };
});

afterEach(() => {
  reader.locale = "en";
});

function renderIn(locale: Locale): string {
  reader.locale = locale;
  const { container, unmount } = render(
    <ApiReferencePage specHref="/developers/openapi.json" />,
  );
  const text = container.textContent ?? "";
  unmount();
  return text;
}

// Lower-case words of English running text. The contract's own identifiers
// (tags such as "operations", paths such as "/v1/core/payment-sessions") are
// removed first, because the page shows them exactly as the contract writes
// them. German "Handler" and French "session" are words of those languages.
const englishProse =
  /\b(?:the|and|of|is|are|not|this|that|by|operations|contract|credential|required|built)\b/u;

function withoutContractIdentifiers(text: string): string {
  const identifiers = apiReferenceOperations().flatMap((operation) => [
    operation.path,
    ...operation.tags,
    ...operation.parameters.map((parameter) => parameter.name),
    ...operation.requestContentTypes,
  ]);
  return [...new Set(identifiers)]
    .sort((left, right) => right.length - left.length)
    .reduce((rest, identifier) => rest.split(identifier).join(" "), text);
}

describe("the reference in another language", () => {
  it("renders its own words in Japanese and keeps the contract's identifiers", () => {
    reader.locale = "ja";
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "API リファレンス" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("取得できる API 認証情報はまだありません。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "/developers/openapi.json" }),
    ).toHaveAttribute("href", "/developers/openapi.json");
    const rows = screen
      .getAllByRole("row")
      .map((row) => row.textContent ?? "")
      .join("\n");
    for (const operation of apiReferenceOperations()) {
      expect(rows).toContain(operation.path);
      expect(rows).toContain(operation.method);
    }
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("There is no API credential you can hold yet");
    expect(text).not.toContain("What is missing before you can integrate");
    expect(text).not.toContain("operations across");
  });

  it.each(["es", "fr", "de", "ja", "pt", "zh", "ar"] as const)(
    "leaves no English page chrome in %s",
    (locale) => {
      const text = renderIn(locale);
      expect(
        withoutContractIdentifiers(text).match(englishProse)?.[0],
      ).toBeUndefined();
      expect(text).toContain("/developers/openapi.json");
    },
  );

  it("formats counts with the reader's locale", () => {
    const count = apiReferenceOperations().length;
    const text = renderIn("de");
    expect(text).toContain(
      `Die Spezifikation veröffentlicht ${new Intl.NumberFormat(formattingLocales.de).format(count)} Operationen.`,
    );
  });
});
