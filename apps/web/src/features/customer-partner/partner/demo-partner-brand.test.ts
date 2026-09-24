import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import { translatorFor } from "@/src/i18n/catalogs";

import {
  demoPartnerBrandRecords,
  handleDemoPartnerBrand,
} from "./demo-partner-brand";

const en = {
  t: translatorFor("en"),
  locale: "en",
  formatting: "en-US",
} as const;

const store = createMemoryDemoStore();
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000003",
  accountIds: [demoAccountIds.reseller],
  roles: ["partner_admin"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const body = {
  domain: "quotes.aster-house.example",
  verificationToken: "dns-provider-token-1234",
  brandName: "Aster House Archive",
  logoUrl: null,
  primaryColor: "#3157d5",
  communicationOwner: "partner",
} as const;

function request(key: string, value: unknown = body): Request {
  return new Request(
    `https://demo.clockwork.test/api/v1/lifecycle/partners/${demoAccountIds.reseller}/domains`,
    {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(value),
    },
  );
}

beforeEach(async () => {
  await store.replace(createPristineDemoAdapterState());
});

describe("durable demo partner branding", () => {
  it("persists a pending DNS-verification row without exposing the token", async () => {
    const response = await handleDemoPartnerBrand(
      request("demo-partner-brand-create-0001"),
      session,
      demoAccountIds.reseller,
      { store, now: "2026-08-18T12:00:00.000Z" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      domain: body.domain,
      status: "pending",
      verification: "dns_required",
    });
    expect(
      demoPartnerBrandRecords(await store.read(), demoAccountIds.reseller, en),
    ).toEqual([
      expect.objectContaining({
        name: "Aster House Archive",
        status: "pending",
        value: "DNS verification requested",
      }),
    ]);
    expect(JSON.stringify(await store.read())).not.toContain(
      body.verificationToken,
    );
  });

  it("replays exact bytes and rejects another request on the same key", async () => {
    const first = await handleDemoPartnerBrand(
      request("demo-partner-brand-replay-0001"),
      session,
      demoAccountIds.reseller,
      { store },
    );
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const replay = await handleDemoPartnerBrand(
      request("demo-partner-brand-replay-0001"),
      session,
      demoAccountIds.reseller,
      { store },
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const conflict = await handleDemoPartnerBrand(
      request("demo-partner-brand-replay-0001", {
        ...body,
        brandName: "Different brand",
      }),
      session,
      demoAccountIds.reseller,
      { store },
    );
    expect(conflict.status).toBe(409);
  });

  it("refuses cross-account and non-admin authority", async () => {
    const crossAccount = await handleDemoPartnerBrand(
      request("demo-partner-brand-denied-0001"),
      session,
      demoAccountIds.distributor,
      { store },
    );
    expect(crossAccount.status).toBe(403);
    const seller = await handleDemoPartnerBrand(
      request("demo-partner-brand-denied-0002"),
      { ...session, roles: ["partner_seller"] },
      demoAccountIds.reseller,
      { store },
    );
    expect(seller.status).toBe(403);
  });

  it("returns to seeded brand rows on reset", async () => {
    await handleDemoPartnerBrand(
      request("demo-partner-brand-reset-0001"),
      session,
      demoAccountIds.reseller,
      { store },
    );
    expect(
      demoPartnerBrandRecords(await store.read(), demoAccountIds.reseller, en),
    ).toHaveLength(1);
    await store.replace(createPristineDemoAdapterState());
    expect(
      demoPartnerBrandRecords(await store.read(), demoAccountIds.reseller, en),
    ).toHaveLength(0);
  });
});
