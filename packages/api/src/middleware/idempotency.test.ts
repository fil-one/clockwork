import { ids, ProblemError } from "@clockwork/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { ApiVariables } from "../context";
import {
  anonymousScopeBindings,
  idempotencyMiddleware,
  MemoryIdempotencyStore,
} from "./idempotency";
import { requestContextMiddleware } from "./request-context";

const registrationPath = "/v1/lifecycle/registrations";
const userId = ids.user.parse("30000000-0000-4000-8000-000000000001");

function registrationBody(token: string, name = "Acme") {
  return JSON.stringify({ registrationToken: token, legalName: name });
}

interface AppOptions {
  authenticated?: boolean;
  store?: MemoryIdempotencyStore;
  respond?: () => Response;
}

function createApp(options: AppOptions = {}) {
  const store = options.store ?? new MemoryIdempotencyStore();
  let executions = 0;
  const app = new Hono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(error.problem, error.problem.status as 403 | 409, {
        "content-type": "application/problem+json",
      });
    throw error;
  });
  app.use("*", requestContextMiddleware);
  if (options.authenticated)
    app.use("*", async (context, next) => {
      context.set("requestContext", {
        ...context.get("requestContext"),
        authorization: {
          userId,
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
  app.all("*", (context) => {
    executions += 1;
    if (options.respond) return options.respond();
    return context.json({ executions, secret: "registrant-only" }, 200, {
      "x-account-id": "account-of-the-first-caller",
    });
  });
  return { app, store, executions: () => executions };
}

function post(body: string, key: string, path = registrationPath) {
  return [
    path,
    {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      body,
    },
  ] as const;
}

describe("anonymous idempotency scope", () => {
  it("keeps two registrants with the same key in separate namespaces", async () => {
    const { app, executions } = createApp();
    const key = "shared-key-across-registrants";

    const first = await app.request(
      ...post(registrationBody("a".repeat(40), "First"), key),
    );
    const second = await app.request(
      ...post(registrationBody("b".repeat(40), "Second"), key),
    );

    expect(first.status).toBe(200);
    // Against the unfixed middleware both callers land in
    // `anonymous:/v1/lifecycle/registrations`, so the second body hashes
    // differently and is refused with 409 IDEMPOTENCY_KEY_CONFLICT.
    expect(second.status).toBe(200);
    expect(executions()).toBe(2);
  });

  it("refuses to serve a recorded response to an anonymous caller", async () => {
    const { app, executions } = createApp();
    const body = registrationBody("c".repeat(40));
    const key = "anonymous-replay-attempt-01";

    const first = await app.request(...post(body, key));
    const replay = await app.request(...post(body, key));

    await expect(first.json()).resolves.toMatchObject({
      secret: "registrant-only",
    });
    expect(replay.status).toBe(409);
    const replayed = await replay.text();
    expect(JSON.parse(replayed)).toMatchObject({
      code: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
      retryable: false,
    });
    // The point of the control: no body and no headers cross over.
    expect(replayed).not.toContain("registrant-only");
    expect(replay.headers.get("x-account-id")).toBeNull();
    // The caller is still told this key is already recorded, so a retry loop
    // stops rather than treating the denial as a fresh failure.
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    // The duplicate-side-effect guarantee still holds.
    expect(executions()).toBe(1);
  });

  it("persists neither body nor headers for an anonymous record", async () => {
    const store = new MemoryIdempotencyStore();
    const complete = vi.spyOn(store, "complete");
    const { app } = createApp({ store });

    await app.request(
      ...post(registrationBody("d".repeat(40)), "anonymous-storage-01"),
    );

    const stored = complete.mock.calls[0]?.[4];
    expect(stored?.status).toBe(200);
    expect(stored?.body).toBeUndefined();
    expect(stored?.headers).toBeUndefined();
  });

  it("denies an anonymous mutation on a route with no scope binding", async () => {
    const { app, executions } = createApp();

    const response = await app.request(
      ...post("{}", "unbound-route-key-0001", "/v1/lifecycle/quotes"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_SCOPE_UNRESOLVED",
    });
    expect(executions()).toBe(0);
  });

  it.each([
    ["a body that is not JSON", "not-json-at-all"],
    ["a missing token", JSON.stringify({ legalName: "Acme" })],
    ["a token below the schema minimum", registrationBody("short")],
    ["a non-string token", JSON.stringify({ registrationToken: 42 })],
  ])("denies %s rather than sharing one namespace", async (_label, body) => {
    const { app, executions } = createApp();

    const response = await app.request(...post(body, "unresolvable-key-0001"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_SCOPE_UNRESOLVED",
    });
    expect(executions()).toBe(0);
  });

  it("binds only the registration route, and only to its token", () => {
    expect(anonymousScopeBindings).toHaveLength(1);
    expect(anonymousScopeBindings[0]).toMatchObject({
      method: "POST",
      path: registrationPath,
    });
  });
});

describe("authenticated idempotency replay", () => {
  it("still replays the recorded response to the same principal", async () => {
    const { app, executions } = createApp({ authenticated: true });
    const body = registrationBody("e".repeat(40));
    const key = "authenticated-replay-0001";

    const first = await app.request(...post(body, key));
    const replay = await app.request(...post(body, key));

    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toEqual(await first.json());
    expect(executions()).toBe(1);
  });
});

describe("idempotency status policy", () => {
  function statusApp(statuses: number[], authenticated = true) {
    let call = 0;
    return createApp({
      authenticated,
      respond: () => {
        const status = statuses[Math.min(call, statuses.length - 1)] ?? 200;
        call += 1;
        return new Response(JSON.stringify({ attempt: call, status }), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
    });
  }

  it.each([[503], [500], [429], [408], [425]])(
    "leaves the key retryable after a %i",
    async (transient) => {
      const { app, executions } = statusApp([transient, 200]);
      const request = post(
        registrationBody("f".repeat(40)),
        "transient-status-0001",
      );

      const first = await app.request(...request);
      const retry = await app.request(...request);

      expect(first.status).toBe(transient);
      // Against the unfixed middleware the retry replays the cached transient
      // status for twenty-four hours and the handler never runs again.
      expect(retry.status).toBe(200);
      expect(retry.headers.get("idempotency-replayed")).toBeNull();
      expect(executions()).toBe(2);
    },
  );

  it.each([[200], [201], [303], [400], [403], [404], [422]])(
    "replays a final %i without re-executing the handler",
    async (final) => {
      const { app, executions } = statusApp([final, 200]);
      const request = post(
        registrationBody("g".repeat(40)),
        "final-status-key-0001",
      );

      const first = await app.request(...request);
      const replay = await app.request(...request);

      expect(first.status).toBe(final);
      expect(replay.status).toBe(final);
      expect(replay.headers.get("idempotency-replayed")).toBe("true");
      expect(executions()).toBe(1);
    },
  );

  it("still conflicts on a changed body after a released claim", async () => {
    const { app } = statusApp([503, 200]);
    const key = "released-then-changed-0001";

    const first = await app.request(
      ...post(registrationBody("h".repeat(40), "First"), key),
    );
    const changed = await app.request(
      ...post(registrationBody("h".repeat(40), "Changed"), key),
    );

    expect(first.status).toBe(503);
    expect(changed.status).toBe(409);
    await expect(changed.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });
});
