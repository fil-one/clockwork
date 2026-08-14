import type { Permission } from "@clockwork/contracts";
import { ProblemError } from "@clockwork/contracts";
import { authorize, AuthorizationError } from "@clockwork/domain";
import type { AccountScope } from "@clockwork/domain";
import type { Context } from "hono";

import type { ApiVariables } from "../context";

/**
 * The route-facing entry point into {@link authorize}. `scope` is required and
 * has no `undefined` member, so a route that forgets to say which account it is
 * acting inside does not compile. See `AccountScope` for the values that stand
 * in for an account id and what each one costs.
 */
export function requirePermission<P extends Permission>(
  context: Context<{ Variables: ApiVariables }>,
  permission: P,
  scope: AccountScope<P>,
) {
  const request = context.get("requestContext");
  if (!request.authorization) {
    throw new ProblemError({
      type: "https://clockwork.test/problems/authentication",
      title: "Authentication required",
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      requestId: request.requestId,
      retryable: false,
    });
  }
  try {
    authorize(request.authorization, permission, scope);
    return request.authorization;
  } catch (error) {
    const mfa =
      error instanceof AuthorizationError && error.code === "MFA_REQUIRED";
    const crossAccount =
      error instanceof AuthorizationError && error.code === "ACCOUNT_SCOPE";
    // A scope the control could not place, or a cross-account read a tenant is
    // not entitled to, keeps the wire shape the routes already emitted for a
    // missing account filter.
    const scopeRequired =
      error instanceof AuthorizationError &&
      error.code === "ACCOUNT_SCOPE_REQUIRED";
    throw new ProblemError({
      type: `https://clockwork.test/problems/${
        mfa ? "mfa" : scopeRequired ? "account-scope" : "authorization"
      }`,
      title: mfa
        ? "MFA required"
        : scopeRequired
          ? "Account scope required"
          : crossAccount
            ? "Cross-account access denied"
            : "Forbidden",
      status: 403,
      code: mfa
        ? "MFA_REQUIRED"
        : scopeRequired
          ? "ACCOUNT_SCOPE_REQUIRED"
          : crossAccount
            ? "CROSS_ACCOUNT_DENIED"
            : "AUTHORIZATION_DENIED",
      requestId: request.requestId,
      retryable: false,
    });
  }
}

/** Require AuthKit's recent-authentication check before a sensitive mutation. */
export function requireRecentAuthentication(
  context: Context<{ Variables: ApiVariables }>,
) {
  const request = context.get("requestContext");
  if (!request.authorization?.recentAuthenticationVerified)
    throw new ProblemError({
      type: "https://clockwork.test/problems/recent-authentication",
      title: "Recent authentication required",
      status: 403,
      code: "RECENT_AUTHENTICATION_REQUIRED",
      requestId: request.requestId,
      retryable: false,
    });
  return request.authorization;
}
