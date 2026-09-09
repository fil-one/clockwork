import { beforeEach, describe, expect, it, vi } from "vitest";
const { set } = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ set }) }));
import { saveLanguage } from "./actions";

beforeEach(() => set.mockClear());
describe("language preference", () => {
  for (const language of ["en", "es", "fr", "de", "ja", "pt", "zh", "ar"]) {
    it(`persists ${language} with a bounded browser preference cookie`, async () => {
      const form = new FormData();
      form.set("language", language);
      expect(await saveLanguage({ saved: false, error: false }, form)).toEqual({
        saved: true,
        error: false,
      });
      expect(set).toHaveBeenCalledWith(
        "clockwork-language",
        language,
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 31536000,
        }),
      );
    });
  }
  for (const language of [
    "",
    "constructor",
    "__proto__",
    "es; Secure",
    "../ar",
    "xx",
  ]) {
    it(`rejects unsupported cookie content ${language}`, async () => {
      const form = new FormData();
      form.set("language", language);
      expect(await saveLanguage({ saved: false, error: false }, form)).toEqual({
        saved: false,
        error: true,
      });
      expect(set).not.toHaveBeenCalled();
    });
  }
});
