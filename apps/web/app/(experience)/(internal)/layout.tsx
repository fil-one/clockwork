import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function InternalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await getRouteRoles("internal");
  return (
    <RoutePermissionGate audience="internal" roles={roles}>
      <AppShell audience="internal" roles={roles}>
        {children}
      </AppShell>
    </RoutePermissionGate>
  );
}
