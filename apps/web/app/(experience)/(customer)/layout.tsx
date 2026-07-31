import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function CustomerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await getRouteRoles("customer");
  return (
    <RoutePermissionGate audience="customer" roles={roles}>
      <AppShell audience="customer">{children}</AppShell>
    </RoutePermissionGate>
  );
}
