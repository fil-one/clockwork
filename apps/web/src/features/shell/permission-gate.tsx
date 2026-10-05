import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import { type ReactNode } from "react";

import type { Permission } from "@clockwork/contracts";
import { buttonClassName } from "@clockwork/ui";

import { audienceCanAccess, type ExperienceAudience } from "./navigation";
import { PermissionSessionProvider } from "./permission-session";

export { PermissionSessionProvider };

function permitted(
  audience: ExperienceAudience,
  permissions: readonly Permission[],
  requiredPermission?: Permission,
): boolean {
  return (
    audienceCanAccess(audience, permissions) &&
    (!requiredPermission || permissions.includes(requiredPermission))
  );
}

function Denied() {
  const t = use(getTranslations());
  return (
    <main className="permission-view" id="main-content">
      <section className="state-card state-card--warning" role="alert">
        <p className="eyebrow">403</p>
        <h1>{t("session.permission.title")}</h1>
        <p>{t("session.permission.description")}</p>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/dashboard"
        >
          {t("session.permission.action")}
        </Link>
      </section>
    </main>
  );
}

export function RoutePermissionGate({
  audience,
  permissions,
  requiredPermission,
  children,
}: {
  audience: ExperienceAudience;
  permissions: readonly Permission[];
  requiredPermission?: Permission;
  children: ReactNode;
}) {
  if (!permitted(audience, permissions, requiredPermission)) return <Denied />;
  return (
    <PermissionSessionProvider permissions={permissions}>
      {children}
    </PermissionSessionProvider>
  );
}

/**
 * Resolves the permissions on the server so a denied surface never renders its
 * children. A client-side check cannot deny anything: the async server child is
 * still rendered into the payload before the denial paints.
 */
export async function SurfacePermissionGate({
  audience,
  requiredPermission,
  children,
}: {
  audience: ExperienceAudience;
  requiredPermission: Permission;
  children: ReactNode;
}) {
  // Deferred so the session graph, which reaches the identity provider and the
  // database, loads only where a surface is actually gated.
  const { getRoutePermissions } = await import("./route-session");
  const permissions = await getRoutePermissions(audience);
  if (!permitted(audience, permissions, requiredPermission)) return <Denied />;
  return children;
}

/**
 * Gates one mutation inside a surface the reader is already allowed to open.
 * A denied action renders nothing rather than replacing the page with a 403,
 * and resolves its permissions on the server so the form never reaches a browser
 * that may not submit it.
 */
export async function SurfaceActionGate({
  audience,
  requiredPermission,
  children,
}: {
  audience: ExperienceAudience;
  requiredPermission: Permission;
  children: ReactNode;
}) {
  const { getRoutePermissions } = await import("./route-session");
  const permissions = await getRoutePermissions(audience);
  if (!permitted(audience, permissions, requiredPermission)) return null;

  return children;
}
