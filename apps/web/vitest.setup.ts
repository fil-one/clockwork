import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { setHarnessLanguage } from "@/src/i18n/client";

afterEach(cleanup);

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

// Component unit tests render client components without the root layout's
// LanguageProvider. The harness language stands in for it; the application
// has no such fallback. A test that needs another language wraps its render
// in LanguageProvider, which takes precedence.
setHarnessLanguage("en", catalogs.en);

// Component unit tests have no Next request. Supply an explicitly settled
// English request fixture; locale isolation is tested separately and in browser tests.
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const t = translatorFor("en");
  const translations = Object.assign(Promise.resolve(t), {
    status: "fulfilled",
    value: t,
  });
  return {
    getTranslations: () => translations,
    getLocale: () =>
      Object.assign(Promise.resolve("en"), {
        status: "fulfilled",
        value: "en",
      }),
    getFormattingLocale: () =>
      Object.assign(Promise.resolve("en-US"), {
        status: "fulfilled",
        value: "en-US",
      }),
  };
});
