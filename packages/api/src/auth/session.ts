import { ids, RoleSchema } from "@clockwork/contracts";
import type { Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { createMiddleware } from "hono/factory";

import type { ApiVariables } from "../context";

export interface SessionClaims {
  userId: string;
  organizationId?: string;
  accountIds: readonly string[];
  roles: readonly Role[];
  isInternalStaff: boolean;
  mfaVerified: boolean;
  recentAuthenticationVerified: boolean;
  impersonation?: {
    accountId: string;
    reason: string;
    sessionId: string;
    actualUserId: string;
    actualActorEmail: string;
  };
}

export interface SessionResolver {
  resolve(request: Request): Promise<SessionClaims | null>;
}

export class LocalSessionResolver implements SessionResolver {
  public resolve(request: Request): Promise<SessionClaims | null> {
    if (process.env.NODE_ENV === "production") return Promise.resolve(null);
    const persona =
      request.headers.get("x-clockwork-persona") ?? "internal_operator";
    const parsedRole = RoleSchema.safeParse(persona);
    const role = parsedRole.success ? parsedRole.data : "member";
    const internal =
      role.startsWith("internal_") ||
      role.endsWith("_approver") ||
      role === "destructive_action_approver";
    return Promise.resolve({
      userId: internal
        ? "20000000-0000-4000-8000-000000000001"
        : "20000000-0000-4000-8000-000000000002",
      organizationId: internal
        ? "30000000-0000-4000-8000-000000000008"
        : "30000000-0000-4000-8000-000000000001",
      accountIds: internal
        ? []
        : [
            request.headers.get("x-clockwork-account") ??
              "10000000-0000-4000-8000-000000000001",
          ],
      roles: [role],
      isInternalStaff: internal,
      mfaVerified: request.headers.get("x-clockwork-mfa") !== "false",
      recentAuthenticationVerified:
        request.headers.get("x-clockwork-recent-auth") !== "false",
    });
  }
}

export const sessionMiddleware = (resolver: SessionResolver) =>
  createMiddleware<{ Variables: ApiVariables }>(async (context, next) => {
    if (context.req.path.startsWith("/v1/webhooks/")) {
      await next();
      return;
    }
    const session = await resolver.resolve(context.req.raw);
    if (session) {
      const request = context.get("requestContext");
      const authorization: AuthorizationContext = {
        userId: ids.user.parse(session.userId),
        accountIds: session.accountIds.map((accountId) =>
          ids.account.parse(accountId),
        ),
        roles: session.roles,
        isInternalStaff: session.isInternalStaff,
        mfaVerified: session.mfaVerified,
        recentAuthenticationVerified: session.recentAuthenticationVerified,
        ...(session.organizationId
          ? { organizationId: session.organizationId }
          : {}),
        ...(session.impersonation
          ? {
              impersonation: {
                accountId: ids.account.parse(session.impersonation.accountId),
                reason: session.impersonation.reason,
                sessionId: session.impersonation.sessionId,
                actualUserId: ids.user.parse(
                  session.impersonation.actualUserId,
                ),
                actualActorEmail: session.impersonation.actualActorEmail,
              },
            }
          : {}),
      };
      context.set("requestContext", { ...request, authorization });
    }
    await next();
  });
