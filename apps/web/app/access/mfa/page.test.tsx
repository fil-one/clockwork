import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import Page from "./page";

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return { getTranslations: () => Promise.resolve(translatorFor("en")) };
});

afterEach(() => vi.unstubAllEnvs());

async function renderWith(error?: string) {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  render(await Page({ searchParams: Promise.resolve(error ? { error } : {}) }));
}

it("asks for a new code once an expired session has been refreshed", async () => {
  await renderWith("expired");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your session expired before the code was checked. Enter the current code again.",
  );
  expect(screen.getByLabelText(/code/i)).toBeRequired();
});

it("keeps unknown errors on the unavailable message", async () => {
  await renderWith("something-else");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Verification is unavailable.",
  );
});

it("preserves a safe Team review destination in the verification form", async () => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
  const returnTo =
    "/internal/team?reviewAction=grant&reviewRole=commerce_admin";
  const { container } = render(
    await Page({
      searchParams: Promise.resolve({ returnTo, error: "invalid" }),
    }),
  );
  expect(container.querySelector('input[name="returnTo"]')).toHaveValue(
    returnTo,
  );
  expect(container.querySelector("form")).toHaveAttribute(
    "action",
    "/access/mfa/verify",
  );
});

it.each([
  "https://attacker.example",
  "//attacker.example",
  ["/internal/team", "/internal/team"],
])(
  "does not render an unsafe or ambiguous destination %j",
  async (returnTo) => {
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
    const { container } = render(
      await Page({ searchParams: Promise.resolve({ returnTo }) }),
    );
    expect(container.querySelector('input[name="returnTo"]')).toBeNull();
  },
);
