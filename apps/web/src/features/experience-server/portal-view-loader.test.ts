import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExperienceProblem, type ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  list: vi.fn(),
  find: vi.fn(),
  findPreparedOrderForm: vi.fn(),
  findPreparedQuoteArtifact: vi.fn(),
  findCustomerQuoteCurrency: vi.fn(),
  findActiveCustomerQuoteOffers: vi.fn(),
  runtimeDatabase: vi.fn(),
  serviceDatabase: vi.fn(),
  demoPreparedOrderForm: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
  explicitDemoIdentityEnabled: () =>
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER === "demo" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV !== "production",
}));
vi.mock("./projection-source", () => ({
  configuredProjectionSource: () => ({ list: mocks.list, find: mocks.find }),
  projectionInput: (input: Record<string, unknown>) => input,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalRuntimeDatabase: mocks.runtimeDatabase,
  getOptionalServiceDatabase: mocks.serviceDatabase,
}));
vi.mock("./demo-order-acceptance", () => ({
  demoOrderAcceptance: () => ({
    preparedOrderForm: mocks.demoPreparedOrderForm,
  }),
}));
vi.mock("@clockwork/db", () => ({
  findPreparedOrderForm: mocks.findPreparedOrderForm,
  findPreparedQuoteArtifact: mocks.findPreparedQuoteArtifact,
  findCustomerQuoteCurrency: mocks.findCustomerQuoteCurrency,
  findActiveCustomerQuoteOffers: mocks.findActiveCustomerQuoteOffers,
  // The transaction wrapper is the authorization boundary, not the thing under
  // test here; it is exercised against a live database by the repositories
  // that use it. What matters at this level is that the read runs *inside* it.
  withAuthorizedTransaction: (
    _database: unknown,
    _context: unknown,
    _options: unknown,
    operation: (transaction: unknown) => unknown,
  ) => operation({ authorized: true }),
  withInternalTransaction: (
    _database: unknown,
    _requestId: unknown,
    operation: (transaction: unknown) => unknown,
  ) => operation({ internal: true }),
}));

import {
  loadCommercialRecord,
  loadBuyQuoteProjection,
  loadCustomerQuoteOffers,
  loadCustomerCollectionRecords,
  loadPartnerRecords,
  loadPortalRecords,
  loadPreparedOrderForm,
  loadPreparedQuoteArtifact,
  loadTopPortalRecords,
  recordRoute,
  MAX_PROJECTION_PAGES,
  PROJECTION_PAGE_SIZE,
} from "./portal-view-loader";
import { collectionKinds } from "@/src/features/customer-partner/commercial/model";

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
  delete process.env.CLOCKWORK_EXPERIENCE_ADAPTER;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV;
  mocks.getCommerceSession.mockResolvedValue({
    accountIds: [accountId],
    selectedAccountId: accountId,
    roles: ["partner_admin"],
  });
});

