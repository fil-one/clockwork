import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { AssistedSessionBanner } from "@/src/features/internal-ops/assisted-session/assisted-session-banner";

export default async function InternalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await getRouteRoles("internal");
  return (
    <RoutePermissionGate audience="internal" roles={roles}>
      <AppShell audience="internal">
        <AssistedSessionBanner />
        {children}
      </AppShell>
    </RoutePermissionGate>
  );
}
