import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));

vi.mock("./projection-source", () => ({
  configuredProjectionSource: () => ({ find: mocks.find }),
}));

import { loadRecordArtifacts } from "./delivery";
import { ExperienceProblem } from "./model";

const accountA = "10000000-0000-4000-8000-000000000001";
const documentId = "90000000-0000-4000-8000-000000000001";

function captureErrorLog(): readonly { message: unknown; detail: unknown }[] {
  const entries: { message: unknown; detail: unknown }[] = [];
  vi.spyOn(console, "error").mockImplementation(
    (message: unknown, detail: unknown) => {
      entries.push({ message, detail });
    },
  );
  return entries;
}

beforeEach(() => {
  mocks.getCommerceSession.mockResolvedValue({
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: [accountA],
    selectedAccountId: accountA,
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.find.mockReset();
});

describe("loadRecordArtifacts applies its sibling's absence rule", () => {
  it("returns the record's documents when the read succeeds", async () => {
    mocks.find.mockResolvedValue({
      data: {
        artifacts: [
          {
            kind: "receipt",
            id: documentId,
            label: "Invoice",
            state: "stored",
          },
          { kind: "receipt", id: "not-a-uuid", label: "Bad", state: "stored" },
        ],
      },
    });
    await expect(
      loadRecordArtifacts("customer", "quotes", "Q-1"),
    ).resolves.toEqual([
      { kind: "receipt", id: documentId, label: "Invoice", state: "stored" },
    ]);
  });

  it("resolves to no documents when the record is absent", async () => {
    const logged = captureErrorLog();
    mocks.find.mockRejectedValue(
      new ExperienceProblem(404, "PROJECTION_NOT_FOUND", "Record not found"),
    );
    // 404 is the only outcome this may collapse: the lookup filters on
    // `audience_account_id` and the row policy repeats the test, so another
    // account's row and a row that was never written are one thing. Telling
    // them apart above this line would be an enumeration oracle.
    await expect(
      loadRecordArtifacts("customer", "quotes", "Q-1"),
    ).resolves.toEqual([]);
    expect(logged).toHaveLength(0);
  });

  it.each([
    [401, "SESSION_REQUIRED"],
    [403, "PROJECTION_FORBIDDEN"],
    [409, "PROJECTION_CONFLICT"],
    [410, "PROJECTION_GONE"],
    [422, "PROJECTION_INVALID"],
    [502, "PROJECTION_SOURCE_UNAVAILABLE"],
    [503, "PROJECTION_UNAVAILABLE"],
  ] as const)(
    "refuses to report a %d as an absence of documents",
    async (status, code) => {
      const logged = captureErrorLog();
      mocks.find.mockRejectedValue(
        new ExperienceProblem(status, code, "Projection read refused"),
      );

      // The defect this closes: every one of these used to resolve to `[]`,
      // and the panel then told the customer "No generated artifacts are
      // attached to this record" -- a false statement about their own
      // agreements and invoices, with nothing in the log to contradict it.
      await expect(
        loadRecordArtifacts("customer", "agreements", "A-1"),
      ).rejects.toMatchObject({ status, code });

      expect(logged).toHaveLength(1);
      expect(logged[0]?.message).toBe("Record artifact read failed");
      expect(logged[0]?.detail).toMatchObject({
        audience: "customer",
        channel: "agreements",
        recordKey: "A-1",
        code,
        status,
      });
    },
  );

  it("refuses to report a defect as an absence of documents", async () => {
    const logged = captureErrorLog();
    mocks.find.mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'S')"),
    );
    await expect(
      loadRecordArtifacts("customer", "billing", "INV-1"),
    ).rejects.toThrow("Cannot read properties of undefined (reading 'S')");
    expect(logged).toHaveLength(1);
    expect(logged[0]?.detail).toMatchObject({
      recordKey: "INV-1",
      code: "UNEXPECTED",
      error: { name: "TypeError" },
    });
  });

  it("never resolves to an empty list for anything but absence", async () => {
    // Stated once as the rule rather than per status, because the guard that
    // shipped was written the other way round -- it named the exception and
    // let the family through -- and this is the assertion that shape fails.
    captureErrorLog();
    for (const status of [401, 403, 409, 410, 422, 502, 503] as const) {
      mocks.find.mockRejectedValue(
        new ExperienceProblem(status, "REFUSED", "Refused"),
      );
      const outcome = await loadRecordArtifacts("customer", "orders", "O-1")
        .then((artifacts) => ({ resolved: artifacts }))
        .catch(() => ({ resolved: null }));
      expect(
        outcome.resolved,
        `${status} resolved instead of throwing`,
      ).toBeNull();
    }
  });
});
