import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";
import { type ReactNode } from "react";

import { hasPermission, roles as commerceRoles } from "@clockwork/contracts";
import type { Permission, Role } from "@clockwork/contracts";
import { buttonClassName } from "@clockwork/ui";

import { roleCanAccess, type ExperienceAudience } from "./navigation";
import { PermissionSessionProvider } from "./permission-session";

export { PermissionSessionProvider };

function isCommerceRole(role: string): role is Role {
  return (commerceRoles as readonly string[]).includes(role);
}

function permitted(
  audience: ExperienceAudience,
  roles: readonly string[],
  requiredPermission?: Permission,
): boolean {
  return roles.some(
    (role) =>
      roleCanAccess(audience, role) &&
      (!requiredPermission ||
        (isCommerceRole(role) && hasPermission(role, requiredPermission))),
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
  roles,
  requiredPermission,
  children,
}: {
  audience: ExperienceAudience;
  roles: readonly string[];
  requiredPermission?: Permission;
  children: ReactNode;
}) {
  if (!permitted(audience, roles, requiredPermission)) return <Denied />;
  return (
    <PermissionSessionProvider roles={roles}>
      {children}
    </PermissionSessionProvider>
  );
}

/**
 * Resolves the roles on the server so a denied surface never renders its
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
  const { getRouteRoles } = await import("./route-session");
  const roles = await getRouteRoles(audience);
  if (!permitted(audience, roles, requiredPermission)) return <Denied />;
  return children;
}

/**
 * Gates one mutation inside a surface the reader is already allowed to open.
 * A denied action renders nothing rather than replacing the page with a 403,
 * and resolves its roles on the server so the form never reaches a browser
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
  const { getRouteRoles } = await import("./route-session");
  const roles = await getRouteRoles(audience);
  if (!permitted(audience, roles, requiredPermission)) return null;
  return children;
}
