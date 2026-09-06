import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaygOfferRecord } from "@clockwork/domain/core";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { PaygOfferAdministration } from "./payg-offers";

const creator = "20000000-0000-4000-8000-000000000001";
const offer: PaygOfferRecord = {
  id: "30000000-0000-4000-8000-000000000001",
  rowVersion: 1,
  status: "draft",
  createdBy: creator,
  lastEditedBy: creator,
  proposedBy: null,
  approvedBy: null,
  approvalEvidenceId: null,
  decisionReason: "",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  terms: {
    name: "Direct PAYG",
    sku: "OBJECT_PAYG",
    region: "france",
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://docs.fil.one/billing/trial",
    sourceCheckedAt: "2026-09-01T00:00:00.000Z",
    sourceDocumentId: "source-document",
    owner: "Finance",
    payg: {
      currency: "USD",
      storageTbMonthMinor: "499",
      monthlyMinimumMinor: "499",
      partialMonthMinimum: "full",
      correctionWindowDays: 90,
      aggregation: "hourly_average_daily_utc",
      egressRateMinor: "0",
      apiRateMinor: "0",
      stripeTaxCode: "txcd_10103001",
      qboIncomeAccount: "4000-Storage",
    },
    trial: {
      durationDays: 30,
      gracePeriodDays: 7,
      storageLimitBytes: "1000000000000",
      cumulativeEgressLimitBytes: "2000000000000",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  document.cookie =
    "clockwork-csrf=payg-ui-csrf-token-0000000000000001; path=/";
});

describe("operable PAYG and trial policy administration", () => {
  it("distinguishes an unavailable database and disables policy changes", () => {
    render(
      <PaygOfferAdministration
        offers={[]}
        available={false}
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    expect(screen.getByText(/policy database is unavailable/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "New policy draft" }),
    ).toBeDisabled();
  });
  it("saves changed pricing and trial policy with concurrency and CSRF protection", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(
        typeof init.body === "string" ? init.body : "{}",
      ) as { terms: unknown };
      return Promise.resolve(
        new Response(
          JSON.stringify({ ...offer, rowVersion: 2, terms: body.terms }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    render(
      <PaygOfferAdministration
        offers={[offer]}
        available
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    const price = screen.getByRole("textbox", { name: /Price per TB-month/ });
    await user.clear(price);
    await user.type(price, "5.49");
    const grace = screen.getByRole("spinbutton", {
      name: "Read-only grace period (days)",
    });
    await user.clear(grace);
    await user.type(grace, "14");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(
      JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown,
    ).toMatchObject({
      action: "save",
      id: offer.id,
      expectedRowVersion: 1,
      terms: {
        payg: { storageTbMonthMinor: "549", monthlyMinimumMinor: "499" },
        trial: { gracePeriodDays: 14 },
      },
    });
    expect(init.headers).toMatchObject({
      "x-csrf-token": expect.any(String) as unknown,
      "idempotency-key": expect.any(String) as unknown,
    });
    expect(await screen.findByText(/Policy version 1 is draft/)).toBeVisible();
  });
  it("records a verified enrollment with the selected policy and no implicit billing cutover", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ enrollment: { id: "enrollment-result" } }),
        { status: 200 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[
          {
            ...offer,
            status: "approved",
            approvalEvidenceId: "approved-policy",
          },
        ]}
        available
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    await user.click(screen.getByText("Record verified enrollment"));
    for (const [label, text] of [
      ["Customer account ID", creator],
      ["Verified provider organization ID", "org-verified"],
      ["Verified provider tenant ID", "tenant-verified"],
      ["Verified provider entitlement ID", "entitlement-verified"],
      ["Metering source name", "fil-one"],
      ["Verified mapping version", "mapping-v1"],
      ["Identity verification evidence reference", "evidence-verified"],
      ["Confirmed service start (UTC, full hour)", "2026-09-01T00:00:00.000Z"],
    ] as const)
      await user.type(screen.getByLabelText(label), text);
    await user.click(screen.getByRole("button", { name: "Record enrollment" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/core/payg-offers/enrollments");
    expect(
      JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown,
    ).toMatchObject({
      action: "enroll",
      offerVersionId: offer.id,
      billingAuthority: "fil_one",
      binding: {
        sku: offer.terms.sku,
        region: offer.terms.region,
        source: "fil-one",
        mappingVersionId: "mapping-v1",
      },
    });
    expect(
      await screen.findByText(/Enrollment enrollment-result retained/),
    ).toBeVisible();
  });
  it("records trial eligibility using a persisted verification reference", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ trial: { id: "trial-result" } }), {
        status: 200,
      }),
    );
    render(
      <PaygOfferAdministration
        offers={[
          {
            ...offer,
            status: "approved",
            approvalEvidenceId: "approved-policy",
          },
        ]}
        available
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    await user.click(screen.getByText("Record verified trial claim"));
    await user.type(screen.getByLabelText("Organization ID"), creator);
    await user.type(
      screen.getByLabelText("Persisted domain verification reference"),
      `dns:${offer.id}`,
    );
    await user.click(
      screen.getByRole("button", { name: "Record trial claim" }),
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/core/payg-offers/trials");
    expect(
      JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown,
    ).toMatchObject({
      action: "claim",
      organizationId: creator,
      offerVersionId: offer.id,
      verificationEvidenceId: `dns:${offer.id}`,
    });
    expect(
      await screen.findByText(/Lifetime trial claim trial-result retained/),
    ).toBeVisible();
  });
  it("requires a different finance approver and previews saved policy with decimal TB conversion", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ total: { currency: "USD", minor: "499" }, lines: [] }),
        { status: 200 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[{ ...offer, status: "proposed", proposedBy: creator }]}
        available
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    expect(
      screen.getByRole("button", { name: "Approve policy version" }),
    ).toBeDisabled();
    expect(screen.getByText(/Storage cap: 1 TB/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Calculate monthly estimate" }),
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/core/payg-offers/simulate");
    expect(
      JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown,
    ).toMatchObject({
      averageStorageBytes: "100000000000",
      egressBytes: "1000000000000",
      apiOperations: "1000000",
    });
    expect(
      await screen.findByText("Estimated monthly total: USD 4.99"),
    ).toBeVisible();
  });
});
