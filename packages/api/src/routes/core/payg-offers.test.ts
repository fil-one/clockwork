import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../app";
import type { PaygOfferAdministrationService } from "./payg-offers";

const csrf = "payg-policy-csrf-token-0000000000000001";
const terms = {
  name: "PAYG test",
  sku: "OBJECT_PAYG",
  region: "france",
  version: 1,
  effectiveFrom: "2026-09-01",
  sourceUri: "https://docs.fil.one/billing/trial",
  sourceCheckedAt: "2026-09-01T00:00:00.000Z",
  sourceDocumentId: "source",
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
};
const headers = (persona = "finance_approver", recent = "true") => ({
  "content-type": "application/json",
  origin: "http://localhost:3000",
  cookie: `clockwork-csrf=${csrf}`,
  "x-csrf-token": csrf,
  "idempotency-key": randomUUID(),
  "x-clockwork-persona": persona,
  "x-clockwork-recent-auth": recent,
});
const service = (): PaygOfferAdministrationService => ({
  list: vi.fn(() => Promise.resolve([])),
  command: vi.fn(() =>
    Promise.reject(new Error("PAYG_OFFER_DISTINCT_APPROVER_REQUIRED")),
  ),
});

describe("PAYG policy API authorization", () => {
  it("protects enrollment and billing materialization with finance and recent authentication", async () => {
    const dependency = {
      ...service(),
      listPending: vi.fn(() => Promise.resolve([])),
      listEnrollments: vi.fn(() => Promise.resolve([])),
      materialize: vi.fn(() =>
        Promise.resolve({ invoiceId: randomUUID(), replay: false }),
      ),
      enrollmentCommand: vi.fn(() => Promise.resolve({})),
    };
    const app = createApiApp({ paygOffers: dependency });
    for (const path of ["billing-effects", "enrollments"]) {
      expect(
        (
          await app.request(
            `http://localhost:3000/v1/core/payg-offers/${path}`,
            { headers: headers("owner") },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(
            `http://localhost:3000/v1/core/payg-offers/${path}`,
            { headers: headers() },
          )
        ).status,
      ).toBe(200);
    }
    const denied = await app.request(
      "http://localhost:3000/v1/core/payg-offers/billing-effects",
      {
        method: "POST",
        headers: headers("finance_approver", "false"),
        body: JSON.stringify({ effectKey: "retained-effect" }),
      },
    );
    expect(denied.status).toBe(403);
    expect(dependency.materialize).not.toHaveBeenCalled();
    const saved = await app.request(
      "http://localhost:3000/v1/core/payg-offers/billing-effects",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ effectKey: "retained-effect" }),
      },
    );
    expect(saved.status).toBe(200);
    expect(dependency.materialize).toHaveBeenCalledTimes(1);
  });
  it("accepts only retained trial proof identifiers and one paid conversion source", async () => {
    const trialCommand = vi.fn(() => Promise.resolve({ id: randomUUID() }));
    const app = createApiApp({
      paygOffers: {
        ...service(),
        trialCommand,
        listTrials: () => Promise.resolve([]),
      },
    });
    const body = {
      action: "claim",
      id: randomUUID(),
      organizationId: randomUUID(),
      offerVersionId: randomUUID(),
      verificationEvidenceId: `dns:${randomUUID()}`,
    };
    const stale = await app.request(
      "http://localhost:3000/v1/core/payg-offers/trials",
      {
        method: "POST",
        headers: headers("finance_approver", "false"),
        body: JSON.stringify(body),
      },
    );
    expect(stale.status).toBe(403);
    expect(trialCommand).not.toHaveBeenCalled();
    const invalid = await app.request(
      "http://localhost:3000/v1/core/payg-offers/trials",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          ...body,
          verificationEvidenceId: "I verified this domain",
        }),
      },
    );
    expect(invalid.status).toBe(422);
    expect(trialCommand).not.toHaveBeenCalled();
    const valid = await app.request(
      "http://localhost:3000/v1/core/payg-offers/trials",
      { method: "POST", headers: headers(), body: JSON.stringify(body) },
    );
    expect(valid.status).toBe(200);
    expect(trialCommand).toHaveBeenCalledTimes(1);
    const ambiguous = await app.request(
      "http://localhost:3000/v1/core/payg-offers/trials",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "convert",
          trialId: randomUUID(),
          entitlementId: randomUUID(),
          paygEnrollmentId: randomUUID(),
        }),
      },
    );
    expect(ambiguous.status).toBe(422);
  });
  it("simulates configurable monthly minimum and zero-rated egress without billing effects", async () => {
    const dependency = service();
    const app = createApiApp({ paygOffers: dependency });
    const response = await app.request(
      "http://localhost:3000/v1/core/payg-offers/simulate",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          terms,
          month: "2028-02",
          averageStorageBytes: "100000000000",
          egressBytes: "100000000000000",
          apiOperations: "1000000000",
        }),
      },
    );
    expect(response.status).toBe(200);
    const preview = (await response.json()) as {
      simulation: boolean;
      total: { minor: string };
      lines: { kind: string; amount: { minor: string } }[];
    };
    expect(preview.simulation).toBe(true);
    expect(preview.total.minor).toBe("499");
    expect(
      preview.lines.find((line) => line.kind === "monthly_minimum_adjustment")
        ?.amount.minor,
    ).toBe("449");
    expect(
      preview.lines.find((line) => line.kind === "egress_bytes")?.amount.minor,
    ).toBe("0");
    expect(dependency.command).not.toHaveBeenCalled();
  });
  it("denies tenant reads and writes before reaching the service", async () => {
    const dependency = service();
    const app = createApiApp({ paygOffers: dependency });
    const get = await app.request("http://localhost:3000/v1/core/payg-offers", {
      headers: headers("owner"),
    });
    const post = await app.request(
      "http://localhost:3000/v1/core/payg-offers",
      {
        method: "POST",
        headers: headers("owner"),
        body: JSON.stringify({ action: "create", terms }),
      },
    );
    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
    expect(dependency.list).not.toHaveBeenCalled();
    expect(dependency.command).not.toHaveBeenCalled();
  });
  it("requires recent finance authentication and reports a missing database explicitly", async () => {
    const dependency = service();
    const app = createApiApp({ paygOffers: dependency });
    const denied = await app.request(
      "http://localhost:3000/v1/core/payg-offers",
      {
        method: "POST",
        headers: headers("finance_approver", "false"),
        body: JSON.stringify({ action: "create", terms }),
      },
    );
    expect(denied.status).toBe(403);
    expect(dependency.command).not.toHaveBeenCalled();
    expect(
      (
        await createApiApp().request(
          "http://localhost:3000/v1/core/payg-offers",
          { headers: headers() },
        )
      ).status,
    ).toBe(503);
  });
  it("returns reviewable policy conflicts and rejects negative money", async () => {
    const app = createApiApp({ paygOffers: service() });
    const conflict = await app.request(
      "http://localhost:3000/v1/core/payg-offers",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "create", terms }),
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "PAYG_OFFER_DISTINCT_APPROVER_REQUIRED",
      retryable: false,
    });
    const invalid = await app.request(
      "http://localhost:3000/v1/core/payg-offers",
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "create",
          terms: {
            ...terms,
            payg: { ...terms.payg, monthlyMinimumMinor: "-1" },
          },
        }),
      },
    );
    expect(invalid.status).toBe(422);
  });
});
