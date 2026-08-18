import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
  decideDemoDeadLetter: vi.fn(),
  redrive: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@clockwork/db", () => ({
  DatabaseSystemRecoveryCommandExecutor: class {
    public execute = mocks.execute;
  },
}));
vi.mock("@/src/auth/session", () => ({
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./redrive", () => ({ redriveRetriedWork: mocks.redrive }));
vi.mock("../demo-operator-state", () => ({
  decideDemoDeadLetter: mocks.decideDemoDeadLetter,
}));

import { decideDeadLetterOperation } from "./actions";

const operator = {
  userId: "20000000-0000-4000-8000-000000000001",
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function retryForm(): FormData {
  const formData = new FormData();
  formData.set("source", "workflow_run");
  formData.set("id", "run_accepted_quote");
  formData.set("action", "retry");
  formData.set("reason", "INC-4421 provider recovered");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOptionalServiceDatabase.mockReturnValue({});
  mocks.requireRecentAuthentication.mockResolvedValue(operator);
  mocks.execute.mockResolvedValue({ ok: true });
  mocks.redrive.mockResolvedValue({ status: "submitted" });
  mocks.decideDemoDeadLetter.mockResolvedValue({ redriveSubmitted: true });
});

describe("system recovery action authentication", () => {
  it("reuses the recently authenticated session for the decision and redrive", async () => {
    await expect(decideDeadLetterOperation(retryForm())).resolves.toEqual({
      ok: true,
      redriveSubmitted: true,
    });

    expect(mocks.requireRecentAuthentication).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: "user", id: operator.userId },
        mfaVerified: true,
        recentAuthenticationVerified: true,
      }),
    );
    expect(mocks.redrive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestedBy: operator.userId }),
    );
  });

  it("does not dispatch recovery when recent authentication fails", async () => {
    mocks.requireRecentAuthentication.mockRejectedValue(new Error("stale"));

    await expect(decideDeadLetterOperation(retryForm())).resolves.toEqual({
      ok: false,
      code: "SYSTEM_RECOVERY_RECENT_AUTH_REQUIRED",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.redrive).not.toHaveBeenCalled();
  });

  it("persists the decision in the exact demo without requiring a database", async () => {
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CLOCKWORK_ENV", "");
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "");
    vi.stubEnv("ENVIRONMENT", "");
    mocks.getOptionalServiceDatabase.mockReturnValue(undefined);

    try {
      await expect(decideDeadLetterOperation(retryForm())).resolves.toEqual({
        ok: true,
        redriveSubmitted: true,
      });
      expect(mocks.decideDemoDeadLetter).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "workflow_run",
          id: "run_accepted_quote",
          action: "retry",
          actorId: operator.userId,
        }),
      );
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/internal/recovery");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
