import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RequestRenewal = (
  input: {
    accountId: string;
    orderId: string;
    requestedAction: "renew" | "change_term" | "request_change";
    requestedTermMonths: number | null;
  },
  options: { idempotencyKey: string },
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestRenewal: vi.fn<RequestRenewal>(),
  sendProjectionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mocks.refresh,
    replace: vi.fn(),
  }),
  usePathname: () => "/partner/renewals",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/src/features/contracts/commerce-client", () => ({
  requestRenewal: mocks.requestRenewal,
}));
vi.mock("@/src/features/contracts/experience-client", () => ({
  sendProjectionAction: mocks.sendProjectionAction,
}));

import { PartnerCollection } from "./partner-collection";
import { partnerSurfaces } from "./partner-data";

const formatting = { locale: "en-US", timeZone: "America/New_York" };
const freshness = {
  generatedAt: "2026-08-18T12:00:00.000Z",
  partial: false,
  stale: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestRenewal.mockResolvedValue({ status: "pending" });
});

describe("partner renewal collection action", () => {
  it("uses the guided demo's bound order and refreshes the durable ledger", async () => {
    const user = userEvent.setup();
    render(
      <PartnerCollection
        config={partnerSurfaces.renewals}
        formatting={formatting}
        freshness={freshness}
        partnerName="Aurora Systems"
        renewalContext={{
          accountId: "11000000-0000-4000-8000-000000000006",
          orderId: "demo-partner-renewal-ec-0038",
        }}
        roles={["partner_admin"]}
        surface="renewals"
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Review Halcyon Research Cooperative",
      }),
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Confirm renewal request" }),
    );

    await waitFor(() => expect(mocks.requestRenewal).toHaveBeenCalledOnce());
    const [input, options] = mocks.requestRenewal.mock.calls[0] ?? [];
    expect(input).toEqual({
      accountId: "11000000-0000-4000-8000-000000000006",
      orderId: "demo-partner-renewal-ec-0038",
      requestedAction: "renew",
      requestedTermMonths: 12,
    });
    expect(options?.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(mocks.sendProjectionAction).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/renewal request submitted/i)).toBeVisible();
  });

  it("keeps an already-requested renewal non-actionable", async () => {
    const user = userEvent.setup();
    const renewal = partnerSurfaces.renewals.records[0];
    if (!renewal) throw new Error("The renewal fixture is unavailable");
    render(
      <PartnerCollection
        config={{
          ...partnerSurfaces.renewals,
          records: [
            {
              ...renewal,
              status: "pending",
              secondary:
                "Renewal request submitted · awaiting Fil One confirmation",
            },
          ],
        }}
        formatting={formatting}
        freshness={freshness}
        partnerName="Aurora Systems"
        renewalContext={{
          accountId: "11000000-0000-4000-8000-000000000006",
          orderId: "demo-partner-renewal-ec-0038",
        }}
        roles={["partner_admin"]}
        surface="renewals"
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Review Halcyon Research Cooperative",
      }),
    );
    await user.click(screen.getByRole("checkbox"));

    expect(
      screen.getByRole("button", { name: "Confirm renewal request" }),
    ).toBeDisabled();
    expect(mocks.requestRenewal).not.toHaveBeenCalled();
  });
});
