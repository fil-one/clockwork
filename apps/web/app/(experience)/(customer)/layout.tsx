import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteSession } from "@/src/features/shell/route-session";

export default async function CustomerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getRouteSession("customer");
  return (
    <RoutePermissionGate audience="customer" roles={session.roles}>
      <AppShell audience="customer" session={session}>
        {children}
      </AppShell>
    </RoutePermissionGate>
  );
}
