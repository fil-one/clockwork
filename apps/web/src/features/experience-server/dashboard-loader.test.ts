import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";
import { NOT_RECORDED } from "@clockwork/workflows";

import type { ProjectionChannel, ProjectionRecord } from "./model";
import type * as PortalViewLoader from "./portal-view-loader";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  loadPortalRecords: vi.fn(),
  loadTopPortalRecords: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));
vi.mock("./portal-view-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof PortalViewLoader>()),
  loadPortalRecords: mocks.loadPortalRecords,
  loadTopPortalRecords: mocks.loadTopPortalRecords,
}));

import {
  explicitDashboardDemoEnabled,
  loadCustomerDashboardProjection,
  loadPartnerDashboardProjection,
} from "./dashboard-loader";

const accountId = "10000000-0000-4000-8000-000000000001";
const endClientId = "11111111-1111-4111-8111-111111111111";
const generatedAt = "2026-08-01T00:00:00.000Z";

function projection(
  channel: ProjectionChannel,
  recordKey: string,
  version: number,
  sourceUpdatedAt: string,
  data: Readonly<Record<string, unknown>>,
): ProjectionRecord {
  return {
    id: `50000000-0000-4000-8000-${recordKey.slice(-12)}`,
    recordKey,
    aggregateType: channel,
    aggregateId: "60000000-0000-4000-8000-000000000001",
    accountId,
    audience: "customer",
    channel,
    version,
    sourceUpdatedAt,
    projectedAt: sourceUpdatedAt,
    stale: false,
    data,
  };
}

const overdueInvoice = projection(
  "billing",
  "invoice-000000000001",
  2,
  "2026-07-21T10:00:00.000Z",
  {
    authoritative: { status: "open", dueAt: "2026-07-20T00:00:00.000Z" },
    title: "INV-4B1C2D3E",
    description: "Due Jul 20, 2026 · 12 days ago",
    status: "open",
    statusLabel: "Open",
    tone: "danger",
    value: "$15,400.00",
    term: "Due Jul 20, 2026 · 12 days ago",
    dateLabel: "Jul 20, 2026",
    context: [{ label: "Due", value: "Jul 20, 2026" }],
    nextAction: "Read Only",
  },
);

const amountlessInvoice = projection(
  "billing",
  "invoice-000000000009",
  1,
  "2026-07-21T10:00:00.000Z",
  {
    authoritative: { status: "open", dueAt: "2026-07-20T00:00:00.000Z" },
    title: "INV-9F8E7D6C",
    description: "Due Jul 20, 2026 · 12 days ago",
    status: "open",
    statusLabel: "Open",
    tone: "danger",
    value: NOT_RECORDED,
    term: "Due Jul 20, 2026 · 12 days ago",
    dateLabel: "Jul 20, 2026",
    context: [{ label: "Due", value: "Jul 20, 2026" }],
    nextAction: "Read Only",
  },
);

const paidInvoice = projection(
  "billing",
  "invoice-000000000002",
  4,
  "2026-07-03T10:00:00.000Z",
  {
    authoritative: { status: "paid", paidAt: "2026-07-03T00:00:00.000Z" },
    title: "INV-5C2D3E4F",
    description: "Paid Jul 3, 2026",
    status: "paid",
    statusLabel: "Paid",
    tone: "success",
    value: "$58,920.00",
    term: "Paid Jul 3, 2026",
    dateLabel: "Jul 3, 2026",
    context: [{ label: "Paid", value: "Jul 3, 2026" }],
    nextAction: "Read Only",
  },
);

