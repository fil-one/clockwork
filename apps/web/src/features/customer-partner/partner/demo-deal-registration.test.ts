import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { currentDemoChannelPolicies } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { demoAccountIds } from "@clockwork/testing/personas";

vi.mock("server-only", () => ({}));

import {
  demoCreatedRegistrations,
  handleDemoDealRegistrationCommand,
} from "./demo-deal-registration";

const partner: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000003",
  organizationId: "31000000-0000-4000-8000-000000000003",
  accountIds: [demoAccountIds.reseller],
  roles: ["partner_admin"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

const store = createMemoryDemoStore();
const body = {
  id: "77000000-0000-4000-8000-000000000001",
  accountId: demoAccountIds.reseller,
  action: "create",
  payload: {
    partnerAccountId: demoAccountIds.reseller,
    endClientAccountId: demoAccountIds.resaleEndClient,
    workload: "Regulated archive expansion",
    expectedVolume: "240",
    protectionDays: 90,
  },
} as const;

function request(
  idempotencyKey: string,
  value: Readonly<Record<string, unknown>> = body,
): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/deal_registrations",
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(value),
    },
  );
}

beforeEach(async () => {
  await store.replace(createPristineDemoAdapterState());
});

describe("durable demo deal registration", () => {
  it("records a scoped registration that appears in the partner collection", async () => {
    const response = await handleDemoDealRegistrationCommand(
      request("demo-registration-create-0001"),
      partner,
      { store, now: "2026-08-18T12:00:00.000Z" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: {
        resource: "deal_registrations",
        rowVersion: 1,
        data: {
          status: "registered",
          endClientAccountId: body.payload.endClientAccountId,
        },
      },
    });
    expect(
      demoCreatedRegistrations(await store.read(), demoAccountIds.reseller),
    ).toEqual([
      expect.objectContaining({
        name: "Aster House Media · Regulated archive expansion",
        status: "pending",
        value: "240 TB potential workload",
      }),
    ]);
  });

  it("replays exact bytes and rejects a reused key with different bytes", async () => {
    const first = await handleDemoDealRegistrationCommand(
      request("demo-registration-replay-0001"),
      partner,
      { store },
    );
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    const replay = await handleDemoDealRegistrationCommand(
      request("demo-registration-replay-0001"),
      partner,
      { store },
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const conflict = await handleDemoDealRegistrationCommand(
      request("demo-registration-replay-0001", {
        ...body,
        payload: { ...body.payload, workload: "Different workload" },
      }),
      partner,
      { store },
    );
    expect(conflict.status).toBe(409);
    expect(
      demoCreatedRegistrations(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(1);
  });

  it("refuses cross-partner identity, end-client scope, and non-partner roles", async () => {
    const cases: readonly [SessionClaims, Readonly<Record<string, unknown>>][] =
      [
        [{ ...partner, accountIds: [demoAccountIds.distributor] }, body],
        [
          partner,
          {
            ...body,
            payload: {
              ...body.payload,
              endClientAccountId: demoAccountIds.ukEndClient,
            },
          },
        ],
        [{ ...partner, roles: ["owner"] }, body],
      ];
    for (const [session, command] of cases) {
      const response = await handleDemoDealRegistrationCommand(
        request(`demo-registration-denied-${crypto.randomUUID()}`, command),
        session,
        { store },
      );
      expect(response.status).toBe(403);
    }
    expect(
      demoCreatedRegistrations(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(0);
  });

  it("drops created registrations and receipts on reset", async () => {
    await handleDemoDealRegistrationCommand(
      request("demo-registration-reset-0001"),
      partner,
      { store },
    );
    expect(
      demoCreatedRegistrations(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(1);
    await store.replace(createPristineDemoAdapterState());
    expect(
      demoCreatedRegistrations(await store.read(), demoAccountIds.reseller),
    ).toHaveLength(0);
  });
});

it("enforces the current configured request maximum and retains its snapshot atomically", async () => {
  const now = "2026-08-18T12:00:00.000Z";
  await store.update((state) => {
    const seed = currentDemoChannelPolicies(state, now)[0];
    if (!seed) throw new Error("Missing demo policy");
    const policy = {
      ...seed,
      status: "approved",
      rowVersion: 3,
      approvedBy: "21000000-0000-4000-8000-000000000099",
      approvalEvidence: "fictional-review",
      terms: {
        ...seed.terms,
        defaultProtectionDays: 30,
        maximumProtectionDays: 60,
      },
    };
    return {
      ...state,
      revision: state.revision + 1,
      projectionOverrides: {
        ...state.projectionOverrides,
        [`commercial-policy-demo:channel:${policy.id}`]: {
          version: 3,
          updatedAt: now,
          data: policy,
        },
      },
    };
  });
  const refused = await handleDemoDealRegistrationCommand(
    request("demo-policy-max-refused"),
    partner,
    { store, now },
  );
  expect(refused.status).toBe(422);
  const allowed = await handleDemoDealRegistrationCommand(
    request("demo-policy-max-allowed", {
      ...body,
      payload: { ...body.payload, protectionDays: 30 },
    }),
    partner,
    { store, now },
  );
  expect(allowed.status).toBe(200);
  const saved = Object.values((await store.read()).projectionOverrides).find(
    (entry) => entry.data.kind === "demo_partner_registration",
  );
  expect(saved?.data.channelPolicySnapshot).toMatchObject({
    source: "approved_policy",
    version: 1,
    maximumProtectionDays: 60,
    initialProtectionDays: 30,
  });
});
