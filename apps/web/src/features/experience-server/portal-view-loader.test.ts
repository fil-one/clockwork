import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExperienceProblem, type ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  list: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));
vi.mock("./projection-source", () => ({
  configuredProjectionSource: () => ({ list: mocks.list, find: mocks.find }),
  projectionInput: (input: Record<string, unknown>) => input,
}));

import {
  loadCommercialRecord,
  loadCustomerCollectionRecords,
  loadPartnerRecords,
  loadPortalRecords,
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

const foreignAccountId = "10000000-0000-4000-8000-000000000009";

interface FindInput {
  audience: string;
  channel: string;
  accountId: string | null;
  recordKey: string;
}

interface StoredRow {
  accountId: string;
  channel: string;
  recordKey: string;
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
        channel: "quotes",
        recordKey: input.recordKey,
        accountId: input.accountId,
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
