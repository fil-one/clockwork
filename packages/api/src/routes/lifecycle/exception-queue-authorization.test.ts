import { ids, ProblemError } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { ApiVariables } from "../../context";
import { requestContextMiddleware } from "../../middleware/request-context";
import { registerLifecycleRoutes } from ".";
import type {
  LifecycleAuthorizationScopeResolver,
  LifecycleRouteService,
} from "./types";

/**
 * The exception queue is internal work, said at the route.
 *
 * `poc_qualification` is the queue that makes the point: its permission is
 * `poc:manage`, which owner, admin and partner_admin all hold, so a tenant
 * reached both of these routes on permission alone and supplied the account id
 * that stood in for staff status. What stopped the write was
 * `exception_cases_scope` -- `with check (app_is_internal())` since the
 * foundation migration -- which meant a 42501 out of the database rather than a
 * typed refusal, and only after the command had read the case.
 *
 * The other half is the operation this must not block: an internal operator
 * holds `poc:manage` and belongs to no account, so passing the case's account
 * id as the scope denied THEM, not the tenant. Both halves are asserted here.
 */
const accountId = "10000000-0000-4000-8000-000000000001";
const caseId = "80000000-0000-4000-8000-000000000001";

const tenantOwner: AuthorizationContext = {
  userId: ids.user.parse("30000000-0000-4000-8000-000000000001"),
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const tenantPartnerAdmin: AuthorizationContext = {
  ...tenantOwner,
  roles: ["partner_admin"],
};
const internalOperator: AuthorizationContext = {
  userId: ids.user.parse("30000000-0000-4000-8000-000000000002"),
  // Deliberately empty: an internal operator is a member of no tenant account,
  // which is exactly why an account-scoped decision denied them.
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function createApp(authorization: AuthorizationContext) {
  const openException = vi
    .fn()
    .mockResolvedValue({ id: caseId, status: "open" });
  const decideException = vi
    .fn()
    .mockResolvedValue({ id: caseId, status: "approved" });
  const resolveExceptionScope = vi
    .fn()
    .mockResolvedValue({ accountId, queue: "poc_qualification" });
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
    service: {
      openException,
      decideException,
    } as unknown as LifecycleRouteService,
    authorizationScopes: {
      resolveExceptionScope,
    } as unknown as LifecycleAuthorizationScopeResolver,
  });
  return { app, openException, decideException };
}

function openRequest(body: Record<string, unknown> = {}) {
  return [
    "/v1/lifecycle/exceptions",
    {
      method: "POST",
      headers: {
        "idempotency-key": "exception-open-key-0001",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accountId,
        queue: "poc_qualification",
        objectType: "poc",
        objectId: "70000000-0000-4000-8000-000000000001",
        reason: "A proof of concept needs qualification before it starts",
        evidenceDocumentId: "40000000-0000-4000-8000-000000000002",
        ...body,
      }),
    },
  ] as const;
}

function decisionRequest() {
  return [
    `/v1/lifecycle/exceptions/${caseId}/decisions`,
    {
      method: "POST",
      headers: {
        "idempotency-key": "exception-decide-key-0001",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision: "approved",
        reason: "Qualification evidence is complete",
        evidenceDocumentId: "40000000-0000-4000-8000-000000000002",
      }),
    },
  ] as const;
}

describe("exception queue route authorization", () => {
  it.each([
    ["owner", tenantOwner],
    ["partner_admin", tenantPartnerAdmin],
  ])(
    "denies a tenant %s opening a case for their own account",
    async (_label, authorization) => {
      const { app, openException } = createApp(authorization);

      const response = await app.request(...openRequest());

      // Unfixed, `body.accountId` was accepted as an alternative to staff
      // status, so this answered 200 and the refusal was a 42501 raised by
      // `exception_cases_scope` deep inside the command. Now it is a typed
      // problem document from the control: `unscopedInternalStaff` denies a
      // non-staff caller inside `authorize`, which is the first of the two
      // layers -- the route's own `INTERNAL_STAFF_REQUIRED` arm is the second
      // and stays unreachable while the control holds, exactly as on
      // `POST /v1/lifecycle/migrations`.
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        type: "https://clockwork.test/problems/account-scope",
        code: "ACCOUNT_SCOPE_REQUIRED",
        retryable: false,
      });
      expect(openException).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["owner", tenantOwner],
    ["partner_admin", tenantPartnerAdmin],
  ])("denies a tenant %s deciding a case", async (_label, authorization) => {
    const { app, decideException } = createApp(authorization);

    const response = await app.request(...decisionRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      type: "https://clockwork.test/problems/account-scope",
      code: "ACCOUNT_SCOPE_REQUIRED",
      retryable: false,
    });
    expect(decideException).not.toHaveBeenCalled();
  });

  it("omitting the account id is refused the same way, not differently", async () => {
    // The old arm treated a missing account id as the suspicious case and a
    // supplied one as the safe case. Both are the same case now.
    const { app, openException } = createApp(tenantOwner);

    const response = await app.request(...openRequest({ accountId: null }));

    expect(response.status).toBe(403);
    expect(openException).not.toHaveBeenCalled();
  });

  it("still lets an internal operator open a case", async () => {
    const { app, openException } = createApp(internalOperator);

    const response = await app.request(...openRequest());

    expect(response.status).toBe(200);
    expect(openException).toHaveBeenCalledTimes(1);
  });

  it("still lets an internal operator decide a case on an account they do not belong to", async () => {
    // The legitimate operation, and the one the account-scoped arm blocked:
    // `authorize` requires membership or impersonation for an account scope,
    // and an internal operator has neither.
    const { app, decideException } = createApp(internalOperator);

    const response = await app.request(...decisionRequest());

    expect(response.status).toBe(200);
    expect(decideException).toHaveBeenCalledTimes(1);
    expect(decideException).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId,
        accountId,
        queue: "poc_qualification",
      }),
      expect.anything(),
    );
  });
});
