import "server-only";

import Link from "next/link";
import { use, type ReactNode } from "react";

import {
  internalRoles,
  rolesHavePermission,
  type Permission,
} from "@clockwork/contracts";
import { buttonClassName } from "@clockwork/ui";

import { getCommerceSession, type CommerceSession } from "@/src/auth/session";
import type { MessageId } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

import { getRouteSession } from "./route-session";

/**
 * Staff access by permission, enforced on the server for every staff page and
 * action. The rail only hides what a reader cannot use; these checks are what
 * actually refuse it.
 *
 * Pages wrap their default export with {@link withStaffPermission}, which
 * resolves the session before the page renders, so a refused page never loads
 * its data. Server actions call {@link requireStaffPermission} first.
 */

const internalRoleLabels: Readonly<
  Record<(typeof internalRoles)[number], MessageId>
> = {
  internal_operator: "role.internalOperator",
  finance_approver: "role.financeApprover",
  legal_approver: "role.legalApprover",
  destructive_action_approver: "role.destructiveActionApprover",
  revenue: "role.revenue",
  commerce_admin: "role.commerceAdmin",
};

/** The label of the role the reader was granted, which leads the session's roles. */
export function grantedRoleLabel(roles: readonly string[]): MessageId | null {
  const granted = roles.find((role): role is (typeof internalRoles)[number] =>
    (internalRoles as readonly string[]).includes(role),
  );
  return granted ? internalRoleLabels[granted] : null;
}

/** Whether a staff session may use a surface that requires `permission`. */
export function staffMayUse(
  roles: readonly string[],
  permission: Permission,
): boolean {
  return (
    roles.some((role) => (internalRoles as readonly string[]).includes(role)) &&
    rolesHavePermission(roles, permission)
  );
}

export function StaffRoleNotAvailable({ roles }: { roles: readonly string[] }) {
  const t = use(getTranslations());
  const label = grantedRoleLabel(roles);
  return (
    <main className="experience-main" id="main-content">
      <section className="state-card state-card--warning" role="alert">
        <h1>{t("platform.access.notAvailable.title")}</h1>
        <p>
          {t("platform.access.notAvailable.description", {
            role: label ? t(label) : (roles[0] ?? ""),
          })}
        </p>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/internal"
        >
          {t("platform.access.notAvailable.action")}
        </Link>
      </section>
    </main>
  );
}

/**
 * Wraps a staff page so it renders only for a session holding `permission`.
 * Anyone else sees a plain explanation and a way home, never a crash.
 */
export function withStaffPermission<Args extends unknown[]>(
  permission: Permission,
  Page: (...args: Args) => ReactNode | Promise<ReactNode>,
): (...args: Args) => Promise<ReactNode> {
  return async function StaffPage(...args: Args) {
    const session = await getRouteSession("internal");
    if (!staffMayUse(session.roles, permission))
      return <StaffRoleNotAvailable roles={session.roles} />;
    // Called rather than rendered, so the page is the same server component it
    // was before it was wrapped and starts no work for a refused reader.
    return Page(...args);
  };
}

export class StaffPermissionError extends Error {
  public constructor(public readonly permission: Permission) {
    // i18n-exempt: thrown to server actions, which word their own refusal; never rendered
    super("STAFF_PERMISSION_REQUIRED");
  }
}

/** The acting staff session, or a refusal when it lacks `permission`. */
export async function requireStaffPermission(
  permission: Permission,
): Promise<CommerceSession> {
  const session = await getCommerceSession();
  if (!session.isInternalStaff || !staffMayUse(session.roles, permission))
    throw new StaffPermissionError(permission);
  return session;
}
