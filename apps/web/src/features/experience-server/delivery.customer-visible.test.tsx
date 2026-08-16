import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the customer is actually shown when the projection source refuses.
 *
 * `delivery.test.ts` pins the rule at the function. This pins the consequence
 * at the surface, because the defect was never visible as a return value: the
 * refusal became `[]`, `[]` became "No generated artifacts are attached to
 * this record", and a customer reading their own agreement was told a false
 * thing about their own documents. `loadRecordArtifacts` is deliberately NOT
 * stubbed here -- the whole point is to drive the real one from the surface
 * that renders its result.
 */
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

import { CommercialRecordDetail } from "@/src/features/customer-partner/commercial/record-detail";
import type { CommercialRecord } from "@/src/features/customer-partner/commercial/model";

import { ExperienceProblem } from "./model";

const accountId = "10000000-0000-4000-8000-000000000001";

const emptyStateCopy = "No generated artifacts are attached to this record.";

function agreement(): CommercialRecord {
  return {
    id: "A-2026-0031",
    kind: "agreements",
    title: "Master services agreement",
    description: "Northstar primary archive",
    status: "executed",
    statusLabel: "Executed",
    tone: "success",
    risk: "low",
    owner: "Legal",
    value: "$0.00",
    valueLabel: "Contract value",
    updatedAt: "2026-07-31T08:00:00.000Z",
    dateLabel: "Executed Jul 31",
    href: "/agreements/A-2026-0031",
    term: "36 months",
    nextAction: "No action required",
    version: "1",
    aggregateId: "50000000-0000-4000-8000-000000000031",
    allowedActions: [],
    projectionId: "60000000-0000-4000-8000-000000000031",
  };
}

beforeEach(() => {
  mocks.getCommerceSession.mockResolvedValue({
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
    accountIds: [accountId],
    selectedAccountId: accountId,
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.find.mockReset();
});

describe("a refused document read is never shown as an absence of documents", () => {
  it("refuses to render the record rather than claim it has no documents, on a 403", async () => {
    mocks.find.mockRejectedValue(
      new ExperienceProblem(
        403,
        "PROJECTION_FORBIDDEN",
        "The projection is outside the authorized scope",
      ),
    );

    // The surface never resolves, so the segment's `error.tsx` renders in its
    // place. Nothing the customer can read makes a claim about their documents.
    await expect(
      CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "A-2026-0031",
        record: agreement(),
      }),
    ).rejects.toMatchObject({ status: 403, code: "PROJECTION_FORBIDDEN" });
  });

  it("says the record has no documents only when the record really has none", async () => {
    mocks.find.mockResolvedValue({ data: { artifacts: [] } });
    const view = render(
      await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "A-2026-0031",
        record: agreement(),
      }),
    );
    // The sentence is not wrong in itself -- it is the truthful empty state,
    // and this asserts the fix did not cost it.
    expect(view.container.textContent).toContain(emptyStateCopy);
  });

  it("never puts the empty-state sentence on screen for any refused read", async () => {
    for (const status of [401, 403, 409, 410, 422, 502, 503] as const) {
      mocks.find.mockRejectedValue(
        new ExperienceProblem(status, "REFUSED", "Refused"),
      );
      const rendered = await CommercialRecordDetail({
        accountId,
        canMutate: true,
        id: "A-2026-0031",
        record: agreement(),
      })
        .then((tree) => render(tree).container.textContent ?? "")
        .catch(() => null);
      expect(
        rendered,
        `${status} rendered a surface; it would have contained: ${
          rendered?.includes(emptyStateCopy) ? emptyStateCopy : "(no claim)"
        }`,
      ).toBeNull();
    }
  });
});
