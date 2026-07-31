import type { AccountId, Permission } from "@clockwork/contracts";
import { ProblemError } from "@clockwork/contracts";
import { authorize, AuthorizationError } from "@clockwork/domain";
import type { Context } from "hono";

import type { ApiVariables } from "../context";

export function requirePermission(
  context: Context<{ Variables: ApiVariables }>,
  permission: Permission,
  accountId?: AccountId,
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
    authorize(request.authorization, permission, accountId);
    return request.authorization;
  } catch (error) {
    const mfa =
      error instanceof AuthorizationError && error.code === "MFA_REQUIRED";
    throw new ProblemError({
      type: `https://clockwork.test/problems/${mfa ? "mfa" : "authorization"}`,
      title: mfa ? "MFA required" : "Forbidden",
      status: 403,
      code: mfa ? "MFA_REQUIRED" : "FORBIDDEN",
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
