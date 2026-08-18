import { describe, expect, it } from "vitest";

import type { ProjectionRecord } from "@/src/features/experience-server/model";

import { selectAcceptanceQuote, toAcceptableQuote } from "./select-quote";

function quote(
  recordKey: string,
  status: string,
  overrides: Partial<ProjectionRecord> = {},
): ProjectionRecord {
  return {
    id: `projection-${recordKey}`,
    recordKey,
    aggregateType: "quote",
    aggregateId: `aggregate-${recordKey}`,
    accountId: "10000000-0000-4000-8000-000000000001",
    audience: "customer",
    channel: "quotes",
    version: 1,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:00:00.000Z",
    stale: false,
    ...overrides,
    data: { status, ...overrides.data },
  };
}

const issued = quote("quote-issued", "issued");
const open = quote("quote-open", "open");
const accepted = quote("quote-accepted", "accepted");
const draft = quote("quote-draft", "draft");

describe("selectAcceptanceQuote", () => {
  it.each([issued, open])(
    "selects an explicitly requested acceptable quote ($recordKey)",
    (record) => {
      expect(selectAcceptanceQuote([accepted, record], record.recordKey)).toBe(
        record,
      );
    },
  );

  it.each([accepted, draft])(
    "rejects an explicitly requested non-acceptable quote without falling back ($recordKey)",
    (record) => {
      expect(
        selectAcceptanceQuote([record, open], record.recordKey),
      ).toBeUndefined();
    },
  );

  it("selects the first acceptable quote when no key was requested", () => {
    expect(
      selectAcceptanceQuote([accepted, draft, open, issued], undefined),
    ).toBe(open);
  });

  it("selects nothing when no acceptable quote exists", () => {
    expect(selectAcceptanceQuote([accepted, draft], undefined)).toBeUndefined();
  });
});

describe("toAcceptableQuote", () => {
  it("uses the commercial reference and authoritative quote revision", () => {
    const record = quote("quote-issued", "open", {
      data: {
        reference: "Q-2026-0312",
        version: "presentation-version",
        authoritative: { revision: 2 },
      },
    });

    expect(toAcceptableQuote(record)).toMatchObject({
      id: record.aggregateId,
      reference: "Q-2026-0312",
      version: "2",
    });
  });

  it("falls back to the record key and presentation version", () => {
    const record = quote("quote-legacy", "open", { data: { version: "7" } });

    expect(toAcceptableQuote(record)).toMatchObject({
      reference: "quote-legacy",
      version: "7",
    });
  });

  it("falls back to the projection row version when no quote revision exists", () => {
    const record = quote("quote-minimal", "open", { version: 9 });

    expect(toAcceptableQuote(record)).toMatchObject({
      reference: "quote-minimal",
      version: "9",
    });
  });
});
