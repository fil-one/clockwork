"use client";

import { createContext, type ReactNode } from "react";

import type { Permission } from "@clockwork/contracts";

/**
 * Empty by default so a client surface rendered outside the provider is denied
 * rather than handed the permissions of a privileged session.
 */
const PermissionContext = createContext<readonly Permission[]>([]);

export function PermissionSessionProvider({
  permissions,
  children,
}: {
  permissions: readonly Permission[];
  children: ReactNode;
}) {
  return (
    <PermissionContext.Provider value={permissions}>
      {children}
    </PermissionContext.Provider>
  );
}