describe("customer quote offer catalogue", () => {
  beforeEach(() => {
    process.env.AUTHORIZATION_CONTEXT_SECRET = "x".repeat(48);
    mocks.runtimeDatabase.mockReturnValue({ runtime: true });
    mocks.serviceDatabase.mockReturnValue({ service: true });
    mocks.findCustomerQuoteCurrency.mockResolvedValue("USD");
    mocks.getCommerceSession.mockResolvedValue({
      accountIds: [accountId],
      selectedAccountId: accountId,
      roles: ["owner"],
    });
  });

  it("maps every compatible active row without exposing confidential price data", async () => {
    mocks.findActiveCustomerQuoteOffers.mockResolvedValue([
      {
        price_book_id: "60000000-0000-4000-8000-000000000001",
        price_book_name: "Northstar USD 2026",
        currency: "USD",
        version: 1,
        sku: "LOCKED-STORAGE-TB",
        approved_claim: "Immutable capacity",
        region: "us-east-2",
      },
      {
        price_book_id: "60000000-0000-4000-8000-000000000009",
        price_book_name: "Northstar Compliance 2026",
        currency: "USD",
        version: 2,
        sku: "LOCKED-COMPLIANCE-TB",
        approved_claim: "Immutable capacity",
        region: "us-east-2",
      },
    ]);

    const result = await loadCustomerQuoteOffers();

    expect(mocks.findCustomerQuoteCurrency).toHaveBeenCalledWith(
      { authorized: true },
      { accountId },
    );
    const activeOfferCalls = mocks.findActiveCustomerQuoteOffers.mock
      .calls as unknown as Array<[unknown, { currency: string; now: unknown }]>;
    expect(activeOfferCalls).toHaveLength(1);
    expect(activeOfferCalls[0]?.[0]).toEqual({ internal: true });
    expect(activeOfferCalls[0]?.[1].currency).toBe("USD");
    expect(activeOfferCalls[0]?.[1].now).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      status: "available",
      catalogueMode: "authoritative",
    });
    if (result.status !== "available") throw new Error("catalogue unavailable");
    expect(result.offers).toHaveLength(2);
    expect(new Set(result.offers.map((offer) => offer.label)).size).toBe(2);
    expect(result.offers[0]?.label).not.toContain(
      "60000000-0000-4000-8000-000000000001",
    );
    expect(JSON.stringify(result.offers)).not.toContain("unit_amount_minor");
  });

  it("uses persisted active demo price books behind the explicit safe demo adapter", async () => {
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER = "demo";

    const result = await loadCustomerQuoteOffers();

    expect(result).toMatchObject({
      status: "available",
      catalogueMode: "authoritative",
    });
    if (result.status !== "available") throw new Error("catalogue unavailable");
    expect(result.offers.length).toBeGreaterThan(0);
    expect(
      result.offers.every((offer) => offer.sku === "LOCKED-STORAGE-TB"),
    ).toBe(true);
    expect(mocks.findCustomerQuoteCurrency).not.toHaveBeenCalled();
    expect(mocks.findActiveCustomerQuoteOffers).not.toHaveBeenCalled();
  });

  it("never falls back to demo offers when the authoritative databases are missing", async () => {
    mocks.serviceDatabase.mockReturnValue(undefined);

    await expect(loadCustomerQuoteOffers()).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.findActiveCustomerQuoteOffers).not.toHaveBeenCalled();
  });

  it("refuses simulated offers when a deployment marker identifies production", async () => {
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER = "demo";
    process.env.VERCEL_ENV = "production";
    mocks.serviceDatabase.mockReturnValue(undefined);

    await expect(loadCustomerQuoteOffers()).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.findActiveCustomerQuoteOffers).not.toHaveBeenCalled();
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

const foreignAccountId = "10000000-0000-4000-8000-000000000009";

interface FindInput {
  audience: string;
  channel: string;
  accountId: string | null;
  recordKey: string;
}

interface StoredRow {
  accountId: string;
  channel: ProjectionRecord["channel"];
  recordKey: string;
  aggregateType?: string;
  data: Readonly<Record<string, unknown>>;
}

function commercialPayload(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id,
    kind: "quotes",
    title: `${id} title`,
    description: `${id} description`,
    status: "open",
    statusLabel: "Open",
    tone: "warning",
    risk: "medium",
    owner: "Authorized account team",
    value: "$184,800.00",
    valueLabel: "Authoritative value",
    dateLabel: "Updated Jul 31",
    term: "Bound to the current account term",
    nextAction: "Review",
    allowedActions: [],
    ...overrides,
  };
}

/**
 * Stands in for `findProjection`. Its `where` clause pins
 * `audience_account_id` to the account the session resolved, and the
 * `experience_projection_read` policy repeats the same test, so a row on
 * another account is not in the result set at all -- indistinguishable, from
 * the query's side, from a row that was never written. Both leave the
 * statement with no row and raise the one `PROJECTION_NOT_FOUND`. The fake
 * reproduces exactly that: it filters, it does not report.
 */
function storeContaining(rows: readonly StoredRow[]) {
  mocks.find.mockImplementation((input: FindInput) => {
    const row = rows.find(
      (candidate) =>
        candidate.accountId === input.accountId &&
        candidate.channel === input.channel &&
        candidate.recordKey === input.recordKey,
    );
    if (!row)
      return Promise.reject(
        new ExperienceProblem(
          404,
          "PROJECTION_NOT_FOUND",
          "Projection record not found",
        ),
      );
    return Promise.resolve(
      projection({
        audience: "customer",
        channel: row.channel,
        recordKey: input.recordKey,
        accountId: input.accountId,
        aggregateType: row.aggregateType ?? "quote",
        data: row.data,
      }),
    );
  });
}

