import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function PartnerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await getRouteRoles("partner");
  return (
    <RoutePermissionGate audience="partner" roles={roles}>
      <AppShell audience="partner">{children}</AppShell>
    </RoutePermissionGate>
  );
}
