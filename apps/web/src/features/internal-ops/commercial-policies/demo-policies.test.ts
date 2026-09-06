import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { createPristineDemoAdapterState } from "@clockwork/testing/demo-state";
import { DemoCommercialPolicyRepository } from "./demo-policies";
import type { SessionClaims } from "@clockwork/api";
import { simulateDemoPayg, handleDemoPaygPolicy } from "./demo-payg-handler";
vi.mock("server-only", () => ({}));
const reviewer = "21000000-0000-4000-8000-000000000099";
const now = "2026-09-06T12:00:00.000Z";
beforeEach(() => {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
});
afterEach(() => vi.unstubAllEnvs());
it("requires a distinct reviewer, retains immutable policy, and replays only the same actor command", async () => {
  const store = createMemoryDemoStore(),
    repo = new DemoCommercialPolicyRepository(store);
  const seed = (await repo.listPayg(now))[0];
  if (!seed) throw new Error("Missing fictional offer");
  const command = {
    action: "approve" as const,
    id: seed.id,
    expectedRowVersion: seed.rowVersion,
    reason: "Fictional scenario review",
    approvalEvidenceId: "fictional-approval",
  };
  await expect(
    repo.commandPayg({
      command,
      userId: seed.createdBy,
      requestId: "self",
      now,
    }),
  ).rejects.toThrow("DISTINCT_APPROVER");
  const input = { command, userId: reviewer, requestId: "same-request", now };
  const approved = await repo.commandPayg(input);
  expect(approved.status).toBe("approved");
  expect(await repo.commandPayg(input)).toEqual(approved);
  await expect(
    repo.commandPayg({
      ...input,
      command: { ...command, reason: "Different request content" },
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    repo.commandPayg({
      ...input,
      requestId: "edit",
      command: {
        action: "save",
        id: seed.id,
        expectedRowVersion: approved.rowVersion,
        terms: seed.terms,
      },
    }),
  ).rejects.toThrow("NOT_DRAFT");
  const reloaded = new DemoCommercialPolicyRepository(store);
  expect((await reloaded.listPayg(now))[0]?.status).toBe("approved");
  await store.replace(createPristineDemoAdapterState());
  expect((await reloaded.listPayg(now))[0]?.status).toBe("proposed");
});
it("applies the effective approved channel policy and restores explicit legacy defaults on reset", async () => {
  const store = createMemoryDemoStore(),
    repo = new DemoCommercialPolicyRepository(store);
  expect((await repo.active(now)).source).toBe("legacy_defaults");
  const seed = (await repo.listChannel(now))[0];
  if (!seed) throw new Error("Missing fictional channel policy");
  const approved = await repo.commandChannel({
    command: {
      action: "approve",
      id: seed.id,
      expectedRowVersion: seed.rowVersion,
      reason: "Fictional channel review",
      approvalEvidence: "fictional-approval-evidence",
    },
    userId: reviewer,
    requestId: "approve-channel",
    now,
  });
  expect(await repo.active(now)).toMatchObject({
    source: "approved_policy",
    policyId: approved.id,
    maximumProtectionDays: 90,
  });
  await expect(
    repo.commandChannel({
      command: {
        action: "save",
        id: seed.id,
        expectedRowVersion: approved.rowVersion,
        terms: seed.terms,
      },
      userId: reviewer,
      requestId: "mutate",
      now,
    }),
  ).rejects.toThrow("IMMUTABLE");
  await store.replace(createPristineDemoAdapterState());
  expect((await repo.active(now)).source).toBe("legacy_defaults");
});
it("rates fictional saved economics through the real UTC usage rating engine", async () => {
  const repo = new DemoCommercialPolicyRepository(createMemoryDemoStore());
  const seed = (await repo.listPayg(now))[0];
  if (!seed) throw new Error("Missing fictional offer");
  const rating = simulateDemoPayg({
    terms: seed.terms,
    month: "2026-02",
    averageStorageBytes: "2000000000000",
    egressBytes: "1000",
    apiOperations: "123",
  });
  expect(rating.total).toEqual({ currency: "USD", minor: "998" });
  expect(rating.simulation).toBe(true);
});
it("never substitutes demo state in a production or unconfigured environment", async () => {
  const repo = new DemoCommercialPolicyRepository(createMemoryDemoStore());
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");
  await expect(repo.listPayg(now)).rejects.toThrow("UNAVAILABLE");
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "production");
  await expect(repo.listChannel(now)).rejects.toThrow("UNAVAILABLE");
});

it("rejects unauthorized/assisted finance and never fabricates billing execution", async () => {
  const repo = new DemoCommercialPolicyRepository(createMemoryDemoStore());
  const session: SessionClaims = {
    userId: reviewer,
    organizationId: "30000000-0000-4000-8000-000000000008",
    accountIds: [],
    roles: ["finance_approver"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  const request = (path = "") =>
    new Request(`https://demo.clockwork.test/api/v1/core/payg-offers${path}`);
  expect(
    (
      await handleDemoPaygPolicy(
        request(),
        { ...session, mfaVerified: false },
        repo,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleDemoPaygPolicy(
        request(),
        { ...session, roles: ["internal_operator"] },
        repo,
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleDemoPaygPolicy(request("/billing-effects"), session, repo))
      .status,
  ).toBe(503);
  const response = await handleDemoPaygPolicy(request(), session, repo);
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveProperty("offers");
});
