import { describe, expect, it } from "vitest";

import { publicMetadataOrigin } from "./public-origin";

describe("public metadata origin", () => {
  it("prefers the canonical deploy origin over the identity callback", () => {
    expect(
      publicMetadataOrigin({
        CLOCKWORK_CANONICAL_ORIGIN:
          "https://clockwork-commerce-demo.netlify.app/path",
        WORKOS_REDIRECT_URI: "https://identity.example/auth/callback",
      }),
    ).toBe("https://clockwork-commerce-demo.netlify.app");
  });

  it("uses the identity callback origin when no canonical origin exists", () => {
    expect(
      publicMetadataOrigin({
        WORKOS_REDIRECT_URI: "https://commerce.example/auth/callback",
      }),
    ).toBe("https://commerce.example");
  });

  it("falls back locally instead of accepting malformed or credentialed URLs", () => {
    for (const configured of [
      "not a url",
      "javascript:alert(1)",
      "https://user:password@commerce.example/",
    ])
      expect(
        publicMetadataOrigin({ CLOCKWORK_CANONICAL_ORIGIN: configured }),
      ).toBe("http://localhost:3000");
  });
});