describe("commercial record detail reads", () => {
  const mine: StoredRow = {
    accountId,
    channel: "quotes",
    recordKey: "Q-MINE-0001",
    data: commercialPayload("Q-MINE-0001"),
  };
  const theirs: StoredRow = {
    accountId: foreignAccountId,
    channel: "quotes",
    recordKey: "Q-THEIRS-0001",
    data: commercialPayload("Q-THEIRS-0001", {
      title: "Another tenant's quote",
    }),
  };

  it("returns the record the reader's own account holds", async () => {
    storeContaining([mine, theirs]);

    const record = await loadCommercialRecord("quotes", "Q-MINE-0001");

    expect(record?.title).toBe("Q-MINE-0001 title");
    expect(record?.href).toBe("/quotes/Q-MINE-0001");
  });

  it("keeps a quote revision separate from its projection row version", async () => {
    storeContaining([
      {
        ...mine,
        data: commercialPayload("Q-MINE-0001", {
          reference: "Q-2026-0312",
          authoritative: { revision: 2 },
        }),
      },
    ]);

    const record = await loadCommercialRecord("quotes", "Q-MINE-0001");

    expect(record).toMatchObject({
      reference: "Q-2026-0312",
      version: "2",
      projectionVersion: 3,
    });
  });

  it.each([
    ["submitted", "attention"],
    ["accepted", "accepted"],
    ["provisioning", "attention"],
    ["active", "active"],
    ["amended", "attention"],
    ["completed", "complete"],
    ["cancelled", "attention"],
    ["terminated", "attention"],
  ] as const)(
    "carries authoritative order state %s beside public presentation state %s",
    async (authoritativeStatus, publicStatus) => {
      const recordKey = `ORDER-${authoritativeStatus}`;
      storeContaining([
        {
          accountId,
          aggregateType: "order",
          channel: "orders",
          recordKey,
          data: commercialPayload(recordKey, {
            authoritative: { status: authoritativeStatus },
            kind: "orders",
            status: publicStatus,
            statusLabel: publicStatus,
          }),
        },
      ]);

      const record = await loadCommercialRecord("orders", recordKey);

      expect(record?.status).toBe(publicStatus);
      expect(record?.orderLifecycleStatus).toBe(authoritativeStatus);
    },
  );

  it.each([
    ["missing", undefined],
    ["null", null],
    ["array", []],
    ["missing status", {}],
    ["non-string status", { status: 3 }],
    ["unknown status", { status: "attention" }],
  ])("fails safe for %s authoritative order state", async (_label, value) => {
    const recordKey = "ORDER-MALFORMED";
    storeContaining([
      {
        accountId,
        aggregateType: "order",
        channel: "orders",
        recordKey,
        data: commercialPayload(recordKey, {
          authoritative: value,
          kind: "orders",
          status: "attention",
          statusLabel: "Attention",
        }),
      },
    ]);

    const record = await loadCommercialRecord("orders", recordKey);

    expect(record).toHaveProperty("orderLifecycleStatus", null);
  });

  it("does not attach order lifecycle state to another commercial kind", async () => {
    storeContaining([
      {
        ...mine,
        data: commercialPayload("Q-MINE-0001", {
          authoritative: { status: "accepted" },
        }),
      },
    ]);

    const record = await loadCommercialRecord("quotes", "Q-MINE-0001");

    expect(record).not.toHaveProperty("orderLifecycleStatus");
  });

  it("resolves to null for a reference that does not exist", async () => {
    storeContaining([mine, theirs]);

    await expect(
      loadCommercialRecord("quotes", "Q-NOT-A-RECORD"),
    ).resolves.toBeNull();
  });

  /**
   * The security property, stated as an assertion rather than a comment: a
   * reference that belongs to another account and one that belongs to nobody
   * must produce the same value here. If they ever diverge, the detail route
   * becomes an oracle for another tenant's identifiers.
   */
  it("cannot be used to tell a foreign reference from a missing one", async () => {
    storeContaining([mine, theirs]);

    const foreign = await loadCommercialRecord("quotes", "Q-THEIRS-0001");
    const absent = await loadCommercialRecord("quotes", "Q-NOT-A-RECORD");

    expect(foreign).toBeNull();
    expect(foreign).toEqual(absent);
  });

  it("still reports a row whose payload does not satisfy the contract", async () => {
    const withoutTitle = { ...commercialPayload("Q-MINE-0001"), title: "" };
    storeContaining([{ ...mine, data: withoutTitle }]);

    await expect(loadCommercialRecord("quotes", "Q-MINE-0001")).rejects.toThrow(
      "Projection record omitted title",
    );
  });

  it("still reports a channel binding the projection contradicts", async () => {
    storeContaining([
      { ...mine, data: commercialPayload("Q-MINE-0001", { kind: "orders" }) },
    ]);

    await expect(loadCommercialRecord("quotes", "Q-MINE-0001")).rejects.toThrow(
      "Commercial projection channel binding is invalid",
    );
  });

  it.each([
    new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "Account access denied",
    ),
    new ExperienceProblem(409, "VERSION_CONFLICT", "Projection record changed"),
    new ExperienceProblem(503, "PROJECTION_ADAPTER_INVALID", "Adapter invalid"),
    new Error("connection terminated unexpectedly"),
  ])(
    "still reports $message rather than calling it an absence",
    async (raised) => {
      mocks.find.mockRejectedValue(raised);

      await expect(
        loadCommercialRecord("quotes", "Q-MINE-0001"),
      ).rejects.toThrow(raised.message);
    },
  );
});

