import { ProblemError } from "@clockwork/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { ApiVariables } from "./context";
import {
  idempotencyMiddleware,
  MemoryIdempotencyStore,
} from "./middleware/idempotency";
import { requestContextMiddleware } from "./middleware/request-context";
import { csrfAndOriginMiddleware } from "./middleware/security";

function problemResponseApp() {
  const app = new Hono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(
        error.problem,
        error.problem.status as 400 | 403 | 409,
        { "content-type": "application/problem+json" },
      );
    throw error;
  });
  return app;
}

describe("CSRF and origin middleware", () => {
  const origin = "https://commerce.clockwork.test";
  const csrfToken = "csrf-token-that-is-at-least-32-characters";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createApp() {
    vi.stubEnv("APP_ORIGIN", origin);
    const app = problemResponseApp();
    app.use("*", requestContextMiddleware);
    app.use("*", csrfAndOriginMiddleware);
    app.post("/mutate", (context) => context.json({ ok: true }));
    return app;
  }

  it("rejects an unsafe request from a different origin", async () => {
    const response = await createApp().request("/mutate", {
      method: "POST",
      headers: {
        cookie: `clockwork-csrf=${csrfToken}`,
        origin: "https://attacker.example",
        "x-csrf-token": csrfToken,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
  });

  it("rejects a missing double-submit token from the allowed origin", async () => {
    const response = await createApp().request("/mutate", {
      method: "POST",
      headers: { origin },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });

  it("accepts matching origin, cookie, and header tokens", async () => {
    const response = await createApp().request("/mutate", {
      method: "POST",
      headers: {
        cookie: `clockwork-csrf=${csrfToken}`,
        origin,
        "x-csrf-token": csrfToken,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("idempotency middleware", () => {
  function createApp(store = new MemoryIdempotencyStore()) {
    let executions = 0;
    const app = problemResponseApp();
    app.use("*", requestContextMiddleware);
    app.use("*", idempotencyMiddleware(store));
    app.post("/mutate", (context) => {
      executions += 1;
      return context.json({
        executions,
        variant: context.req.query("variant") ?? null,
      });
    });
    return { app, executions: () => executions };
  }

  it("replays the first response without executing the handler twice", async () => {
    const { app, executions } = createApp();
    const request = {
      method: "POST",
      headers: { "idempotency-key": "middleware-replay-0001" },
    };

    const first = await app.request("/mutate?variant=first", request);
    const replay = await app.request("/mutate?variant=first", request);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      executions: 1,
      variant: "first",
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toEqual({
      executions: 1,
      variant: "first",
    });
    expect(executions()).toBe(1);
  });

  it("rejects the same key when only the mutation query changes", async () => {
    const { app, executions } = createApp();
    const request = {
      method: "POST",
      headers: { "idempotency-key": "middleware-query-0001" },
    };

    expect((await app.request("/mutate?variant=first", request)).status).toBe(
      200,
    );
    const conflict = await app.request("/mutate?variant=second", request);

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
    expect(executions()).toBe(1);
  });

  it("rejects a stale completion token without replacing the active claim", async () => {
    const store = new MemoryIdempotencyStore();
    const scope = "integration:/mutate";
    const key = "stale-completion-0001";
    const requestHash = "request-hash";
    const claim = await store.claim(scope, key, requestHash);
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("Expected a fresh claim");

    await expect(
      store.complete(scope, key, requestHash, "stale-token", {
        requestHash,
        state: "complete",
        status: 201,
      }),
    ).rejects.toThrow("Stale in-memory idempotency lease");
    await expect(store.claim(scope, key, requestHash)).resolves.toEqual({
      kind: "running",
    });

    await store.complete(scope, key, requestHash, claim.claimToken, {
      requestHash,
      state: "complete",
      status: 201,
    });
    await expect(store.claim(scope, key, requestHash)).resolves.toMatchObject({
      kind: "replay",
      response: { status: 201 },
    });
  });
});
