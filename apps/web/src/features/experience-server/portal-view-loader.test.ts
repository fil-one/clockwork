import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));
vi.mock("./projection-source", () => ({
  configuredProjectionSource: () => ({ list: mocks.list }),
  projectionInput: (input: Record<string, unknown>) => input,
}));

import {
  loadCustomerCollectionRecords,
  loadPartnerRecords,
} from "./portal-view-loader";

const accountId = "10000000-0000-4000-8000-000000000001";

function projection(
  overrides: Partial<ProjectionRecord> & {
    data: Readonly<Record<string, unknown>>;
  },
): ProjectionRecord {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    recordKey: "quote-60000000-0000-4000-8000-000000000001",
    aggregateType: "quote",
    aggregateId: "60000000-0000-4000-8000-000000000001",
    accountId,
    audience: "partner",
    channel: "quotes",
    version: 3,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:00:00.000Z",
    stale: false,
    ...overrides,
  };
}

function partnerPayload(context: unknown): Readonly<Record<string, unknown>> {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    name: "Q-3F2A91B0 rev 3",
    context,
    status: "open",
    risk: "medium",
    owner: "Q-3F2A91B0",
    value: "$184,800.00",
    secondary: "Floor Pass",
    allowedActions: ["prepare_artifact"],
  };
}

function returns(records: readonly ProjectionRecord[]) {
  mocks.list.mockResolvedValue({
    items: records,
    nextCursor: null,
    generatedAt: "2026-08-01T00:00:00.000Z",
    freshnessSeconds: 300,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommerceSession.mockResolvedValue({
    accountIds: [accountId],
    selectedAccountId: accountId,
    roles: ["partner_admin"],
  });
});

describe("partner record context", () => {
  it("joins materializer context entries into one readable line", async () => {
    returns([
      projection({
        data: partnerPayload([
          { label: "Floor check", value: "Pass" },
          { label: "Expires", value: "Aug 14, 2026" },
        ]),
      }),
    ]);

    const page = await loadPartnerRecords("quotes");

    expect(page.records[0]?.context).toBe(
      "Floor check Pass · Expires Aug 14, 2026",
    );
    expect(page.records[0]?.href).toBe(
      "/partner/quotes/quote-60000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps a demo fixture context string as written", async () => {
    returns([
      projection({
        data: partnerPayload("Resale · US East · 280 TB committed"),
      }),
    ]);

    const page = await loadPartnerRecords("quotes");

    expect(page.records[0]?.context).toBe(
      "Resale · US East · 280 TB committed",
    );
  });

  it("marks an empty context array rather than dropping the column", async () => {
    returns([projection({ data: partnerPayload([]) })]);

    const page = await loadPartnerRecords("quotes");

    expect(page.records[0]?.context).toBe("Not recorded");
  });

  it("rejects a context entry that is not a label and value pair", async () => {
    returns([projection({ data: partnerPayload([{ label: "Expires" }]) })]);

    await expect(loadPartnerRecords("quotes")).rejects.toThrow(
      "Projection record omitted value",
    );
  });

  it("rejects a context that is neither entries nor a formatted line", async () => {
    returns([projection({ data: partnerPayload(42) })]);

    await expect(loadPartnerRecords("quotes")).rejects.toThrow(
      "Projection record omitted context",
    );
  });
});

describe("customer collection context", () => {
  it("keeps context entries as label and value pairs", async () => {
    returns([
      projection({
        audience: "customer",
        channel: "amendments",
        recordKey: "amendment-70000000-0000-4000-8000-000000000001",
        data: {
          id: "70000000-0000-4000-8000-000000000001",
          title: "AMD-70000000",
          description: "Uplift effective Sep 1, 2026",
          status: "pending",
          statusLabel: "Pending",
          risk: "medium",
          owner: "AMD-70000000",
          value: "Uplift",
          valueSort: 1,
          updatedLabel: "2026-07-31T16:00:00.000Z",
          context: [{ label: "Kind", value: "Uplift" }],
        },
      }),
    ]);

    const page = await loadCustomerCollectionRecords("amendments");

    expect(page.records[0]?.context).toEqual([
      { label: "Kind", value: "Uplift" },
    ]);
  });

  it("rejects a customer record without context entries", async () => {
    returns([
      projection({
        audience: "customer",
        channel: "amendments",
        recordKey: "amendment-70000000-0000-4000-8000-000000000001",
        data: {
          id: "70000000-0000-4000-8000-000000000001",
          title: "AMD-70000000",
          description: "Uplift effective Sep 1, 2026",
          status: "pending",
          statusLabel: "Pending",
          risk: "medium",
          owner: "AMD-70000000",
          value: "Uplift",
          valueSort: 1,
          updatedLabel: "2026-07-31T16:00:00.000Z",
          context: "Uplift",
        },
      }),
    ]);

    await expect(loadCustomerCollectionRecords("amendments")).rejects.toThrow(
      "Projection record omitted context",
    );
  });
});
