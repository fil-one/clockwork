import { expect, it } from "vitest";
import { commerceCanonicalRedirect } from "./commerce-canonical-redirect";

it("preserves navigation paths and queries on the new product origin", () => {
  expect(
    commerceCanonicalRedirect(
      {
        url: "https://clockwork.fil.one/internal/mndas?view=sent",
        method: "GET",
      },
      "https://commerce.fil.one",
    )?.href,
  ).toBe("https://commerce.fil.one/internal/mndas?view=sent");
});

it.each([
  ["https://clockwork.fil.one/internal/mndas", "POST"],
  ["https://clockwork.fil.one/auth/callback?code=in-flight", "GET"],
  ["https://clockwork.fil.one/api/v1/webhooks/signwell", "POST"],
  ["https://clockwork.fil.one/api/v1/health", "GET"],
  ["https://clockwork.fil.one/healthcheck", "GET"],
  ["https://commerce.fil.one/internal/mndas", "GET"],
  ["https://clockwork-staging.fil.one/internal/mndas", "GET"],
  ["https://untrusted.example/internal/mndas", "GET"],
])(
  "leaves callbacks, mutations and other origins alone: %s %s",
  (url, method) => {
    expect(
      commerceCanonicalRedirect({ url, method }, "https://commerce.fil.one"),
    ).toBeUndefined();
  },
);

it("does not redirect until the canonical origin is enabled", () => {
  expect(
    commerceCanonicalRedirect(
      { url: "https://clockwork.fil.one/internal", method: "GET" },
      "https://clockwork.fil.one",
    ),
  ).toBeUndefined();
});
