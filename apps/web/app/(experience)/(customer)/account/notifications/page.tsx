import {
  hasPermission,
  ids,
  roles as commerceRoles,
  type Role,
} from "@clockwork/contracts";
import { DatabaseNotificationPreferenceRepository } from "@clockwork/db";

import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { getOptionalRuntimeDatabase } from "@/src/db/service";
import { demoNotificationPreferences } from "@/src/features/experience-server/demo-account-controls";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";

import {
  NotificationPreferences,
  NotificationPreferencesUnavailable,
} from "./notification-preferences";
import {
  notificationChannel,
  type StoredPreference,
} from "./notification-preference-model";

// The session and the account's stored preferences are both request-scoped
// reads; nothing here is cacheable across accounts.
export const dynamic = "force-dynamic";

function isCommerceRole(value: string): value is Role {
  return (commerceRoles as readonly string[]).includes(value);
}

function authorizationSecret(): string {
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error(
      // i18n-exempt: deployment configuration error for operators; the route's error boundary shows the reader its own translated message
      "AUTHORIZATION_CONTEXT_SECRET is required to read notification preferences",
    );
  return secret;
}

/**
 * Reads the acting account's own rows through the tenant pool with the
 * session's authorization context, so `notification_preference_scope` --
 * `app_has_account(account_id)` -- is what bounds the answer rather than the
 * `accountId` this page passes. The same policy governs the write the browser
 * then makes over `PUT /v1/notifications/preferences`.
 */
async function loadStoredPreferences(input: {
  accountId: string;
  userId: string;
  roles: readonly string[];
}): Promise<readonly StoredPreference[] | undefined> {
  if (explicitDemoIdentityEnabled())
    return demoNotificationPreferences(
      await configuredDemoStateStore().read(),
      input.accountId,
    );
  const runtime = getOptionalRuntimeDatabase();
  if (!runtime) return undefined;
  const repository = new DatabaseNotificationPreferenceRepository({
    database: runtime,
    authorizationSecret: authorizationSecret(),
  });
  const { items } = await repository.list({
    accountId: input.accountId,
    authorization: {
      userId: ids.user.parse(input.userId),
      accountIds: [ids.account.parse(input.accountId)],
      roles: input.roles.filter(isCommerceRole),
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    },
    requestId: `account-notification-preferences:${crypto.randomUUID()}`,
  });
  return items
    .filter((item) => item.channel === notificationChannel)
    .map((item) => ({
      alertKind: item.alertKind,
      channel: item.channel,
      enabled: item.enabled,
    }));
}

async function NotificationPreferencesWorkspace() {
  const [identity, roles] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteRoles("customer"),
  ]);
  const stored = await loadStoredPreferences({
    accountId: identity.accountId,
    userId: identity.userId,
    roles,
  });
  if (!stored) return <NotificationPreferencesUnavailable />;
  return (
    <NotificationPreferences
      context={{
        accountId: identity.accountId,
        accountName: identity.accountName,
        // `PUT /v1/notifications/preferences` requires `account:write`, so a
        // role that does not hold it is shown the settings read-only rather
        // than given controls the API would answer 403 to. The permission is
        // read from the same map the route gate uses, not restated as a role
        // list this file could get wrong.
        canManage: roles.some(
          (role) =>
            isCommerceRole(role) && hasPermission(role, "account:write"),
        ),
        stored,
      }}
    />
  );
}

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:read"
    >
      <NotificationPreferencesWorkspace />
    </SurfacePermissionGate>
  );
}
