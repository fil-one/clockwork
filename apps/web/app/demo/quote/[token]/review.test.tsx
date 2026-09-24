import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "@/src/i18n";
import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import { ClientQuoteReview } from "./review";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const quote = {
  name: "Archivspeicher Lumen 2027",
  version: 3,
  lines: [
    { sku: "FIL-ARCHIVE", region: "us-east", quantity: "250", termMonths: 12 },
    { sku: "FIL-HOT", region: "ap-south", quantity: "1", termMonths: 1 },
  ],
  total: { currency: "EUR", minor: "840000" },
  expiresAt: "2026-10-23T00:00:00.000Z",
  sellerName: "Ember Peak Systems",
};

function inLanguage(locale: Locale) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <LanguageProvider locale={locale} catalog={catalogs[locale]}>
        {children}
      </LanguageProvider>
    );
  };
}

describe("client quote review", () => {
  it("states lines, total and validity in the reader's language", () => {
    render(<ClientQuoteReview token="t" quote={quote} />, {
      wrapper: inLanguage("de"),
    });
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      "250 TB · FIL-ARCHIVE · USA Ost · 12 Monate",
      // An unknown region is an identifier and stays as written.
      "1 TB · FIL-HOT · ap-south · 1 Monat",
    ]);
    expect(screen.getByText("8.400,00 €")).toBeVisible();
    expect(
      screen.getByText("Überarbeitung 3 · Gültig bis 23.10.2026"),
    ).toBeVisible();
    expect(
      screen.getByText(/ist der Verkäufer und übernimmt Kaufabwicklung/u),
    ).toHaveTextContent(
      "Ihr Partner Ember Peak Systems ist der Verkäufer und übernimmt Kaufabwicklung und Rechnungsstellung.",
    );
    expect(document.body.textContent).not.toMatch(/months|Revision|quotation/u);
  });

  it("says who responded and when, in the reader's language", () => {
    render(
      <ClientQuoteReview
        token="t"
        quote={{
          ...quote,
          response: {
            decision: "request_changes",
            name: "Nora Chen",
            note: "Bitte 24 Monate anbieten.",
            at: "2026-09-23T14:05:00.000Z",
          },
        }}
      />,
      { wrapper: inLanguage("ja") },
    );
    expect(
      screen.getByRole("heading", { name: "変更依頼を受け付けました" }),
    ).toBeVisible();
    expect(screen.getByText(/^Nora Chen が .+ に送信$/u)).toBeVisible();
  });

  it("words a refused response from its code, never from server text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "describeChanges",
            detail: "Describe the changes you need.",
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ClientQuoteReview token="t" quote={quote} />, {
      wrapper: inLanguage("fr"),
    });
    await user.type(screen.getByLabelText("Votre nom"), "Nora Chen");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Envoyer la réponse au partenaire" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Décrivez les modifications dont vous avez besoin.",
      ),
    );
  });
});