const openQuote = projection(
  "quotes",
  "quote-000000000003",
  3,
  "2026-07-30T12:00:00.000Z",
  {
    authoritative: {
      status: "issued",
      expiresAt: "2026-08-04T00:00:00.000Z",
      endClientAccountId: endClientId,
    },
    title: "Q-3F2A91B0 rev 3",
    description: "Expires Aug 4, 2026 · 3 days remaining",
    status: "open",
    statusLabel: "Open",
    tone: "danger",
    value: "$184,800.00",
    term: "Expires Aug 4, 2026 · 3 days remaining",
    dateLabel: "Aug 4, 2026",
    context: [{ label: "Expires", value: "Aug 4, 2026" }],
    nextAction: "Prepare Artifact",
  },
);

const canceledQuote = projection(
  "quotes",
  "quote-000000000004",
  5,
  "2026-06-30T12:00:00.000Z",
  {
    authoritative: { status: "expired", expiresAt: "2026-06-29T00:00:00.000Z" },
    title: "Q-9A8B7C6D rev 1",
    description: "Quote Expired",
    status: "canceled",
    statusLabel: "Canceled",
    tone: "neutral",
    value: "$12,000.00",
    term: "Expires Jun 29, 2026 · 33 days ago",
    dateLabel: "Jun 29, 2026",
    context: [{ label: "Expires", value: "Jun 29, 2026" }],
    nextAction: "Read Only",
  },
);

const noticeOrder = projection(
  "orders",
  "order-000000000005",
  6,
  "2026-07-15T12:00:00.000Z",
  {
    authoritative: {
      status: "active",
      sourcing: "direct",
      serviceStartsOn: "2026-01-01T00:00:00.000Z",
      serviceEndsOn: "2026-12-31T00:00:00.000Z",
      noticeOn: "2026-08-15T00:00:00.000Z",
    },
    title: "ORD-7E6F5A4B",
    description: "Direct order · Jan 1, 2026 – Dec 31, 2026",
    status: "active",
    statusLabel: "Active",
    tone: "danger",
    value: "Jan 1, 2026 – Dec 31, 2026",
    term: "Jan 1, 2026 – Dec 31, 2026",
    dateLabel: "Jan 1, 2026",
    context: [
      { label: "Service term", value: "Jan 1, 2026 – Dec 31, 2026" },
      { label: "Notice", value: "Aug 15, 2026" },
    ],
    nextAction: "Prepare Artifact",
  },
);

const commissionStatement = projection(
  "commissions",
  "STM-2026-Q3",
  3,
  "2026-07-31T15:00:00.000Z",
  {
    title: "Q3 commission statement",
    description: "34 collections · 2 credits · 1 holdback",
    status: "pending",
    statusLabel: "Pending",
    tone: "warning",
    value: "$18,420 accrued",
    term: "Pays after collection truth settles",
    dateLabel: "Jul 31, 2026",
    context: [],
  },
);

function pageFor(records: readonly ProjectionRecord[]) {
  return {
    records,
    generatedAt,
    stale: false,
    recordCount: records.length,
    pagesRead: 1,
  };
}

