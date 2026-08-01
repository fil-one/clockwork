import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionClaims } from "@clockwork/api";
import { resetDemoExperience } from "@clockwork/testing/demo-reset";
import {
  DEMO_PRODUCTION_ENVIRONMENT_KEYS,
  FileDemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredProjectionSource,
  ExplicitDemoProjectionSource,
} from "./projection-source";

const temporaryDirectories: string[] = [];
const session = {} as SessionClaims;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("explicit demo projection durable reset", () => {
  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "fails closed when %s identifies production",
    (productionMarker) => {
      vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
      for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
        vi.stubEnv(key, key === "NODE_ENV" ? "test" : "");
      vi.stubEnv(productionMarker, " Production ");

      expect(() => configuredProjectionSource()).toThrow(
        `${productionMarker} identifies production`,
      );
      try {
        configuredProjectionSource();
      } catch (error) {
        expect(error).toMatchObject({
          status: 503,
          code: "DEMO_ADAPTER_FORBIDDEN",
        });
      }
    },
  );

  it("makes a mutation browser-visible across source instances and restores pristine data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clockwork-web-demo-"));
    temporaryDirectories.push(directory);
    const store = new FileDemoAdapterStateStore(join(directory, "state.json"));
    const source = new ExplicitDemoProjectionSource(store);
    const initial = await source.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: null,
      recordKey: "Q-2026-0184-v3",
      now: new Date("2026-07-31T16:00:00Z"),
    });

    const receipt = await source.action({
      session,
      projectionId: initial.id,
      recordKey: initial.recordKey,
      audience: initial.audience,
      channel: initial.channel,
      accountId: null,
      action: "accept",
      expectedVersion: initial.version,
      idempotencyKey: "demo-action-idempotency-1",
      payload: {},
      requestId: "demo-action-request-1",
    });

    const independentSource = new ExplicitDemoProjectionSource(
      new FileDemoAdapterStateStore(store.location),
    );
    const dirty = await independentSource.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: null,
      recordKey: initial.recordKey,
      now: new Date("2026-08-01T12:00:00Z"),
    });
    expect(dirty).toMatchObject({
      version: initial.version + 1,
      data: {
        status: "pending",
        statusLabel: "Action queued",
        nextAction: "accept queued",
      },
    });
    await expect(
      independentSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: null,
        recordKey: initial.recordKey,
        actionRequestId: receipt.id,
        requestId: "demo-receipt-request-1",
      }),
    ).resolves.toEqual(receipt);
    await expect(
      independentSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: null,
        recordKey: "Q-2026-0171-v1",
        actionRequestId: receipt.id,
        requestId: "demo-receipt-wrong-record-request",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_ACTION_NOT_FOUND" });

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });

    const resetSource = new ExplicitDemoProjectionSource(
      new FileDemoAdapterStateStore(store.location),
    );
    await expect(
      resetSource.find({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: null,
        recordKey: initial.recordKey,
        now: new Date("2026-07-31T16:00:00Z"),
      }),
    ).resolves.toEqual(initial);
    await expect(
      resetSource.receipt({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: null,
        recordKey: initial.recordKey,
        actionRequestId: receipt.id,
        requestId: "demo-receipt-request-2",
      }),
    ).rejects.toMatchObject({ code: "PROJECTION_ACTION_NOT_FOUND" });
  });
});
