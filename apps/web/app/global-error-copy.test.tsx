import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { locales } from "@/src/i18n/locales";

import { globalErrorCopy, globalErrorLocale } from "./global-error-copy";

describe("global error copy", () => {
  it("is the catalog's platform.globalError messages, word for word, in every language", () => {
    for (const locale of locales) {
      const catalog = catalogs[locale];
      expect(globalErrorCopy[locale], locale).toEqual({
        title: catalog["platform.globalError.title"],
        description: catalog["platform.globalError.description"],
        reference: catalog["platform.globalError.reference"],
        retry: catalog["platform.globalError.retry"],
      });
    }
  });

  it("prefers the language of the page that failed, then the browser's", () => {
    expect(globalErrorLocale("pt-BR", ["de-DE"])).toBe("pt");
    expect(globalErrorLocale(undefined, ["xx", "ja-JP"])).toBe("ja");
    expect(globalErrorLocale(undefined, ["en-GB", "fr-FR"])).toBe("en");
    expect(globalErrorLocale(undefined, [])).toBe("en");
  });
});

describe("GlobalError", () => {
  afterEach(() => {
    document.documentElement.lang = "";
    vi.resetModules();
  });

  it("speaks the language the reader chose on the page that failed", async () => {
    document.documentElement.lang = "ar-AE";
    const { default: GlobalError } = await import("./global-error");
    // The boundary renders its own <html>; mount it the way the root does.
    render(
      <GlobalError
        error={Object.assign(new Error("root layout"), { digest: "d-42" })}
        reset={() => {}}
      />,
      { container: document },
    );
    expect(
      await screen.findByRole("heading", { name: "تعذّر تحميل هذه الصفحة" }),
    ).toBeInTheDocument();
    expect(screen.getByText("d-42")).toBeInTheDocument();
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.body.textContent).not.toMatch(/could not be loaded/u);
  });
});