/**
 * `recordRoute` used to return `string`, and for `services` it returned the
 * collection path rather than a record path, so every row on the
 * live-entitlements surface linked to the page the reader was already on.
 *
 * `CommercialRecordRoute` now rejects that body at compile time -- its own doc
 * comment states exactly which half does what, and why `Route<...>` alone did
 * not. These assertions hold the part the type cannot: that the value carries
 * the *record key*, per kind, and that the key is percent-encoded so it cannot
 * open a second path segment. `/${kind}/index` satisfies the type and fails
 * here.
 */
describe("commercial record routes", () => {
  it.each(collectionKinds)(
    "addresses a %s record, not its collection",
    (kind) => {
      const href = recordRoute(kind, "REC-0001");

      expect(href).toBe(`/${kind}/REC-0001`);
      expect(href).not.toBe(`/${kind}`);
    },
  );

  it("escapes a reference so it cannot open a second path segment", () => {
    expect(recordRoute("services", "svc/../orders/ORD-1")).toBe(
      "/services/svc%2F..%2Forders%2FORD-1",
    );
  });
});

/**
 * The page ceiling used to `throw`. An account whose channel had grown past
 * `PROJECTION_PAGE_SIZE * MAX_PROJECTION_PAGES` records could not open the
 * route at all -- a control refusing a legitimate read, which is the same
 * class of defect as one that returns a wrong value.
 *
 * What is asserted here is the whole replacement contract: the read resolves,
 * it returns the prefix it managed to read, and it says so twice -- `truncated`
 * for a surface that can disclose it, `stale` for one that only understands
 * freshness. Nothing here silently becomes a complete answer.
 */
describe("projection reads past the page ceiling", () => {
  function endlessChannel() {
    let page = 0;
    mocks.list.mockImplementation(() => {
      page += 1;
      return Promise.resolve({
        items: [
          projection({
            audience: "customer",
            channel: "quotes",
            recordKey: `Q-${page}`,
            data: partnerPayload([]),
          }),
        ],
        nextCursor: `cursor-${page}`,
        generatedAt: "2026-08-01T00:00:00.000Z",
        freshnessSeconds: 300,
      });
    });
  }

  it("returns the records it read instead of refusing the read", async () => {
    endlessChannel();

    const page = await loadPortalRecords("customer", "quotes");

    expect(page.pagesRead).toBe(MAX_PROJECTION_PAGES);
    expect(page.recordCount).toBe(MAX_PROJECTION_PAGES);
    expect(page.records).toHaveLength(MAX_PROJECTION_PAGES);
  });

  it("marks the partial result truncated and stale", async () => {
    endlessChannel();

    const page = await loadPortalRecords("customer", "quotes");

    expect(page.truncated).toBe(true);
    expect(page.stale).toBe(true);
  });

  it("stops asking the server once the ceiling is reached", async () => {
    endlessChannel();

    await loadPortalRecords("customer", "quotes");

    expect(mocks.list).toHaveBeenCalledTimes(MAX_PROJECTION_PAGES);
  });

  it("reports a complete read as neither truncated nor stale", async () => {
    returns([projection({ data: partnerPayload([]) })]);

    const page = await loadPortalRecords("partner", "quotes");

    expect(page.truncated).toBe(false);
    expect(page.stale).toBe(false);
    expect(page.pagesRead).toBe(1);
  });
});

