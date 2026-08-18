import type { TaxPort } from "@clockwork/contracts";
import { ids, MoneySchema } from "@clockwork/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  getOptionalRuntimeDatabase: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
  construct: vi.fn(),
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
    public constructor(options: unknown) {
      mocks.construct(options);
    }

    public replay = mocks.replay;
  },
}));

import { replayWebhookEvent } from "./actions";

/** The port the action actually handed the repository, for this call. */
function composedTaxPort(): TaxPort {
  expect(mocks.construct).toHaveBeenCalledTimes(1);
  const options = mocks.construct.mock.calls[0]?.[0] as { tax: TaxPort };
  return options.tax;
}

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
        reason: "INC-4021 duplicate delivery, safe to replay",
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

  // Replay never asks the tax port anything. Composing the repository with
  // `requiredTaxProvider()` made an unwired EXT-TAX-01 refuse the command
  // outright: the throw happened while the argument list was being built, so
  // the service was never constructed and the replay was never attempted.
  it("still reaches the replay command when no tax provider is configured", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;

    const result = await replayWebhookEvent(form());

    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.replay).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "stripe", eventId: "evt_1" }),
    );
    expect(result).toMatchObject({ ok: true, started: true });
  });

  it("hands the repository a tax port that refuses rather than one that throws", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;

    await replayWebhookEvent(form());
    const tax = composedTaxPort();

    // Not a zero-rate stub: the port answers every determination with a
    // permanent refusal, so the two commands that can write a `tax_minor`
    // still fail closed while the rest of the lane composes.
    await expect(
      tax.calculate({
        accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
        jurisdiction: "ES",
        lines: [
          {
            taxCode: "txcd_demo",
            amount: MoneySchema.parse({ currency: "EUR", minor: "168000" }),
          },
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_PROVIDER_NOT_CONFIGURED",
    });
    await expect(
      tax.validateTaxId({ country: "ES", value: "ESA12345674" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAX_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("surfaces a durable replay failure rather than reporting a silent success", async () => {
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;
    mocks.replay.mockRejectedValue(
      Object.assign(new Error("WEBHOOK_REPLAY_OUTBOX_UNAVAILABLE"), {
        code: "INVALID_STATE",
      }),
    );

    const result = await replayWebhookEvent(form());

    expect(result).toEqual({ ok: false, code: "WEBHOOK_REPLAY_FAILED" });
    expect(result.started).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
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