function serve(
  channels: Partial<Record<ProjectionChannel, ProjectionRecord[]>>,
) {
  mocks.loadPortalRecords.mockImplementation(
    (_audience: string, channel: ProjectionChannel) =>
      Promise.resolve(pageFor(channels[channel] ?? [])),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommerceSession.mockResolvedValue({
    accountIds: [accountId],
    selectedAccountId: accountId,
    roles: ["partner_admin"],
  });
  serve({});
  mocks.loadTopPortalRecords.mockResolvedValue(pageFor([]));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard demo boundary", () => {
  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "rejects static demo projections when %s marks production",
    (productionKey) => {
      const environment: Record<string, string | undefined> = {
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      };
      environment[productionKey] = " Production ";

      expect(explicitDashboardDemoEnabled(environment)).toBe(false);
    },
  );

  it("rejects the public production marker and permits an explicit local demo", () => {
    expect(
      explicitDashboardDemoEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(false);
    expect(
      explicitDashboardDemoEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(true);
  });

  it("uses current demo obligations while retaining the demonstration usage context", async () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "local");

    const customer = await loadCustomerDashboardProjection();
    const partner = await loadPartnerDashboardProjection();

    expect(customer.capacity?.committed).toBe("620 TB");
    expect(partner.agreement.label).toBe(
      "Your organization partner agreement · v4.1",
    );
    expect(mocks.loadPortalRecords).toHaveBeenCalledTimes(2);
    expect(mocks.loadTopPortalRecords).not.toHaveBeenCalled();
  });

  it("drops paid demo invoices from attention and preserves exact open record links", async () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    serve({ billing: [overdueInvoice, paidInvoice], quotes: [openQuote] });
    const result = await loadCustomerDashboardProjection("Meridian Data Works");
    expect(result.term.title).toBe("Meridian Data Works annual term");
    expect(result.obligations.map((item) => item.id)).toContain(
      overdueInvoice.recordKey,
    );
    expect(result.obligations.map((item) => item.id)).not.toContain(
      paidInvoice.recordKey,
    );
    expect(
      result.obligations.find((item) => item.id === overdueInvoice.recordKey)
        ?.title,
    ).toContain("$15,400.00");
    expect(
      result.obligations.find((item) => item.id === openQuote.recordKey)?.href,
    ).toContain(openQuote.recordKey);
  });

  it.each([
    ["2026-09-06T00:00:00.000Z", "Opens Nov 1, 2026 · in 56 days", 68],
    ["2026-11-02T00:00:00.000Z", "Opened Nov 1, 2026", 84],
    ["2027-02-01T00:00:00.000Z", "Opened Nov 1, 2026", 100],
  ])(
    "ages the fictional term from the displayed as-of date %s",
    async (asOf, notice, progress) => {
      vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
      mocks.loadPortalRecords.mockResolvedValue({
        ...pageFor([]),
        generatedAt: asOf,
      });

      const result = await loadCustomerDashboardProjection();

      expect(result.generatedAt).toBe(asOf);
      expect(result.term.noticeLabel).toBe(notice);
      expect(result.term.progressPercent).toBe(progress);
      // Intl's range: thin spaces around an en dash.
      expect(result.term.rangeLabel).toBe("Jan 1\u2009–\u2009Dec 31, 2026");
      expect(result.term.renewalLabel).toBe("Jan 1, 2027");
      expect(
        result.obligations.find((item) => item.type === "Notice and renewal")
          ?.title,
      ).toBe(
        asOf < "2026-11-01"
          ? "Notice window opens Nov 1"
          : "Notice window opened Nov 1",
      );
    },
  );

  it("binds demo partner economics to the selected organization and selling motion", async () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "local");
    const reseller = await loadPartnerDashboardProjection({
      accountId: demoAccountIds.reseller,
      accountName: "Ember Peak Systems",
    });
    expect(reseller.agreement.label).toBe(
      "Ember Peak Systems partner agreement · v4.1",
    );
    expect(reseller.agreement.merchantBoundary).toContain(
      "Ember Peak Systems is merchant of record",
    );
    expect(JSON.stringify(reseller)).not.toContain("Meridian");

    const referral = await loadPartnerDashboardProjection({
      accountId: demoAccountIds.referral,
      accountName: "Northstar Advisory",
    });
    expect(referral.agreement.commercialRoute).toBe("Referral");
    expect(referral.boundary).toContainEqual({
      label: "Merchant of record",
      value: "Fil One",
    });
    expect(
      referral.boundary.some((row) => row.label === "Transfer price"),
    ).toBe(false);
  });
});

