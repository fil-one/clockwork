import { expect, it, vi } from "vitest";

import { canonicalDemoPriceBooks } from "./demo-price-books";
import { loadPriceBookImpact } from "./server-price-book-impact-loader";

const defaults = {
  books: canonicalDemoPriceBooks,
  userId: "20000000-0000-4000-8000-000000000001",
  providerBacked: true,
  internalReader: true,
  demo: false,
  readAt: "2026-09-06T12:00:00.000Z",
};

it("never queries production references through demo or unauthorized identity", async () => {
  const read = vi.fn().mockRejectedValue(new Error("must not run"));
  expect(
    await loadPriceBookImpact({
      ...defaults,
      reader: { read },
      providerBacked: false,
      demo: true,
    }),
  ).toMatchObject({
    availability: "available",
    source: "Illustrative demo scenario",
  });
  expect(
    await loadPriceBookImpact({
      ...defaults,
      reader: { read },
      internalReader: false,
    }),
  ).toEqual({ availability: "unavailable" });
  expect(
    await loadPriceBookImpact({
      ...defaults,
      reader: { read },
      providerBacked: false,
    }),
  ).toEqual({ availability: "unavailable" });
  expect(read).not.toHaveBeenCalled();
});

it("uses trusted book IDs and retains unavailable rather than invented zero counts", async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ asOf: defaults.readAt, records: [] });
  expect(await loadPriceBookImpact({ ...defaults, reader: { read } })).toEqual({
    availability: "available",
    source: "Retained commerce records",
    asOf: defaults.readAt,
    records: [],
  });
  expect(read).toHaveBeenCalledWith({
    userId: defaults.userId,
    bookIds: defaults.books.map((book) => book.id),
  });
  read.mockRejectedValue(new Error("unreachable"));
  expect(await loadPriceBookImpact({ ...defaults, reader: { read } })).toEqual({
    availability: "unavailable",
  });
});
