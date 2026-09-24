import { describe, expect, it, vi } from "vitest";

import type {
  ProjectionChannel,
  ProjectionRecord,
} from "@/src/features/experience-server/model";
import { translatorFor } from "@/src/i18n/catalogs";

const generatedAt = "2026-08-15T09:15:00.000Z";

function invoice(key: string, amountMinor: string): ProjectionRecord {
  return {
    id: `projection-${key}`,
    recordKey: key,
    aggregateType: "invoice",
    aggregateId: `aggregate-${key}`,
    accountId: null,
    audience: "internal",
    channel: "collections",
    version: 1,
    sourceUpdatedAt: generatedAt,
    projectedAt: generatedAt,
    stale: false,
    data: {
      reference: key,
      status: "open",
      authoritative: {
        amountMinor,
        currency: "USD",
        dueAt: "2026-07-01T00:00:00.000Z",
      },
    },
  };
}

vi.mock("@/src/features/experience-server/portal-view-loader", () => ({
  loadPortalRecords: vi.fn((_audience: string, channel: ProjectionChannel) => {
    const records =
      channel === "collections"
        ? [invoice("INV-1", "100000"), invoice("INV-2", "20000")]
        : [];
    return Promise.resolve({
      records,
      generatedAt,
      stale: false,
      recordCount: records.length,
      pagesRead: 1,
      truncated: false,
    });
  }),
}));

import { loadOperationsHome } from "./server-loader";

const now = new Date("2026-08-15T09:20:00.000Z");

describe("operations home signals", () => {
  /**
   * The collections total used to come from the finance summary, which formats
   * in US English whatever the reader's language, so a Portuguese operator saw
   * `$1,200.00` under a Portuguese label.
   */
  it("formats the overdue total with the reader's locale", async () => {
    const english = await loadOperationsHome(now, translatorFor("en"), "en-US");
    const portuguese = await loadOperationsHome(
      now,
      translatorFor("pt"),
      "pt-BR",
    );
    const german = await loadOperationsHome(now, translatorFor("de"), "de-DE");
    const collections = (data: typeof english) =>
      data.signals.find((signal) => signal.channel === "collections");

    expect(collections(english)).toMatchObject({
      label: "Collections",
      value: "$1,200.00",
      detail: "Past-due invoices: 2. Open invoices: 2.",
    });
    expect(collections(portuguese)).toMatchObject({
      label: "Cobrança",
      value: new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "USD",
      }).format(1200),
    });
    expect(collections(german)?.value).toBe(
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "USD",
      }).format(1200),
    );
  });

  it("words every signal in the reader's language", async () => {
    const japanese = await loadOperationsHome(
      now,
      translatorFor("ja"),
      "ja-JP",
    );
    const english = await loadOperationsHome(now, translatorFor("en"), "en-US");
    for (const [index, signal] of japanese.signals.entries()) {
      const source = english.signals[index];
      expect(signal.label).not.toBe(source?.label);
      expect(signal.action).not.toBe(source?.action);
      expect(signal.detail).not.toBe(source?.detail);
    }
  });
});
