import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { demoAccountIds } from "@clockwork/testing/personas";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "@/src/i18n/locales";

/**
 * The request's interface language, as the language cookie would carry it.
 * The global test setup answers every request in English; this file needs to
 * change it per test.
 */
const request = vi.hoisted((): { language: Locale } => ({ language: "en" }));

vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  const { formattingLocales } = await import("@/src/i18n/locales");
  const settled = <T>(value: T) =>
    Object.assign(Promise.resolve(value), { status: "fulfilled", value });
  return {
    getLocale: () => settled(request.language),
    getTranslations: () => settled(translatorFor(request.language)),
    getFormattingLocale: () => settled(formattingLocales[request.language]),
  };
});

import { formatMoney } from "@/src/features/shared/format";

import { ExplicitDemoProjectionSource } from "./projection-source";

const session = {} as SessionClaims;
const direct = demoAccountIds.direct;
const now = new Date("2026-07-31T16:00:00Z");

function readAs(language: Locale) {
  request.language = language;
  return language;
}

beforeEach(() => {
  request.language = "en";
});

/** Words that mean the record was left in English. */
const english =
  /\b(?:Issued|awaiting|acceptance|Estimated|annual|spend|Expires|notice|window|opens|Accept|before|Overdue|payment|retry|available|Invoice|first|attempt|returned|Due|days|overdue|Service|period|Retry|change|method)\b/u;

describe("the demo read boundary renders fixtures for the reader", () => {
  it("shows the direct buyer's renewal quote wholly in Portuguese", async () => {
    const locale = readAs("pt");
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const quote = await source.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: direct,
      recordKey: "quote-direct-renewal-v2",
      now,
      locale,
    });

    expect(quote.data).toMatchObject({
      title: "Renovação anual · capacidade contratada",
      description: "400 TB · Leste dos EUA · 12 meses · renovação direta",
      statusLabel: "Emitida · aguardando aceite",
      value: formatMoney("18480000", "USD", "pt-BR"),
      valueLabel: "Gasto anual estimado",
      dateLabel: "Expira em 28 de ago.",
      nextAction: "Aceitar antes do início do prazo de aviso prévio",
    });
    for (const field of [
      "title",
      "description",
      "statusLabel",
      "valueLabel",
      "dateLabel",
      "term",
      "nextAction",
    ])
      expect(String(quote.data[field]), field).not.toMatch(english);
    // Facts stay facts: the dashboard orders by them, in every language.
    expect(quote.data.authoritative).toMatchObject({
      revision: 2,
      expiresAt: "2026-08-28T23:59:59.000Z",
    });
  });

  it("keeps an invoice reference whole inside an Arabic sentence", async () => {
    const locale = readAs("ar");
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const invoice = await source.find({
      session,
      audience: "customer",
      channel: "billing",
      accountId: direct,
      recordKey: "invoice-meridian-overdue",
      now,
      locale,
    });

    expect(invoice.data.description).toBe(
      "الفاتورة \u2068INV-MER-0042\u2069 · أُعيدت أول محاولة خصم عبر ACH",
    );
    expect(String(invoice.data.dateLabel)).toContain("متأخرة منذ");
    expect(String(invoice.data.statusLabel)).not.toMatch(english);
  });

  it("stores an action's labels as messages, so the next reader gets their own language", async () => {
    const store = createMemoryDemoStore();
    const portuguese = new ExplicitDemoProjectionSource(store);
    const locale = readAs("pt");
    const quote = await portuguese.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: direct,
      recordKey: "Q-2026-0184-v3",
      now,
      locale,
    });
    await portuguese.action({
      session,
      projectionId: quote.id,
      recordKey: quote.recordKey,
      audience: "customer",
      channel: "quotes",
      accountId: direct,
      action: "accept",
      expectedVersion: quote.version,
      idempotencyKey: "language-accept-0001",
      payload: {},
      requestId: "language-accept-request-0001",
    });

    // What was persisted names the message; it is nobody's rendering of it.
    const stored = (await store.read()).projectionOverrides[quote.id];
    expect(stored?.data.statusLabel).toEqual({
      $demoMessage: "status.quote.accepted",
    });
    expect(JSON.stringify(stored?.data)).not.toMatch(/Aceit|Accepted/u);

    const german = readAs("de");
    const reread = await new ExplicitDemoProjectionSource(store).find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: direct,
      recordKey: "Q-2026-0184-v3",
      now,
      locale: german,
    });
    expect(reread.data).toMatchObject({
      status: "accepted",
      statusLabel: "Angenommen",
      nextAction: "Mit der erfassten Auftragsannahme fortfahren",
    });
  });

  it("uses the request's language when the caller names none", async () => {
    // `delivery.ts` reads a record's documents without passing a language, and
    // `action` re-reads the record the same way. A default of English gave
    // those reads English demo text and US number formatting.
    readAs("de");
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const invoice = await source.find({
      session,
      audience: "customer",
      channel: "billing",
      accountId: direct,
      recordKey: "invoice-meridian-overdue",
      now,
    });

    expect(invoice.data).toMatchObject({
      title: "Vertraglich zugesagte Kapazität · überfällig",
      value: formatMoney("1713250", "USD", "de-DE"),
      valueLabel: "Rechnungsbetrag (inkl. Steuern)",
    });
    expect(invoice.data.artifacts).toEqual([
      expect.objectContaining({
        kind: "invoice_companion",
        label: "Rechnung INV-MER-0042 (überfällig)",
      }),
    ]);
  });

  it("gives the direct account's open quotes and invoices due dates as facts", async () => {
    const source = new ExplicitDemoProjectionSource(createMemoryDemoStore());
    const due = async (channel: "quotes" | "billing", language: Locale) => {
      const page = await source.list({
        session,
        audience: "customer",
        channel,
        accountId: direct,
        limit: 100,
        now,
        locale: readAs(language),
      });
      return Object.fromEntries(
        page.items
          .filter((record) => record.data.status === "open")
          .map((record) => {
            const facts = record.data.authoritative as
              Record<string, unknown> | undefined;
            return [record.recordKey, facts?.expiresAt ?? facts?.dueAt ?? null];
          }),
      );
    };

    for (const channel of ["quotes", "billing"] as const) {
      const english = await due(channel, "en");
      expect(Object.values(english)).not.toContain(null);
      for (const language of ["pt", "ja", "ar"] as const)
        expect(await due(channel, language)).toEqual(english);
    }
  });
});
