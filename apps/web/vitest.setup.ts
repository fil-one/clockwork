import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => null,
});

// Component unit tests have no Next request. Supply an explicitly settled
// English request fixture; locale isolation is tested separately and in browser tests.
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n");
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
  };
});
