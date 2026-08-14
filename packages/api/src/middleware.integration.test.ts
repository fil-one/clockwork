import { ids, ProblemError } from "@clockwork/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

import type { ApiVariables } from "./context";
import {
  idempotencyMiddleware,
  MemoryIdempotencyStore,
} from "./middleware/idempotency";
import { requestContextMiddleware } from "./middleware/request-context";
import {
  createCsrfAndOriginMiddleware,
  csrfAndOriginMiddleware,
} from "./middleware/security";

function problemResponseApp() {
  const app = new Hono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(
        error.problem,
        error.problem.status as 400 | 403 | 409 | 413,
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

  it("accepts only a custom origin approved by the persisted resolver", async () => {
    vi.stubEnv("APP_ORIGIN", origin);
    const resolver = {
      isAllowed: vi
        .fn()
        .mockImplementation(({ origin: candidate }: { origin: string }) =>
          Promise.resolve(candidate === "https://brand.partner.example"),
        ),
    };
    const app = problemResponseApp();
    app.use("*", requestContextMiddleware);
    app.use("*", createCsrfAndOriginMiddleware(resolver));
    app.post("/mutate", (context) => context.json({ ok: true }));
    const headers = {
      cookie: `clockwork-csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
    };
    const verified = await app.request("/mutate", {
      method: "POST",
      headers: { ...headers, origin: "https://brand.partner.example" },
    });
    const unverified = await app.request("/mutate", {
      method: "POST",
      headers: { ...headers, origin: "https://lookalike.partner.example" },
    });
    expect(verified.status).toBe(200);
    expect(unverified.status).toBe(403);
    expect(resolver.isAllowed).toHaveBeenCalledTimes(2);
  });
});

describe("webhook request context hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createApp() {
    const app = problemResponseApp();
    app.use("*", requestContextMiddleware);
    app.post("/v1/webhooks/test", (context) => {
      const request = context.get("requestContext");
      return context.json({
        bytes: request.rawWebhookBody?.byteLength ?? -1,
        ip: request.ip,
      });
    });
    return app;
  }

  it("rejects a declared webhook body larger than the configured limit", async () => {
    vi.stubEnv("WEBHOOK_MAX_BODY_BYTES", "16");
    const response = await createApp().request("/v1/webhooks/test", {
      method: "POST",
      headers: { "content-length": "17" },
      body: "payload",
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "WEBHOOK_BODY_TOO_LARGE",
    });
  });

  it("enforces the byte limit when content length is absent", async () => {
    vi.stubEnv("WEBHOOK_MAX_BODY_BYTES", "4");
    const response = await createApp().request("/v1/webhooks/test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("123"));
          controller.enqueue(new TextEncoder().encode("45"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(response.status).toBe(413);
  });

  it("ignores caller-controlled forwarding headers by default", async () => {
    const response = await createApp().request("/v1/webhooks/test", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.55" },
      body: "{}",
    });
    await expect(response.json()).resolves.toMatchObject({
      bytes: 2,
      ip: null,
    });
  });

  it("selects the address observed by the configured trusted edge", async () => {
    vi.stubEnv("CLOCKWORK_TRUSTED_PROXY_HOPS", "1");
    const response = await createApp().request("/v1/webhooks/test", {
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.99, 203.0.113.55",
      },
      body: "{}",
    });
    await expect(response.json()).resolves.toMatchObject({
      bytes: 2,
      ip: "203.0.113.55",
    });
  });
});

describe("idempotency middleware", () => {
  function createApp(store = new MemoryIdempotencyStore()) {
    let executions = 0;
    const app = problemResponseApp();
    app.use("*", requestContextMiddleware);
    // Replay is a property of an identified principal: an anonymous caller is
    // never handed a recorded body. See middleware/idempotency.test.ts for the
    // unauthenticated cases.
    app.use("*", async (context, next) => {
      context.set("requestContext", {
        ...context.get("requestContext"),
        authorization: {
          userId: ids.user.parse("30000000-0000-4000-8000-000000000009"),
          accountIds: [],
          roles: ["owner"],
          isInternalStaff: false,
          mfaVerified: true,
          recentAuthenticationVerified: true,
        },
      });
      await next();
    });
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
