import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import Page from "./page";

// The page reads the request's language through the server translator; this
// request is a Portuguese reader's.
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const settled = <T,>(value: T) =>
    Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return {
    getTranslations: () => settled(translatorFor("pt")),
    getLocale: () => settled("pt"),
    getFormattingLocale: () => settled("pt-BR"),
  };
});

afterEach(() => vi.unstubAllEnvs());

function Portuguese({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider locale="pt" catalog={catalogs.pt}>
      {children}
    </LanguageProvider>
  );
}

describe("demo persona picker", () => {
  it("shows every persona's job title and task in the reader's language", () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    render(<Page />, { wrapper: Portuguese });

    const mara = screen
      .getByRole("link", { name: "Começar como Mara Voss" })
      .closest("li");
    expect(mara).not.toBeNull();
    const row = within(mara as HTMLElement);
    expect(row.getByText("Diretora de operações")).toBeVisible();
    expect(
      row.getByText(
        "Aceitar a cotação de renovação antes do início do aviso prévio.",
      ),
    ).toBeVisible();
    // Names and company names are facts and stay as written.
    expect(row.getByText("Meridian Archive Labs")).toBeVisible();

    const text = document.body.textContent ?? "";
    for (const english of [
      "Operations Director",
      "Operations director",
      "Alliance Manager",
      "Finance Controller",
      "Accept the renewal quote",
      "Recover a failed provisioning run",
      "Start as",
    ])
      expect(text).not.toContain(english);
  });
});
