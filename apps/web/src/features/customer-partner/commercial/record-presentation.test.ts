import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";
import { formattingLocales, type Locale } from "@/src/i18n";

import { recordById, type CommercialRecord } from "./model";
import { commercialDisplay } from "./record-presentation";

function display(id: string, locale: Locale) {
  const record = recordById(id, locale);
  if (!record) throw new Error(`no fixture ${id}`);
  return commercialDisplay(
    record,
    translatorFor(locale),
    formattingLocales[locale],
  );
}

describe("commercial records rendered from facts", () => {
  it("formats amounts and dates for the reader, not for the fixture", () => {
    expect(display("Q-2026-0184-v3", "de")).toMatchObject({
      statusLabel: "Offen",
      value: "184.800,00 $",
      valueLabel: "Geschätzte Jahresausgaben",
      timing: "Läuft am 04.08.2026 ab",
      nextAction: "Vor Ablauf annehmen oder stornieren",
    });
    expect(display("Q-2026-0184-v3", "ja").timing).toBe("有効期限 2026/08/04");
  });

  it("agrees each status with its collection's noun", () => {
    // A quote is feminine in Portuguese, a proof of concept feminine in
    // Spanish and French, an agreement is "in force" rather than "active".
    expect(display("Q-2026-0184-v3", "pt").statusLabel).toBe("Aberta");
    expect(display("POC-2026-0031", "es").statusLabel).toBe("Activa");
    expect(display("POC-2026-0024", "fr").statusLabel).toBe("Terminée");
    expect(display("AGR-2026-0042", "de").statusLabel).toBe("In Kraft");
    expect(display("SVC-PRIMARY-01", "ar").statusLabel).toBe("نشطة");
  });

  it("keeps the invoiced amount distinct from any estimate", () => {
    const invoice = display("INV-2026-0781", "fr");
    expect(invoice.valueLabel).toBe("Montant facturé");
    expect(invoice.timing).toContain("Échéance le");
    expect(display("Q-2026-0171-v1", "fr").valueLabel).toBe(
      "Dépense annuelle estimée",
    );
  });

  it("uses Arabic plural forms rather than one noun for every count", () => {
    // Seven takes the "few" form; the count is isolated inside RTL text.
    expect(display("POC-2026-0031", "ar").value).toBe(
      "تتبقى \u20687\u2069 أيام",
    );
  });

  it("follows a status an action moved the record to, not the fixture's", () => {
    const record = recordById("POC-2026-0024", "pt");
    if (!record) throw new Error("no fixture");
    // A writer that persists the new status and nothing else.
    const moved: CommercialRecord = {
      ...record,
      status: "converted",
      updatedAt: "2026-08-02T10:00:00.000Z",
    };
    expect(
      commercialDisplay(moved, translatorFor("pt"), "pt-BR"),
    ).toMatchObject({
      statusLabel: "Convertida em cotação paga",
      nextAction: "Revisar a cotação de conversão emitida",
      timing: "Atualizado em 2 de ago. de 2026",
      // The facts that do not depend on status still stand.
      value: "Pronta para conversão",
    });
  });

  /**
   * The demo's tax step rewrites an invoice's amount to the total including
   * tax. Rendering the fixture's net amount from facts over it would show the
   * reader an invoiced amount the invoice does not carry.
   */
  it("shows a string a later writer replaced, not the stale fact", () => {
    const record = recordById("INV-2026-0781", "de");
    if (!record) throw new Error("no fixture");
    const taxed: CommercialRecord = {
      ...record,
      value: "16.555,00\u00a0$",
      valueLabel: "Invoiced amount (incl. tax)",
      statusLabel: "Paid · demo sandbox",
      status: "paid",
    };
    const shown = commercialDisplay(taxed, translatorFor("de"), "de-DE");
    expect(shown.value).toBe("16.555,00\u00a0$");
    expect(shown.valueLabel).toBe("Invoiced amount (incl. tax)");
    expect(shown.statusLabel).toBe("Paid · demo sandbox");
    expect(shown.valueSort).toBeNull();
    // Untouched fields still render from facts.
    expect(shown.term).toBe("Leistungszeitraum 01.–31.07.2026");
  });

  it("shows a record without facts exactly as it arrived", () => {
    const record = recordById("Q-2026-0184-v3", "en");
    if (!record) throw new Error("no fixture");
    const production: CommercialRecord = { ...record };
    delete production.facts;
    const shown = commercialDisplay(
      { ...production, statusLabel: "Issued · awaiting acceptance" },
      translatorFor("es"),
      "es-ES",
    );
    expect(shown.statusLabel).toBe("Issued · awaiting acceptance");
    expect(shown.valueSort).toBeNull();
  });

  it("names the created-order link in the reader's language", () => {
    const record = recordById("ORD-2026-0098", "en");
    if (!record) throw new Error("no fixture");
    const created: CommercialRecord = { ...record };
    delete created.facts;
    expect(
      commercialDisplay(
        {
          ...created,
          nextActionHref: "/orders/order-1",
          nextAction: "Track your order",
        },
        translatorFor("zh"),
        "zh-Hans-CN",
      ).nextAction,
    ).toBe("跟踪订单");
  });
});
