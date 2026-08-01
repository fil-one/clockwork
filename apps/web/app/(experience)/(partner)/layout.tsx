import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteSession } from "@/src/features/shell/route-session";

export default async function PartnerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getRouteSession("partner");
  return (
    <RoutePermissionGate audience="partner" roles={session.roles}>
      <AppShell audience="partner" session={session}>
        {children}
      </AppShell>
    </RoutePermissionGate>
  );
}
