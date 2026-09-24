import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import type { Locale } from "@/src/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { OrderAcceptance } from "./order-acceptance";

function renderIn(locale: Locale, withQuote: boolean) {
  return render(
    <LanguageProvider catalog={catalogs[locale]} locale={locale}>
      <OrderAcceptance
        account={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Northstar Archive Labs",
        }}
        agreement={null}
        quote={
          withQuote
            ? {
                id: "40000000-0000-4000-8000-000000000001",
                reference: "Q-2026-0165-v2",
                title: "Renovação da réplica de conformidade",
                version: "2",
                scope: "120 TB · Sul do Reino Unido · anual · venda direta",
                spend: "US$ 55.440,00",
                acceptedLabel: "Aceita em 25 de jul. de 2026",
              }
            : null
        }
        signerUserId="20000000-0000-4000-8000-000000000002"
      />
    </LanguageProvider>,
  );
}

describe("order acceptance in the reader's language", () => {
  /**
   * Every language used to say acceptance starts from an *accepted* quote
   * (pt "uma proposta aceita", de "angenommenen Angebot", ja 受諾済み), which
   * is the opposite of the rule: only an issued quote can be accepted, and an
   * accepted one already has an order.
   */
  it("says acceptance starts from an issued quote", () => {
    renderIn("pt", false);
    const unavailable = screen.getByRole("alert");
    expect(unavailable).not.toHaveTextContent(/(cotação|proposta) aceita/u);
    expect(unavailable).toHaveTextContent(
      "A aceitação do pedido parte de uma cotação emitida desta conta.",
    );
  });

  it("does not compose a governing agreement when none is recorded", () => {
    renderIn("de", true);
    const row = screen.getByText("Maßgebliche Vereinbarung").parentElement;
    expect(row).toHaveTextContent(
      "Für dieses Konto ist keine gültige maßgebliche Vereinbarung erfasst.",
    );
    expect(row).not.toHaveTextContent("Version");
    expect(
      screen.getByText(/Die Auftragsbedingungen stammen/u),
    ).toHaveTextContent(
      "Für dieses Konto ist keine maßgebliche Vereinbarung erfasst.",
    );
  });
});
