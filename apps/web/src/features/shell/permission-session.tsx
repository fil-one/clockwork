"use client";

import { createContext, type ReactNode } from "react";

/**
 * Empty by default so a client surface rendered outside the provider is denied
 * rather than handed the roles of a privileged session.
 */
export const RoleContext = createContext<readonly string[]>([]);

export function PermissionSessionProvider({
  roles,
  children,
}: {
  roles: readonly string[];
  children: ReactNode;
}) {
  return <RoleContext.Provider value={roles}>{children}</RoleContext.Provider>;
}
