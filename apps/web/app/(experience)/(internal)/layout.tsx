import type { ReactNode } from "react";

import { AppShell } from "@/src/features/shell/app-shell";
import { AssistedSessionBanner } from "@/src/features/internal-ops/assisted-session/assisted-session-banner";
import { RoutePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteSession } from "@/src/features/shell/route-session";

export default async function InternalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getRouteSession("internal");
  return (
    <RoutePermissionGate audience="internal" roles={session.roles}>
      <AppShell audience="internal" session={session}>
        {session.assistedSession ? (
          <AssistedSessionBanner
            session={session.assistedSession}
            providerManaged={session.assistedSessionProvider === "workos"}
          />
        ) : null}
        {children}
      </AppShell>
    </RoutePermissionGate>
  );
}