/**
 * The top-N read. `order by` and `limit` go to the server, so a surface that
 * wants the newest twenty-five rows reads twenty-five rows -- it is not a
 * slice taken after reading everything, which is what the loop above does.
 *
 * The refused set is exactly one thing: a `limit` that is not a positive safe
 * integer. Every audience, every channel, both orderings and every limit from
 * 1 upwards are accepted; a limit above one server page is clamped to a page
 * rather than rejected, because asking for more than the server will return in
 * one page is a legitimate request for "as many as one page holds".
 */
describe("top-N projection reads", () => {
  function onePageOf(count: number, nextCursor: string | null) {
    mocks.list.mockResolvedValue({
      items: Array.from({ length: count }, (_unused, index) =>
        projection({
          audience: "customer",
          channel: "agreements",
          recordKey: `A-${index}`,
          data: partnerPayload([]),
        }),
      ),
      nextCursor,
      generatedAt: "2026-08-01T00:00:00.000Z",
      freshnessSeconds: 300,
    });
  }

  it("asks the server for the ordering and the limit, and reads one page", async () => {
    onePageOf(3, null);

    const page = await loadTopPortalRecords("customer", "agreements", {
      limit: 25,
      orderBy: "updated_desc",
    });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "customer",
        channel: "agreements",
        limit: 25,
        orderBy: "updated_desc",
      }),
    );
    expect(page.pagesRead).toBe(1);
    expect(page.records).toHaveLength(3);
  });

  it("passes the ascending ordering through rather than reversing a read", async () => {
    onePageOf(2, null);

    await loadTopPortalRecords("customer", "agreements", {
      limit: 5,
      orderBy: "updated_asc",
    });

    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, orderBy: "updated_asc" }),
    );
  });

  it("says the answer is a prefix when the channel held more", async () => {
    onePageOf(25, "cursor-1");

    const page = await loadTopPortalRecords("customer", "agreements", {
      limit: 25,
      orderBy: "updated_desc",
    });

    expect(page.truncated).toBe(true);
    expect(page.stale).toBe(true);
  });

  it("clamps a limit above one server page rather than refusing it", async () => {
    onePageOf(1, null);

    await loadTopPortalRecords("customer", "agreements", {
      limit: PROJECTION_PAGE_SIZE * 4,
      orderBy: "updated_desc",
    });

    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: PROJECTION_PAGE_SIZE }),
    );
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "refuses %s as a limit, the entire refused set",
    async (limit) => {
      onePageOf(1, null);

      await expect(
        loadTopPortalRecords("customer", "agreements", {
          limit,
          orderBy: "updated_desc",
        }),
      ).rejects.toThrow("Projection top-N limit must be a positive integer");
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );
});

/**
 * The read that carries the order-acceptance bridge between its two passes.
 *
 * It is not a projection read and must not become one: `orders:prepare_artifact`
 * writes no order row, and `orders.order_form_document_id` -- the only value the
 * orders channel could ever answer with -- is written by the create branch this
 * document is the precondition for.
 */
