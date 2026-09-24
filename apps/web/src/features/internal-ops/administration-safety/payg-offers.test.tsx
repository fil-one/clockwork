import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      await screen.findByText("Estimated monthly total: $4.99"),
    ).toBeVisible();
  });
});

describe("PAYG and trial policies in the reader's language", () => {
  afterEach(() => setHarnessLanguage("en", catalogs.en));

  it("renders the page, the policy summary and its amounts in Portuguese", async () => {
    setHarnessLanguage("pt", catalogs.pt);
    const user = userEvent.setup();
    render(
      <PaygOfferAdministration
        offers={[{ ...offer, status: "approved" }]}
        available
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Políticas de pagamento conforme o uso e de período de teste",
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: /Direct PAYG · france · v1 · Aprovada/,
      }),
    );
    expect(
      screen.getByText(
        "US$ 4,99 por TB-mês; mínimo mensal de US$ 4,99. Mínimo em meses parciais: Mínimo mensal integral.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Período de teste: 30 dias e, depois, 7 dias/),
    ).toBeVisible();
    expect(screen.getByText(/Limite de armazenamento: 1 TB/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Descontinuar para novas adesões" }),
    ).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /Policy versions|Retire for future enrollments|per TB-month|Storage cap/u,
    );
  });

  it("shows an API refusal in the reader's language, not the server code", async () => {
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
        roles={["finance_approver"]}
        userId={creator}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Direct PAYG/ }));
    await user.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    expect(
      (
        await screen.findAllByText(
          "Entscheiden muss eine genehmigende Person (Finanzen), die diese Version weder erstellt noch bearbeitet noch eingereicht hat.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(
      /PAYG_OFFER|finance approver/u,
    );
  });
});

describe("the storage price input", () => {
  /**
   * The hint told a Spanish reader to use a decimal point, and the input
   * refused "4,99": the example and the parser now follow the separator the
   * reader writes, and either separator is accepted.
   */
  it("gives an example in the reader's own decimal notation", () => {
    expect(exampleAmount("es-ES")).toBe("4,99");
    expect(exampleAmount("de-DE")).toBe("4,99");
    expect(exampleAmount("pt-BR")).toBe("4,99");
    expect(exampleAmount("en-US")).toBe("4.99");
    expect(exampleAmount("ja-JP")).toBe("4.99");
  });

  it("accepts the example it gives, with either separator", () => {
    expect(minor("4,99")).toBe("499");
    expect(minor("4.99")).toBe("499");
    expect(minor(" 150,5 ")).toBe("15050");
    expect(() => minor("1.500,00")).toThrow();
  });
});
