import { describe, expect, it } from "vitest";

import { translatorFor } from "@/src/i18n/catalogs";

import { collectionKinds, commercialRecords, recordsFor } from "./model";
import { projectionCompat } from "./projection-compat";
import { commercialDisplay } from "./record-presentation";

/**
 * The compatibility strings are a rendering, not a second source. If a
 * fixture's facts change, the English its projection row carries for readers
 * that do not render facts has to change with them, or the dashboard and the
 * commercial surfaces would describe one record two ways.
 */
describe("projection compatibility strings", () => {
  const en = translatorFor("en");

  it("covers every commercial fixture and nothing else", () => {
    expect(Object.keys(projectionCompat).sort()).toEqual(
      commercialRecords.map((record) => record.id).sort(),
    );
  });

  it.each(collectionKinds)(
    "equal the English rendering of each %s fixture's facts",
    (kind) => {
      for (const record of recordsFor(kind, "en")) {
        const display = commercialDisplay(record, en, "en-US");
        expect(projectionCompat[record.id], record.id).toEqual({
          description: display.description,
          statusLabel: display.statusLabel,
          value: display.value,
          valueLabel: display.valueLabel,
          dateLabel: display.timing,
          term: display.term,
          nextAction: display.nextAction,
        });
      }
    },
  );

  it("renders the same records in another language from the same facts", () => {
    const pt = translatorFor("pt");
    const [quote] = recordsFor("quotes", "pt");
    if (!quote) throw new Error("no quote fixture");
    const display = commercialDisplay(quote, pt, "pt-BR");
    expect(quote.title).toBe("Capacidade contratada corporativa");
    expect(display.statusLabel).toBe("Aberta");
    expect(display.value).toBe("US$ 184.800,00");
    expect(display.timing).toBe("Expira em 4 de ago. de 2026");
    expect(display.nextAction).toBe("Aceitar ou cancelar antes de expirar");
  });
});
