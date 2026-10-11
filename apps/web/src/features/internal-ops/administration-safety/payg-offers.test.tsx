import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";
import type { PaygOfferRecord } from "@clockwork/domain/core";

import { catalogs } from "@/src/i18n/catalogs";
import { setHarnessLanguage } from "@/src/i18n/client";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
import { exampleAmount, minor, PaygOfferAdministration } from "./payg-offers";

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
      storageTbMonthMinor: "599",
      monthlyMinimumMinor: "599",
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
        permissions={permissionsForRoles(["finance_approver"])}
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
        permissions={permissionsForRoles(["finance_approver"])}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    const price = screen.getByRole("textbox", { name: /Price per TB-month/ });
    await user.clear(price);
    await user.type(price, "6.49");
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
        payg: { storageTbMonthMinor: "649", monthlyMinimumMinor: "599" },
        trial: { gracePeriodDays: 14 },
      },
    });
    expect(init.headers).toMatchObject({
      "x-csrf-token": expect.any(String) as unknown,
      "idempotency-key": expect.any(String) as unknown,
    });
    expect(
      await screen.findByText(/Policy version 1 is a draft/),
    ).toBeVisible();
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
        permissions={permissionsForRoles(["finance_approver"])}
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
        permissions={permissionsForRoles(["finance_approver"])}
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
        JSON.stringify({ total: { currency: "USD", minor: "599" }, lines: [] }),
        { status: 200 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[{ ...offer, status: "proposed", proposedBy: creator }]}
        available
        permissions={permissionsForRoles(["finance_approver"])}
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
      await screen.findByText("Estimated monthly total: $5.99"),
    ).toBeVisible();
  });
});

// Staff copy is English in every catalog; amounts follow the language given.
describe("PAYG and trial policies for a reader of another language", () => {
  afterEach(() => setHarnessLanguage("en", catalogs.en));

  it("renders the policy summary with Portuguese amounts", async () => {
    setHarnessLanguage("pt", catalogs.pt);
    const user = userEvent.setup();
    render(
      <PaygOfferAdministration
        offers={[{ ...offer, status: "approved" }]}
        available
        permissions={permissionsForRoles(["finance_approver"])}
        userId={creator}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "PAYG and trial policies",
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: /Direct PAYG · france · v1 · Approved/,
      }),
    );
    expect(
      screen.getByText(
        "US$ 5,99 per TB-month; monthly minimum US$ 5,99. Partial-month minimum: Full monthly minimum.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Trial: 30 days, then 7 days/)).toBeVisible();
    expect(screen.getByText(/Storage cap: 1 TB/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retire for future enrollments" }),
    ).toBeVisible();
  });

  it("shows an API refusal as a sentence, not the server code", async () => {
    setHarnessLanguage("de", catalogs.de);
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "PAYG_OFFER_DISTINCT_APPROVER_REQUIRED" }),
        { status: 409 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[offer]}
        available
        permissions={permissionsForRoles(["finance_approver"])}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      (
        await screen.findAllByText(
          "A finance approver who did not create, edit, or propose this version must decide.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/PAYG_OFFER/u);
  });
});

describe("the storage price input", () => {
  /**
   * The hint told a Spanish reader to use a decimal point, and the input
   * refused "5,99": the example and the parser now follow the separator the
   * reader writes, and either separator is accepted.
   */
  it("gives an example in the reader's own decimal notation", () => {
    expect(exampleAmount("es-ES")).toBe("5,99");
    expect(exampleAmount("de-DE")).toBe("5,99");
    expect(exampleAmount("pt-BR")).toBe("5,99");
    expect(exampleAmount("en-US")).toBe("5.99");
    expect(exampleAmount("ja-JP")).toBe("5.99");
  });

  it("accepts the example it gives, with either separator", () => {
    expect(minor("5,99")).toBe("599");
    expect(minor("5.99")).toBe("599");
    expect(minor(" 150,5 ")).toBe("15050");
    expect(() => minor("1.500,00")).toThrow();
  });
});

describe("approving one's own PAYG offer version", () => {
  const proposed = {
    ...offer,
    rowVersion: 2,
    status: "proposed" as const,
    proposedBy: creator,
  };

  it("lets a commerce administrator approve their own version with a reason and evidence", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...proposed,
          rowVersion: 3,
          status: "approved",
          approvedBy: creator,
          approvalEvidenceId: "DOC-7",
          selfApproved: true,
          selfApprovalReason: "Launch day, approving my own offer",
        }),
        { status: 200 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[proposed]}
        available
        permissions={permissionsForRoles(["commerce_admin"])}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    expect(
      screen.getByText(/you can approve it yourself with a written reason/),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Approve my own request" }),
    );
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Approve my own request",
    });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(/Approval evidence reference/),
      "DOC-7",
    );
    await user.type(
      within(dialog).getByLabelText(/Why are you approving it yourself/),
      "Launch day, approving my own offer",
    );
    await user.click(confirm);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/core/payg-offers");
    expect(
      JSON.parse(typeof init.body === "string" ? init.body : "{}") as unknown,
    ).toEqual({
      action: "approve",
      id: proposed.id,
      expectedRowVersion: 2,
      reason: "Launch day, approving my own offer",
      approvalEvidenceId: "DOC-7",
      selfApproval: true,
    });
  });

  it("words a refused self-approval in the dialog", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "SELF_APPROVAL_DIRECT_SESSION_REQUIRED" }),
        { status: 403 },
      ),
    );
    render(
      <PaygOfferAdministration
        offers={[proposed]}
        available
        permissions={permissionsForRoles(["commerce_admin"])}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    await user.click(
      screen.getByRole("button", { name: "Approve my own request" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/Approval evidence reference/),
      "DOC-7",
    );
    await user.type(
      within(dialog).getByLabelText(/Why are you approving it yourself/),
      "Launch day, approving my own offer",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Approve my own request" }),
    );
    expect(
      await within(dialog).findByText(/An assisted session cannot approve/),
    ).toBeVisible();
  });

  it("keeps a finance approver on the distinct-approver rule", async () => {
    const user = userEvent.setup();
    render(
      <PaygOfferAdministration
        offers={[proposed]}
        available
        permissions={permissionsForRoles(["finance_approver"])}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    expect(
      screen.queryByRole("button", { name: "Approve my own request" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "A different finance approver must review this version.",
      ),
    ).toBeVisible();
  });
});
