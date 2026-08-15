import { beforeAll, describe, expect, it, vi } from "vitest";

// The real resolver pulls in @workos-inc/authkit-nextjs, which needs the Next
// server runtime. Composition is what is under test here, not the session.
vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public resolve() {
      return Promise.resolve(undefined);
    }
  },
}));

let handle: (request: Request) => Promise<Response>;

/**
 * The Core finance lane composes without EXT-TAX-01.
 *
 * It did not, and the cost was total: `configuredTaxProvider()` returning
 * `undefined` -- which it does in every checkout, because nothing in this
 * repository sets TAX_PROVIDER_BASE_URL or TAX_PROVIDER_TOKEN -- dropped
 * `core` from `createApiApp`, so `/v1/core/status` reported
 * `{"service":"missing"}` and every `POST /v1/core/commands/*` answered 500
 * "Core-finance route dependencies are not configured" before permissions,
 * payload or RLS were consulted. Quote creation on the customer surface and on
 * the partner surface died the same way, and neither can write a `tax_minor`.
 *
 * The gate itself did not move out of the way; it moved onto the port. See
 * src/providers/tax.test.ts for what an unconfigured port answers, and
 * packages/db/src/repositories/core/database-finance.integration.test.ts for
 * the two commands that ask it and therefore still refuse.
 */
describe("api composition", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
    process.env.CLOCKWORK_SERVICE_DATABASE_URL =
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
    process.env.AUTHORIZATION_CONTEXT_SECRET =
      "clockwork-local-auth-context-secret-change-me";
    delete process.env.TAX_PROVIDER_BASE_URL;
    delete process.env.TAX_PROVIDER_TOKEN;
    ({ handle } = await import("./hono-app"));
  });

  it("binds the database core-finance service with no tax provider configured", async () => {
    const response = await handle(
      new Request("https://local.test/api/v1/core/status"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lane: "core",
      details: { service: "database" },
    });
  });

  it("answers a core command with its own refusal, not a dependency error", async () => {
    const response = await handle(
      new Request("https://local.test/api/v1/core/commands/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    // Origin, then CSRF, then session, then the command. Any of those is the
    // route deciding something. 500 INTERNAL_ERROR "Core-finance route
    // dependencies are not configured" is the route not existing.
    expect(response.status).not.toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "Core-finance route dependencies are not configured",
    );
  });
});
