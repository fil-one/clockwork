import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  getOptionalRuntimeDatabase: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
  replay: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalRuntimeDatabase: mocks.getOptionalRuntimeDatabase,
  getOptionalServiceDatabase: mocks.getOptionalServiceDatabase,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@clockwork/api", () => ({
  DatabaseCoreFinanceService: class {
    public replay = mocks.replay;
  },
}));

import { replayWebhookEvent } from "./actions";

const operator = {
  userId: "20000000-0000-4000-8000-000000000001",
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function form(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values = {
    provider: "stripe",
    providerEventId: "evt_1",
    reason: "INC-4021 duplicate delivery, safe to replay",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values))
    if (value) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTHORIZATION_CONTEXT_SECRET = "x".repeat(48);
  process.env.TAX_PROVIDER_BASE_URL = "https://tax.example/";
  process.env.TAX_PROVIDER_TOKEN = "tax-token";
  mocks.getOptionalRuntimeDatabase.mockReturnValue({});
  mocks.getOptionalServiceDatabase.mockReturnValue({});
  mocks.requireRecentAuthentication.mockResolvedValue(undefined);
  mocks.getCommerceSession.mockResolvedValue(operator);
  mocks.replay.mockResolvedValue({
    replayed: true,
    workflowRunId: "60000000-0000-4000-8000-000000000001",
  });
});

describe("webhook replay action", () => {
  it("replays a verified callback for an authorized operator", async () => {
    const result = await replayWebhookEvent(form());

    expect(result).toMatchObject({
      ok: true,
      started: true,
      workflowRunId: "60000000-0000-4000-8000-000000000001",
    });
    expect(result.code).toBeUndefined();
    expect(mocks.replay).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "stripe",
        eventId: "evt_1",
        actor: { kind: "user", id: operator.userId },
      }),
    );
  });

  it("reports an already-running replay as its own outcome", async () => {
    mocks.replay.mockResolvedValue({
      replayed: false,
      workflowRunId: "60000000-0000-4000-8000-000000000001",
    });

    const result = await replayWebhookEvent(form());

    // The command is idempotent, so this is not a failure. It is also not a
    // second success: nothing new was started and the operator must be told.
    expect(result).toMatchObject({
      ok: true,
      started: false,
      code: "WEBHOOK_REPLAY_ALREADY_RUNNING",
    });
  });

  it("refuses a reason shorter than the audit minimum before reading identity", async () => {
    const result = await replayWebhookEvent(form({ reason: "INC-402" }));

    expect(result).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_REASON_REQUIRED",
    });
    expect(mocks.getCommerceSession).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("refuses a caller without system:operate", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      ...operator,
      roles: ["billing"],
      isInternalStaff: false,
    });

    const result = await replayWebhookEvent(form());

    expect(result).toEqual({ ok: false, code: "WEBHOOK_REPLAY_FORBIDDEN" });
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("refuses a caller whose authentication is not recent", async () => {
    mocks.requireRecentAuthentication.mockRejectedValue(new Error("stale"));

    const result = await replayWebhookEvent(form());

    expect(result).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_RECENT_AUTH_REQUIRED",
    });
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("names an event id with no verified row", async () => {
    mocks.replay.mockRejectedValue(
      Object.assign(new Error("Verified provider event was not found"), {
        code: "NOT_FOUND",
      }),
    );

    expect(await replayWebhookEvent(form())).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_EVENT_NOT_FOUND",
    });
  });

  // The finance repository cannot be constructed without an EXT-TAX-01 engine,
  // and replay runs on it. Nothing composed a tax provider before this change,
  // so this case had nothing to assert.
  it("refuses when no tax provider is configured", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;

    expect(await replayWebhookEvent(form())).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_FAILED",
    });
    expect(mocks.replay).not.toHaveBeenCalled();
  });

  it("keeps provider and database detail out of a generic failure", async () => {
    mocks.replay.mockRejectedValue(
      new Error("connection to 10.0.0.4 failed: password authentication"),
    );

    const result = await replayWebhookEvent(form());

    expect(result).toEqual({ ok: false, code: "WEBHOOK_REPLAY_FAILED" });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("reports an unconfigured database rather than throwing", async () => {
    mocks.getOptionalServiceDatabase.mockReturnValue(undefined);

    expect(await replayWebhookEvent(form())).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_UNAVAILABLE",
    });
  });

  it("requires both provider and event id", async () => {
    expect(await replayWebhookEvent(form({ providerEventId: "" }))).toEqual({
      ok: false,
      code: "WEBHOOK_REPLAY_INVALID",
    });
  });
});
