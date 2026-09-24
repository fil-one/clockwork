import { describe, expect, it } from "vitest";

import { formatOperationalTimestamp } from "./presentation";

describe("operational timestamps", () => {
  it("formats an instant in UTC with the reader's locale", () => {
    expect(
      formatOperationalTimestamp("2026-07-31T15:42:00.000Z", "en-US"),
    ).toBe("Jul 31, 2026, 3:42 PM UTC");
    expect(
      formatOperationalTimestamp("2026-07-31T15:42:00.000Z", "pt-BR"),
    ).toContain("31 de jul. de 2026");
  });

  /**
   * An instant that does not parse used to read "Recently": a freshness
   * nothing measured, and English whatever the reader's language.
   */
  it("claims no freshness for an instant it cannot read", () => {
    for (const locale of ["en-US", "pt-BR", "ja-JP", "ar-AE"])
      expect(formatOperationalTimestamp("not a date", locale)).toBe("—");
  });
});
