import { describe, expect, it } from "vitest";

import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

import {
  canonicalDemoPriceBooks,
  storeDemoPriceBooks,
} from "./demo-price-books";
import { loadPriceBookRecords } from "./server-price-book-loader";

const book = {
  id: "c6000000-0000-4000-8000-000000000001",
  name: "Sterling rate card",
  currency: "GBP",
  version: 3,
  rowVersion: 2,
  status: "draft" as const,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  rateCardCount: 4,
  regions: ["uk-south"],
  activationRequestedBy: "20000000-0000-4000-8000-000000000001",
  activationRequestedByEmail: "operator@clockwork.test",
  activationRequestedAt: "2026-08-01T16:00:00.000Z",
  lastDecisionAt: null,
  lastDecisionReason: null,
};

describe("price book server read", () => {
  it("returns what the pricing service holds", async () => {
    const result = await loadPriceBookRecords(
      { list: () => Promise.resolve([book]) },
      { locale: "pt", now: new Date("2026-08-02T00:00:00.000Z") },
    );
    // Production books are what someone typed; the reader's language does
    // not change them.
    expect(result).toEqual({
      books: [book],
      source: "service",
      availability: "available",
      readAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("offers nothing to activate when the read is unavailable", async () => {
    const unreadable = await loadPriceBookRecords(
      {
        list: () => Promise.reject(new Error("pricing service is unreachable")),
      },
      { locale: "en" },
    );
    expect(unreadable.books).toEqual([]);
    expect(unreadable.source).toBe("unavailable");
    expect(unreadable.availability).toBe("unavailable");

    const unconfigured = await loadPriceBookRecords(undefined, {
      locale: "en",
    });
    expect(unconfigured.books).toEqual([]);
    expect(unconfigured.source).toBe("unavailable");
    expect(unconfigured.availability).toBe("unavailable");
  });

  it("distinguishes a successful empty live read from an unavailable read", async () => {
    const result = await loadPriceBookRecords(
      { list: () => Promise.resolve([]) },
      { locale: "en" },
    );
    expect(result).toMatchObject({
      books: [],
      source: "service",
      availability: "empty",
    });
  });

  it("serves canonical fictional books only for an explicit demo", async () => {
    const result = await loadPriceBookRecords(undefined, {
      locale: "en",
      demoEnabled: true,
      demoStore: createMemoryDemoStore(),
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(result.source).toBe("demo");
    expect(result.availability).toBe("available");
    expect(result.books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "USD", status: "active" }),
        expect.objectContaining({ currency: "GBP", status: "active" }),
        expect.objectContaining({
          currency: "USD",
          status: "draft",
          activationRequestedByEmail: "commercial.policy@filone.test",
        }),
      ]),
    );
  });

  it("reads the demo's authored text in the reader's language, and only that", async () => {
    const store = createMemoryDemoStore();
    const edited = canonicalDemoPriceBooks.find(
      (candidate) => candidate.currency === "GBP",
    );
    if (!edited) throw new Error("fixture missing");
    await store.update((state) =>
      storeDemoPriceBooks(
        state,
        [{ ...edited, name: "Sterling list typed by finance" }],
        "2026-08-02T00:00:00.000Z",
      ),
    );
    const result = await loadPriceBookRecords(undefined, {
      locale: "pt",
      demoEnabled: true,
      demoStore: store,
      now: new Date("2026-08-02T00:00:00.000Z"),
    });
    const names = result.books.map((candidate) => candidate.name);
    expect(names).toContain("Venda direta USD");
    expect(names).not.toContain("Direct commerce USD");
    // A name someone typed stays exactly as typed.
    expect(names).toContain("Sterling list typed by finance");
    const active = result.books.find(
      (candidate) =>
        candidate.currency === "USD" && candidate.status === "active",
    );
    expect(active?.lastDecisionReason).toBe(
      "Preços fictícios de demonstração aprovados para venda direta.",
    );
    expect(active?.rateCards?.[0]?.approvedClaim).toBe(
      "Capacidade fictícia de armazenamento imutável",
    );
    // Identifiers and money are facts, untouched by the language.
    expect(active?.rateCards?.[0]).toMatchObject({
      sku: "LOCKED-STORAGE-TB",
      region: "us-east-2",
      unitPrice: { currency: "USD", minor: "15000" },
    });
  });
});
