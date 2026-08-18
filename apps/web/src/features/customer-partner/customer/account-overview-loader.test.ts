import { describe, expect, it } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { demoAccountIds } from "@clockwork/testing/personas";

import { handleDemoCustomerAccountControl } from "@/src/features/experience-server/demo-account-controls";

import { loadAccountOverviewAccount } from "./account-overview-loader";

const accountId = demoAccountIds.direct;
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  organizationId: "31000000-0000-4000-8000-000000000001",
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

describe("demo account overview", () => {
  it("reads the saved legal name and billing contacts, then restores them on reset", async () => {
    const store = createMemoryDemoStore();
    const baseline = await loadAccountOverviewAccount({
      accountId,
      identityAccountName: "Identity provider account",
      guidedDemo: true,
      store,
    });
    const update = await handleDemoCustomerAccountControl(
      new Request("https://demo.test/api/v1/core/commands/accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "account-overview-update-0001",
        },
        body: JSON.stringify({
          id: accountId,
          accountId,
          action: "update",
          expectedVersion: 1,
          payload: {
            legalName: "Meridian Archive Labs LLC",
            invoiceDeliveryEmail: "invoices@meridian-archive.test",
            billingContact: {
              name: "Mara Voss",
              email: "mara.voss@meridian-archive.test",
            },
          },
        }),
      }),
      session,
      store,
    );
    expect(update.status).toBe(200);
    await expect(
      loadAccountOverviewAccount({
        accountId,
        identityAccountName: "Identity provider account",
        guidedDemo: true,
        store,
      }),
    ).resolves.toEqual({
      accountName: "Meridian Archive Labs LLC",
      billingContact: "Mara Voss · mara.voss@meridian-archive.test",
      invoiceDeliveryEmail: "invoices@meridian-archive.test",
    });

    await resetDemoExperience(store, {
      target: "demo",
      environment: { NODE_ENV: "test" },
    });
    await expect(
      loadAccountOverviewAccount({
        accountId,
        identityAccountName: "Identity provider account",
        guidedDemo: true,
        store,
      }),
    ).resolves.toEqual(baseline);
  });

  it("keeps the production identity-provider account source unchanged", async () => {
    await expect(
      loadAccountOverviewAccount({
        accountId,
        identityAccountName: "Provider-backed account",
        guidedDemo: false,
      }),
    ).resolves.toEqual({ accountName: "Provider-backed account" });
  });
});