describe("customer dashboard composition", () => {
  it("ranks obligations across billing, quotes and orders by urgency", async () => {
    serve({
      billing: [overdueInvoice, paidInvoice],
      quotes: [openQuote, canceledQuote],
      orders: [noticeOrder],
    });

    const projectionResult = await loadCustomerDashboardProjection();

    expect(
      projectionResult.obligations.map((item) => [
        item.priority,
        item.type,
        item.href,
      ]),
    ).toEqual([
      [1, "Invoice", "/billing/invoice-000000000001"],
      [2, "Quote", "/quotes/quote-000000000003"],
      [3, "Notice and renewal", "/orders/order-000000000005"],
    ]);
    expect(projectionResult.obligations[0]).toMatchObject({
      id: "invoice-000000000001",
      title: "INV-4B1C2D3E · $15,400.00",
      detail: "Due Jul 20, 2026 · 12 days ago",
      actionLabel: "Review invoice",
      tone: "danger",
      state: "Open",
      recordVersion: 2,
    });
  });

  it("leaves the placeholder out of an obligation title when no amount is recorded", async () => {
    serve({ billing: [amountlessInvoice] });

    const projectionResult = await loadCustomerDashboardProjection();

    expect(projectionResult.obligations[0]?.title).toBe("INV-9F8E7D6C");
  });

  it("derives the term and services from the governing order", async () => {
    serve({ orders: [noticeOrder] });

    const projectionResult = await loadCustomerDashboardProjection();

    expect(projectionResult.term).toEqual({
      title: "ORD-7E6F5A4B",
      rangeLabel: "Jan 1, 2026 – Dec 31, 2026",
      progressPercent: 58,
      progressLabel: "58% of the current commercial term has elapsed",
      renewalState: "Not recorded",
      noticeLabel: "Opens Aug 15, 2026 · in 14 days",
      renewalLabel: "Dec 31, 2026",
      agreementLabel: "No agreement recorded",
      renewalTone: "neutral",
    });
    expect(projectionResult.services).toEqual([
      {
        id: "order-000000000005",
        name: "ORD-7E6F5A4B",
        detail: "Direct order · Jan 1, 2026 – Dec 31, 2026",
      },
    ]);
  });

  it("reports recent record updates as account activity", async () => {
    serve({ billing: [overdueInvoice], quotes: [openQuote] });

    const projectionResult = await loadCustomerDashboardProjection();

    expect(projectionResult.activity.map((item) => item.id)).toEqual([
      "quote-000000000003",
      "invoice-000000000001",
    ]);
    expect(projectionResult.activity[0]).toMatchObject({
      title: "Q-3F2A91B0 rev 3",
      detail: "Quote · Open",
      occurredAt: "2026-07-30T12:00:00.000Z",
      occurredLabel: "Jul 30, 2026, 12:00 PM",
    });
  });

  it("renders an empty state for an account with no records", async () => {
    const projectionResult = await loadCustomerDashboardProjection();

    expect(projectionResult.obligations).toEqual([]);
    expect(projectionResult.services).toEqual([]);
    expect(projectionResult.activity).toEqual([]);
    expect(projectionResult.term).toMatchObject({
      title: "Account term",
      rangeLabel: "No service term recorded yet",
      progressPercent: 0,
      progressLabel: "Service term progress is not yet available",
      noticeLabel: "No notice date recorded",
    });
    expect(projectionResult.capacity).toBeNull();
    expect(projectionResult.generatedAt).toBe(generatedAt);
  });

  it("rejects a projection record whose tone is not a rendered tone", async () => {
    serve({
      quotes: [
        projection("quotes", "quote-000000000009", 1, generatedAt, {
          ...openQuote.data,
          tone: "critical",
        }),
      ],
    });

    await expect(loadCustomerDashboardProjection()).rejects.toMatchObject({
      status: 502,
      code: "DASHBOARD_PROJECTION_INVALID",
    });
  });
});