describe("prepared order form", () => {
  const orderId = "70000000-0000-4000-8000-000000000001";
  const documentId = "80000000-0000-4000-8000-000000000001";
  const artifactId = "80000000-0000-4000-8000-0000000000a1";

  beforeEach(() => {
    process.env.AUTHORIZATION_CONTEXT_SECRET = "x".repeat(48);
    delete process.env.CLOCKWORK_EXPERIENCE_ADAPTER;
    mocks.runtimeDatabase.mockReturnValue({ db: {} });
    mocks.demoPreparedOrderForm.mockResolvedValue(null);
  });

  it("answers with the document the renderer stored", async () => {
    mocks.findPreparedOrderForm.mockResolvedValue({
      documentId,
      orderId,
      artifactId,
    });

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "stored",
      documentId,
      artifactId,
    });
    expect(mocks.findPreparedOrderForm).toHaveBeenCalledWith(
      { authorized: true },
      { orderId },
    );
  });

  it("answers pending while no stored request exists", async () => {
    mocks.findPreparedOrderForm.mockResolvedValue(null);

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "pending",
    });
  });

  /**
   * Reporting "still rendering" here would leave the reader polling something
   * no part of this deployment is producing.
   */
  it("says it cannot answer when no authoritative database is composed", async () => {
    mocks.runtimeDatabase.mockReturnValue(undefined);

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.findPreparedOrderForm).not.toHaveBeenCalled();
  });

  /**
   * The demo used to answer `unavailable` here unconditionally, which is what
   * dead-ended its acceptance journey: the reader was told the workspace could
   * not confirm whether the order form had been rendered, for ever, with no
   * further pass available. It CAN confirm it. The demo's prepare pass records
   * a real artifact request bound to the order it named, and this reads it --
   * never touching the authoritative lookup, which has no database behind it
   * on a demo deploy.
   */
  it("reads the demo's own prepared request on demo data", async () => {
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER = "demo";
    mocks.demoPreparedOrderForm.mockResolvedValue({
      documentId,
      orderId,
      artifactId,
    });

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "stored",
      documentId,
      artifactId,
    });
    expect(mocks.demoPreparedOrderForm).toHaveBeenCalledWith(orderId);
    expect(mocks.findPreparedOrderForm).not.toHaveBeenCalled();
  });

  it("answers pending on demo data until the first pass has run", async () => {
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER = "demo";
    mocks.demoPreparedOrderForm.mockResolvedValue(null);

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "pending",
    });
    expect(mocks.findPreparedOrderForm).not.toHaveBeenCalled();
  });

  it("says it cannot answer without an authorization secret to sign with", async () => {
    process.env.AUTHORIZATION_CONTEXT_SECRET = "too-short";

    await expect(loadPreparedOrderForm(orderId)).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.findPreparedOrderForm).not.toHaveBeenCalled();
  });
});

describe("Buy quote bridge", () => {
  const quoteId = "60000000-0000-4000-8000-000000000001";
  const documentId = "80000000-0000-4000-8000-000000000001";
  const artifactId = "80000000-0000-4000-8000-0000000000a1";

  beforeEach(() => {
    process.env.AUTHORIZATION_CONTEXT_SECRET = "x".repeat(48);
    delete process.env.CLOCKWORK_EXPERIENCE_ADAPTER;
    mocks.runtimeDatabase.mockReturnValue({ db: {} });
  });

  it("reads the stored direct-quote artifact inside the authorized transaction", async () => {
    mocks.findPreparedQuoteArtifact.mockResolvedValue({
      quoteId,
      documentId,
      artifactId,
    });

    await expect(loadPreparedQuoteArtifact(quoteId)).resolves.toEqual({
      status: "stored",
      documentId,
      artifactId,
    });
    expect(mocks.findPreparedQuoteArtifact).toHaveBeenCalledWith(
      { authorized: true },
      { quoteId },
    );
  });

  it("does not pretend the demo can issue its simulated draft", async () => {
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER = "demo";

    await expect(loadPreparedQuoteArtifact(quoteId)).resolves.toEqual({
      status: "unavailable",
    });
    expect(mocks.findPreparedQuoteArtifact).not.toHaveBeenCalled();
  });

  it("confirms only the exact authoritative issued quote projection", async () => {
    mocks.find.mockResolvedValue(
      projection({
        audience: "customer",
        aggregateId: quoteId,
        recordKey: `quote-${quoteId}`,
        version: 2,
        data: {
          authoritative: {
            status: "issued",
            totalMinor: "120000",
            currency: "USD",
            marginFloorResult: "pass",
          },
        },
      }),
    );

    await expect(loadBuyQuoteProjection(quoteId)).resolves.toEqual({
      status: "found",
      quoteStatus: "issued",
      rowVersion: 2,
      totalMinor: "120000",
      currency: "USD",
      marginResult: "pass",
    });
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "customer",
        channel: "quotes",
        recordKey: `quote-${quoteId}`,
      }),
    );
  });

  it("keeps an absent exact projection pending instead of choosing another quote", async () => {
    mocks.find.mockRejectedValue(
      new ExperienceProblem(404, "PROJECTION_NOT_FOUND", "not found"),
    );

    await expect(loadBuyQuoteProjection(quoteId)).resolves.toEqual({
      status: "pending",
    });
  });
});
