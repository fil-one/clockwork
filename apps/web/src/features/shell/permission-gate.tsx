"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

import { hasPermission, roles as commerceRoles } from "@clockwork/contracts";
import type { Permission, Role } from "@clockwork/contracts";

import { t } from "@/src/i18n/en";

import { roleCanAccess, type ExperienceAudience } from "./navigation";

const RoleContext = createContext<readonly string[]>([
  "owner",
  "partner_admin",
  "internal_operator",
]);

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

export function PermissionSessionProvider({
  roles,
  children,
}: {
  roles: readonly string[];
  children: ReactNode;
}) {
  return <RoleContext.Provider value={roles}>{children}</RoleContext.Provider>;
}

function Denied() {
  return (
    <main className="permission-view" id="main-content">
      <section className="state-card state-card--warning" role="alert">
        <p className="eyebrow">403</p>
        <h1>{t("session.permission.title")}</h1>
        <p>{t("session.permission.description")}</p>
        <Link className="cw-button cw-button--secondary" href="/dashboard">
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

export function SurfacePermissionGate({
  audience,
  requiredPermission,
  children,
}: {
  audience: ExperienceAudience;
  requiredPermission: Permission;
  children: ReactNode;
}) {
  const roles = useContext(RoleContext);
  return permitted(audience, roles, requiredPermission) ? children : <Denied />;
}
