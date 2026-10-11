import { expect, it } from "vitest";
import { nextPageCursor, pageOptions } from "./keyset-page";

const last = {
  id: "20000000-0000-4000-8000-000000000001",
  cursorAt: "2027-01-01T00:00:00.000901Z",
};
it("retains microseconds and the list identity in an opaque cursor", () => {
  const cursor = nextPageCursor("pricing", true, last);
  if (!cursor) throw new Error("Expected cursor");
  expect(pageOptions("pricing", { cursor, limit: 17 })).toEqual({
    limit: 17,
    cursor: { source: "pricing", at: last.cursorAt, id: last.id },
  });
  expect(() => pageOptions("partners", { cursor })).toThrow("INVALID_INPUT");
  expect(nextPageCursor("pricing", false, last)).toBeNull();
  expect(nextPageCursor("pricing", true, undefined)).toBeNull();
});
it.each([0, -1, 101, 1.5, NaN, Infinity])(
  "rejects invalid page limit %s",
  (limit) => {
    expect(() => pageOptions("pricing", { limit })).toThrow("INVALID_INPUT");
  },
);
it.each([
  "",
  "bad%%",
  "e30",
  Buffer.from(
    JSON.stringify({
      source: "pricing",
      at: "2027-02-30T00:00:00Z",
      id: last.id,
    }),
  ).toString("base64url"),
])("rejects malformed cursor %s", (cursor) => {
  expect(() => pageOptions("pricing", { cursor })).toThrow("INVALID_INPUT");
});
