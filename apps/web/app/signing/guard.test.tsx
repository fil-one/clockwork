import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EmbeddedPage from "./embedded/page";
import RedirectPage from "./redirect/page";

afterEach(() => vi.unstubAllEnvs());

describe("signing entry guard", () => {
  it.each([
    ["redirect", RedirectPage],
    ["embedded", EmbeddedPage],
  ])(
    "gives the %s entry a branded exit without an agreement",
    async (_mode, Page) => {
      vi.stubEnv("NODE_ENV", "production");

      render(await Page({ searchParams: Promise.resolve({}) }));

      expect(
        screen.getByRole("heading", { name: "Choose an agreement first" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Back to agreements" }),
      ).toHaveAttribute("href", "/agreements");
      expect(document.querySelector(".access-card")).not.toBeNull();
      expect(screen.getByAltText("")).toHaveAttribute(
        "src",
        "/brand/fo-wordmark-dark.png",
      );
    },
  );

  it("renders the signing experience once an agreement is chosen", async () => {
    vi.stubEnv("NODE_ENV", "production");

    render(
      await RedirectPage({
        searchParams: Promise.resolve({
          agreementId: "99999999-9999-4999-8999-999999999999",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Review and sign" }),
    ).toBeVisible();
  });
});
