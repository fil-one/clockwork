import { ids, ProblemError } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { ApiVariables } from "../../context";
import { requestContextMiddleware } from "../../middleware/request-context";
import { registerLifecycleRoutes } from ".";
import type { LifecycleRouteService } from "./types";

const tenantOwner: AuthorizationContext = {
  userId: ids.user.parse("30000000-0000-4000-8000-000000000001"),
  accountIds: [ids.account.parse("10000000-0000-4000-8000-000000000001")],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const tenantAdmin: AuthorizationContext = { ...tenantOwner, roles: ["admin"] };
const internalOperator: AuthorizationContext = {
  userId: ids.user.parse("30000000-0000-4000-8000-000000000002"),
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function createApp(authorization: AuthorizationContext) {
  const startMigration = vi
    .fn()
    .mockResolvedValue({ id: "run-1", status: "discovered" });
  const app = new OpenAPIHono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(error.problem, error.problem.status as 403, {
        "content-type": "application/problem+json",
      });
    throw error;
  });
  app.use("*", requestContextMiddleware);
  app.use("*", async (context, next) => {
    context.set("requestContext", {
      ...context.get("requestContext"),
      authorization,
    });
    await next();
  });
  registerLifecycleRoutes(app, {
    service: { startMigration } as unknown as LifecycleRouteService,
  });
  return { app, startMigration };
}

function migrationRequest() {
  return [
    "/v1/lifecycle/migrations",
    {
      method: "POST",
      headers: {
        "idempotency-key": "migration-start-key-0001",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        executionMode: "discovery",
        sourceSnapshotHash: "a".repeat(64),
        resumeRunId: null,
        batchSize: 10,
      }),
    },
  ] as const;
}

describe("migration start authorization", () => {
  it.each([
    ["owner", tenantOwner],
    ["admin", tenantAdmin],
  ])(
    "denies a customer %s with a fresh session before the service is reached",
    async (_label, authorization) => {
      const { app, startMigration } = createApp(authorization);

      const response = await app.request(...migrationRequest());

      // Unfixed, this route asked only for `destructive:request` -- which both
      // tenant roles hold -- so the request reached the service and the legacy
      // source load beyond it.
      expect(response.status).toBe(403);
      expect(startMigration).not.toHaveBeenCalled();
    },
  );

  it("still allows internal staff to start a migration", async () => {
    const { app, startMigration } = createApp(internalOperator);

    const response = await app.request(...migrationRequest());

    expect(response.status).toBe(200);
    expect(startMigration).toHaveBeenCalledTimes(1);
  });

  it("denies internal staff whose session is not recently re-authenticated", async () => {
    const { app, startMigration } = createApp({
      ...internalOperator,
      recentAuthenticationVerified: false,
    });

    const response = await app.request(...migrationRequest());

    expect(response.status).toBe(403);
    expect(startMigration).not.toHaveBeenCalled();
  });
});
