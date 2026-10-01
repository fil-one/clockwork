import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { demoLanguageHandoff } from "./demo-language-handoff";
describe("sales demo language handoff", () => {
  it("preserves persona destination and sets language before the access gate", () => {
    const response = demoLanguageHandoff(
      new NextRequest(
        "https://demo.example/demo/persona?persona=reseller&lang=ar",
      ),
      true,
    );
    expect(response?.headers.get("location")).toBe(
      "https://demo.example/demo/persona?persona=reseller",
    );
    expect(response?.cookies.get("clockwork-language")?.value).toBe("ar");
    expect(response?.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response?.headers.get("set-cookie")).toContain("Secure");
    expect(response?.cookies.has("clockwork-demo-access")).toBe(false);
  });
  it.each([
    "/demo?lang=xx",
    "/internal?lang=fr",
    "/demo?lang=https://evil.example",
    "/api/demo/reset?lang=fr",
  ])(
    "does not rewrite out-of-scope paths or unsupported locales: %s",
    (path) => {
      expect(
        demoLanguageHandoff(
          new NextRequest(`https://demo.example${path}`),
          true,
        ),
      ).toBeUndefined();
    },
  );
  it("does nothing outside the opted-in demo", () => {
    expect(
      demoLanguageHandoff(
        new NextRequest("https://demo.example/demo?lang=fr"),
        false,
      ),
    ).toBeUndefined();
  });
});
