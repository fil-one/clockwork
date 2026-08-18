import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRecentAuthentication: vi.fn(),
  decideDemoMigration: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));
vi.mock("@/src/features/internal-ops/demo-operator-state", () => ({
  decideDemoMigration: mocks.decideDemoMigration,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { recordDemoMigrationDecision } from "./migration-actions";

function form(overrides: Record<string, string> = {}): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    migrationId: "MIG-EXAMPLE-021",
    targetAccountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
    reason: "Legal name and verified domain match",
    ...overrides,
  }))
    result.set(key, value);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("CLOCKWORK_ENV", "");
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
  vi.stubEnv("ENVIRONMENT", "");
  mocks.requireRecentAuthentication.mockResolvedValue({
    userId: "20000000-0000-4000-8000-000000000001",
    roles: ["internal_operator"],
    isInternalStaff: true,
  });
  mocks.decideDemoMigration.mockResolvedValue({ version: 1 });
});

describe("demo migration decision action", () => {
  it("revalidates and persists the exact selected account", async () => {
    await expect(
      recordDemoMigrationDecision({ ok: false }, form()),
    ).resolves.toEqual({ ok: true });
    expect(mocks.decideDemoMigration).toHaveBeenCalledWith({
      migrationId: "MIG-EXAMPLE-021",
      action: "link",
      targetAccountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
      reason: "Legal name and verified domain match",
      actorId: "20000000-0000-4000-8000-000000000001",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/internal/migrations");
  });

  it("fails closed outside the exact demo", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "0");
    await expect(
      recordDemoMigrationDecision({ ok: false }, form()),
    ).resolves.toEqual({
      ok: false,
      code: "MIGRATION_DECISION_UNAVAILABLE",
    });
    expect(mocks.requireRecentAuthentication).not.toHaveBeenCalled();
    expect(mocks.decideDemoMigration).not.toHaveBeenCalled();
  });

  it("refuses ambiguity and a stale operator role", async () => {
    await expect(
      recordDemoMigrationDecision(
        { ok: false },
        form({
          migrationId: "MIG-EXAMPLE-016",
          targetAccountId: "",
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "MIGRATION_DECISION_INVALID",
    });
    mocks.requireRecentAuthentication.mockResolvedValue({
      userId: "20000000-0000-4000-8000-000000000001",
      roles: ["legal_approver"],
      isInternalStaff: true,
    });
    await expect(
      recordDemoMigrationDecision({ ok: false }, form()),
    ).resolves.toEqual({ ok: false, code: "MIGRATION_FORBIDDEN" });
    expect(mocks.decideDemoMigration).not.toHaveBeenCalled();
  });
});
