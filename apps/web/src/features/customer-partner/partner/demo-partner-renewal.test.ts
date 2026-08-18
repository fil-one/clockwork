import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import { demoProjectionRecordId } from "@/src/features/experience-server/projection-source";

import {
  demoPartnerCollectionRenewalContext,
  demoPartnerPortfolioRenewalContext,
  demoPartnerRenewalRecords,
  demoPartnerRenewalOrderId,
  handleDemoPartnerRenewal,
} from "./demo-partner-renewal";
import { partnerSurfaces } from "./partner-data";

const store = createMemoryDemoStore();
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000003",
  accountIds: [demoAccountIds.reseller],
  roles: ["partner_admin"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const orderId = "demo-partner-renewal-ec-0038";

function target(action: "requests" | "declines") {
  const parsed = demoPartnerRenewalOrderId(
    `/api/v1/lifecycle/renewals/${orderId}/${action}`,
  );
  if (!parsed) throw new Error("Test renewal target is invalid");
  return parsed;
}

function request(
  action: "requests" | "declines",
  key: string,
  body: unknown,
): Request {
  return new Request(
    `https://demo.clockwork.test/api/v1/lifecycle/renewals/${orderId}/${action}`,
    {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(body),
    },
  );
}

const requestBody = {
  accountId: demoAccountIds.resaleEndClient,
  requestedAction: "renew",
  requestedTermMonths: 12,
} as const;
const declineBody = {
  accountId: demoAccountIds.resaleEndClient,
  reason: "The end client elected not to renew the current term.",
  authorityTitle: "Commercial Director",
  authorityAttested: true,
  evidenceDocumentId: "DOC-RENEWAL-DECLINE-1",
} as const;

beforeEach(async () => {
  await store.replace(createPristineDemoAdapterState());
});

describe("durable partner portfolio renewal", () => {
  it("resolves the hidden order and end-client identities for a portfolio row", () => {
    expect(demoPartnerPortfolioRenewalContext("EC-0038")).toEqual({
      orderId,
      accountId: demoAccountIds.resaleEndClient,
    });
    expect(demoPartnerPortfolioRenewalContext("unknown")).toBeUndefined();
    expect(demoPartnerCollectionRenewalContext("REN-EC-0038")).toEqual({
      orderId,
      accountId: demoAccountIds.resaleEndClient,
    });
  });

  it("persists a renewal request into the visible portfolio projection", async () => {
    const response = await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-request-0001", requestBody),
      session,
      target("requests"),
      { store, now: "2026-08-18T12:00:00.000Z" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderId,
      action: "request",
      status: "pending",
    });
    const projectionId = demoProjectionRecordId(
      "partner",
      "portfolio",
      "EC-0038",
    );
    expect(projectionId).toBeDefined();
    expect(
      projectionId
        ? (await store.read()).projectionOverrides[projectionId]
        : undefined,
    ).toMatchObject({
      version: 2,
      data: {
        status: "pending",
        secondary: "Renewal request submitted · awaiting Fil One confirmation",
      },
    });
    expect(
      demoPartnerRenewalRecords(
        await store.read(),
        demoAccountIds.reseller,
        partnerSurfaces.renewals.records,
      ).find((record) => record.id === "REN-EC-0038"),
    ).toMatchObject({
      status: "pending",
      risk: "medium",
      secondary: "Renewal request submitted · awaiting Fil One confirmation",
      allowedActions: [],
    });
  });

  it("records an attested decline as canceled", async () => {
    const response = await handleDemoPartnerRenewal(
      request("declines", "demo-partner-renewal-decline-0001", declineBody),
      session,
      target("declines"),
      { store },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "decline",
      status: "canceled",
    });
  });

  it("binds replay to exact request bytes and partner scope", async () => {
    const first = await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-replay-0001", requestBody),
      session,
      target("requests"),
      { store },
    );
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const replay = await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-replay-0001", requestBody),
      session,
      target("requests"),
      { store },
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const conflict = await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-replay-0001", {
        ...requestBody,
        requestedTermMonths: 24,
      }),
      session,
      target("requests"),
      { store },
    );
    expect(conflict.status).toBe(409);
    const denied = await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-denied-0001", requestBody),
      { ...session, accountIds: [demoAccountIds.distributor] },
      target("requests"),
      { store },
    );
    expect(denied.status).toBe(403);
  });

  it("clears decision and receipt state on reset", async () => {
    await handleDemoPartnerRenewal(
      request("requests", "demo-partner-renewal-reset-0001", requestBody),
      session,
      target("requests"),
      { store },
    );
    expect(
      Object.keys((await store.read()).projectionOverrides),
    ).not.toHaveLength(0);
    await store.replace(createPristineDemoAdapterState());
    expect((await store.read()).projectionOverrides).toEqual({});
  });
});
