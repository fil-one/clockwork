import { describe, expect, it } from "vitest";

import {
  createCanonicalPortalProjectionDefinitions,
  type AuthoritativeProjectionState,
} from "@clockwork/workflows";

import { translatorFor } from "@/src/i18n/catalogs";
import { formattingLocales, type Locale } from "@/src/i18n";

import type { ProjectionRecord } from "./model";
import {
  localizedAcceptedOrderRecord,
  localizedProductionRecord,
} from "./projection-display";

const now = new Date("2026-09-20T12:00:00.000Z");

function context(locale: Locale) {
  return {
    t: translatorFor(locale),
    locale: formattingLocales[locale],
    now,
  };
}

const topics: Readonly<Record<string, string>> = {
  quote: "core.quotes.issue",
  invoice: "core.invoices.create",
  agreement: "agreement.executed",
  exception_case: "exception_case.opened",
};

/**
 * A production row exactly as the materializer persists it: the canonical
 * projection definition runs over the facts at event time, so the stored
 * strings are the English ones production writes today.
 */
async function row(
  aggregateType: string,
  facts: Record<string, unknown>,
  data: Record<string, unknown> = {},
): Promise<ProjectionRecord> {
  const topic = topics[aggregateType] ?? "";
  const definition = createCanonicalPortalProjectionDefinitions().find(
    (candidate) => candidate.topic === topic,
  );
  if (!definition) throw new Error(`no projection definition for ${topic}`);
  const state: AuthoritativeProjectionState = {
    aggregateType,
    aggregateId: "0a1b2c3d-0000-4000-8000-000000000001",
    accountId: "10000000-0000-4000-8000-000000000001",
    version: 2,
    sourceHash: "a".repeat(64),
    sourceUpdatedAt: "2026-09-01T09:00:00.000Z",
    data: facts,
  };
  const [mutation] = await definition.project({
    state,
    event: {
      eventId: "20000000-0000-4000-8000-000000000001",
      eventType: topic,
      aggregateType,
      aggregateId: state.aggregateId,
      aggregateVersion: 2,
      occurredAt: "2026-09-01T09:00:00.000Z",
      requestId: "request-0001",
      actor: { kind: "system", id: "materializer" },
      data: {},
    },
  });
  if (!mutation) throw new Error("the definition projected nothing");
  return {
    id: "projection-1",
    recordKey: mutation.recordKey,
    aggregateType,
    aggregateId: state.aggregateId,
    accountId: state.accountId,
    audience: mutation.audience,
    channel: "quotes",
    version: 2,
    sourceUpdatedAt: state.sourceUpdatedAt,
    projectedAt: state.sourceUpdatedAt,
    stale: false,
    data: { ...mutation.payload, ...data },
  };
}

function relative(locale: Locale, days: number): string {
  return new Intl.RelativeTimeFormat(formattingLocales[locale], {
    numeric: "auto",
  }).format(days, "day");
}

/** Arabic isolates every inserted value; compare the words, then the isolation. */
function words(value: unknown): string {
  return String(value).replace(/[\u2068\u2069]/gu, "");
}

function formatted(locale: Locale, isoDate: string): string {
  return new Intl.DateTimeFormat(formattingLocales[locale], {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}

describe("production projection labels at read time", () => {
  it("renders an issued quote in the reader's language from its facts", async () => {
    const quote = await row("quote", {
      status: "issued",
      revision: 3,
      currency: "USD",
      totalMinor: "840000",
      marginFloorResult: "pass",
      expiresAt: "2026-09-23T00:00:00.000Z",
    });
    // What the materializer stored is English with a US date.
    expect(quote.data.valueLabel).toBe("Total USD");
    expect(quote.data.dateLabel).toBe("Sep 23, 2026");

    const pt = localizedProductionRecord(quote, context("pt")).data;
    const date = formatted("pt", "2026-09-23");
    expect(pt.statusLabel).toBe("Aberto");
    expect(pt.title).toBe("Q-0A1B2C3D · revisão 3");
    expect(pt.description).toBe(`Expira em ${date} · ${relative("pt", 3)}`);
    expect(pt.value).toBe(
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "USD",
      }).format(8400),
    );
    expect(pt.valueLabel).toBe("Total (USD)");
    expect(pt.secondary).toBe("Verificação de margem mínima: Aprovado");
    expect(pt.dateLabel).toBe(date);
    expect(pt.context).toEqual([
      { label: "Verificação de margem mínima", value: "Aprovado" },
      { label: "Validade", value: date },
      { label: "Revisão", value: "3" },
    ]);
    // An issued quote offers the customer "expire"; the stored English was
    // "Expire" (title-cased identifier), the reader gets the button's label.
    expect(quote.data.nextAction).toBe("Expire");
    expect(pt.nextAction).toBe("Expirar agora");
  });

  it("names the first allowed action, and review when the record is overdue", async () => {
    const actionable = await row(
      "quote",
      { status: "issued", expiresAt: "2026-09-21T00:00:00.000Z" },
      { allowedActions: ["expire", "prepare_artifact"] },
    );
    expect(
      localizedProductionRecord(actionable, context("de")).data.nextAction,
    ).toBe("Jetzt ablaufen lassen");

    const overdue = await row("invoice", {
      currency: "EUR",
      amountMinor: "123450",
      dueAt: "2026-09-10T00:00:00.000Z",
    });
    const ja = localizedProductionRecord(overdue, context("ja")).data;
    expect(ja.nextAction).toBe("要確認");
    expect(ja.description).toBe(
      `期限 ${formatted("ja", "2026-09-10")}・${relative("ja", -10)}`,
    );
  });

  it("keeps identifiers and codes verbatim inside Arabic sentences", async () => {
    const agreement = await row("agreement", {
      paper: "ours",
      termMonths: 12,
      noticeDays: 30,
      renewalType: "auto_renew",
      executionMode: "counter_signed",
      effectiveOn: "2026-01-01",
    });
    const ar = localizedProductionRecord(agreement, context("ar")).data;
    expect(words(ar.description)).toBe("نموذج عقد Fil One · مدة 12 شهرًا");
    // The number sits in its own isolate, so it cannot reorder the sentence.
    expect(ar.description).toContain("\u206812\u2069");
    expect(ar.context).toContainEqual({
      label: "فترة الإشعار",
      value: "\u206830\u2069 يومًا",
    });
    expect(ar.secondary).toBe("تجديد تلقائي");
  });

  it("leaves a row without facts exactly as stored", async () => {
    const legacy = await row("quote", { status: "issued" });
    const withoutFacts = {
      ...legacy,
      data: { ...legacy.data, authoritative: undefined },
    };
    expect(localizedProductionRecord(withoutFacts, context("fr"))).toBe(
      withoutFacts,
    );
  });

  it("shows an unnamed domain value as its identifier rather than English", async () => {
    const exception = await row("exception_case", {
      queue: "a_queue_added_later",
      objectType: "quote",
      targetAt: "2026-09-22T00:00:00.000Z",
    });
    const fr = localizedProductionRecord(exception, context("fr")).data;
    expect(fr.title).toBe("EXC-0A1B2C3D · a queue added later");
    expect(fr.context).toContainEqual({ label: "Objet", value: "Devis" });
  });
});

describe("demo order acceptance", () => {
  it("does not touch records that are not an accepted order", async () => {
    const quote = await row("quote", { status: "issued" });
    expect(localizedAcceptedOrderRecord(quote, translatorFor("es"))).toBe(
      quote,
    );
  });
});
