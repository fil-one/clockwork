import {
  hasPermission,
  roles,
  type Permission,
  type Role,
} from "@clockwork/contracts";

export function canAccessCustomerCollection(
  role: string,
  permission: Permission,
): boolean {
  return (
    (roles as readonly string[]).includes(role) &&
    hasPermission(role as Role, permission)
  );
}