describe("partner dashboard composition", () => {
  it("composes the agreement clock and work ledger from partner channels", async () => {
    serve({
      portfolio: [
        projection("portfolio", "account-000000000010", 7, generatedAt, {
          authoritative: {
            partnerAgreementType: "resale",
            country: "US",
            currency: "USD",
          },
          title: "ACC-2A3B4C5D",
          description: "Partner",
          status: "active",
          statusLabel: "Active",
          tone: "neutral",
          value: "Partner",
          term: "Screening Passed",
          dateLabel: "Jul 1, 2026",
          context: [
            { label: "Country", value: "US" },
            { label: "Partner type", value: "Resale" },
          ],
        }),
      ],
      quotes: [openQuote],
      orders: [noticeOrder],
    });

    const projectionResult = await loadPartnerDashboardProjection();

    expect(projectionResult.agreement).toMatchObject({
      label: "ORD-7E6F5A4B service term",
      start: "2026-01-01T00:00:00.000Z",
      noticeStart: "2026-08-15T00:00:00.000Z",
      end: "2026-12-31T00:00:00.000Z",
      now: generatedAt,
      renewalState: "evergreen",
      authorityState: "Active · notice opens Aug 15, 2026",
      commercialRoute: "Resale",
    });
    expect(projectionResult.work).toEqual([
      {
        id: "quote-000000000003",
        account: "EC-11111111",
        task: "Prepare Artifact",
        evidence: "Not recorded",
        due: "Expires Aug 4, 2026 · 3 days remaining",
        href: "/partner/quotes/quote-000000000003",
        adminOnly: false,
        recordVersion: 3,
      },
    ]);
    expect(projectionResult.boundary).toEqual([
      { label: "Country", value: "US" },
      { label: "Partner type", value: "Resale" },
    ]);
  });

  it("reads the newest real commission record for a named drill-through", async () => {
    mocks.loadTopPortalRecords.mockResolvedValue(
      pageFor([commissionStatement]),
    );

    const projectionResult = await loadPartnerDashboardProjection();

    expect(mocks.loadTopPortalRecords).toHaveBeenCalledWith(
      "partner",
      "commissions",
      { limit: 1, orderBy: "updated_desc" },
      expect.objectContaining({ accountIds: [accountId] }),
    );
    expect(projectionResult.commission).toEqual({
      id: "STM-2026-Q3",
      statement: "Q3 commission statement",
      accruedAmount: "$18,420 accrued",
      href: "/partner/commissions?q=STM-2026-Q3",
    });
  });

  it("omits a commission position when no sourced amount exists", async () => {
    mocks.loadTopPortalRecords.mockResolvedValue(
      pageFor([
        projection("commissions", "STM-AMOUNT-PENDING", 1, generatedAt, {
          ...commissionStatement.data,
          value: NOT_RECORDED,
        }),
      ]),
    );

    const projectionResult = await loadPartnerDashboardProjection();

    expect(projectionResult.commission).toBeUndefined();
  });

  it("does not read or return commission data for a partner seller", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      accountIds: [accountId],
      selectedAccountId: accountId,
      roles: ["partner_seller"],
    });
    mocks.loadTopPortalRecords.mockResolvedValue(
      pageFor([commissionStatement]),
    );

    const projectionResult = await loadPartnerDashboardProjection();

    expect(mocks.loadTopPortalRecords).not.toHaveBeenCalled();
    expect(projectionResult.commission).toBeUndefined();
  });

  it("renders a partner with no records instead of failing the page", async () => {
    const projectionResult = await loadPartnerDashboardProjection();

    expect(projectionResult.work).toEqual([]);
    expect(projectionResult.commission).toBeUndefined();
    expect(projectionResult.boundary).toEqual([]);
    expect(projectionResult.agreement).toMatchObject({
      label: "No partner agreement term recorded",
      authorityState: "No partner agreement term recorded",
      renewalState: "expired",
      commercialRoute: "Not recorded",
      nextDecision: "No partner decision is pending.",
    });
    // TermBar throws unless the window is valid and ends before it is read.
    expect(Date.parse(projectionResult.agreement.start)).toBeLessThan(
      Date.parse(projectionResult.agreement.end),
    );
    expect(Date.parse(projectionResult.agreement.end)).toBeLessThan(
      Date.parse(projectionResult.agreement.now),
    );
  });
});
