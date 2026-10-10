import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "./catalogs";
import { LanguageProvider } from "./client";
import type { Locale } from "./locales";
import { StaffLanguage } from "./staff-language";

const reader = vi.hoisted((): { locale: Locale } => ({ locale: "en" }));
vi.mock("./server", () => ({
  getReaderLocale: () => Promise.resolve(reader.locale),
}));

type ProviderProps = { children: ReactNode; catalog: unknown; locale: string };

describe("StaffLanguage", () => {
  beforeEach(() => {
    reader.locale = "en";
  });

  it("reuses an English reader's root catalog rather than sending it again", async () => {
    const tree = (await StaffLanguage({ children: "page" })) as ReactElement;
    expect(tree.type).not.toBe(LanguageProvider);
  });

  it("gives other readers the English catalog for the staff subtree", async () => {
    reader.locale = "ja";
    const tree = (await StaffLanguage({
      children: "page",
    })) as ReactElement<ProviderProps>;
    expect(tree.type).toBe(LanguageProvider);
    expect(tree.props.locale).toBe("en");
    expect(tree.props.catalog).toBe(catalogs.en);
  });
});
