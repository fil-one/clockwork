import { z } from "zod";

export const roles = [
  "owner",
  "admin",
  "billing",
  "member",
  "partner_admin",
  "partner_seller",
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
] as const;

export const RoleSchema = z.enum(roles);
export type Role = z.infer<typeof RoleSchema>;

export const permissions = [
  "account:read",
  "account:write",
  "agreement:read",
  "agreement:execute",
  "agreement:approve",
  "quote:read",
  "quote:write",
  "quote:approve",
  "order:read",
  "order:write",
  "billing:read",
  "billing:write",
  "billing:approve",
  "partner:portfolio:read",
  "partner:quote:write",
  "poc:manage",
  "report:read",
  "system:operate",
  "impersonation:assume",
  "destructive:request",
  "destructive:approve",
] as const;

export const PermissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof PermissionSchema>;

export const rolePermissions = {
  owner: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "billing:write",
    "poc:manage",
    "report:read",
    "destructive:request",
  ],
  admin: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "poc:manage",
    "report:read",
    "destructive:request",
  ],
  billing: [
    "account:read",
    "quote:read",
    "order:read",
    "billing:read",
    "billing:write",
    "report:read",
  ],
  member: [
    "account:read",
    "agreement:read",
    "quote:read",
    "order:read",
    "billing:read",
  ],
  partner_admin: [
    "account:read",
    "account:write",
    "agreement:read",
    "agreement:execute",
    "quote:read",
    "partner:quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "partner:portfolio:read",
    "poc:manage",
  ],
  partner_seller: [
    "account:read",
    "quote:read",
    "partner:quote:write",
    "order:read",
    "partner:portfolio:read",
  ],
  internal_operator: [
    "account:read",
    "account:write",
    "agreement:read",
    "quote:read",
    "quote:write",
    "order:read",
    "order:write",
    "billing:read",
    "partner:portfolio:read",
    "poc:manage",
    "report:read",
    "system:operate",
    "impersonation:assume",
    "destructive:request",
  ],
  finance_approver: [
    "account:read",
    "quote:read",
    "quote:approve",
    "billing:read",
    "billing:approve",
    "report:read",
  ],
  legal_approver: [
    "account:read",
    "agreement:read",
    "agreement:approve",
    "quote:read",
    "order:read",
  ],
  destructive_action_approver: [
    "account:read",
    "order:read",
    "system:operate",
    "destructive:approve",
  ],
} as const satisfies Record<Role, readonly Permission[]>;

export const privilegedRoles = [
  "owner",
  "admin",
  "partner_admin",
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
] as const satisfies readonly Role[];

export const internalRoles = [
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
] as const satisfies readonly Role[];

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}
