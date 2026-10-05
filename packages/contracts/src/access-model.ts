import {
  assistedSessionWithheldPermissions,
  inviteRoleCeilings,
  internalRoles,
  organizationSides,
  permissions,
  privilegedRoles,
  rolePermissions,
  roles,
  sideRoles,
  sideWithheldPermissions,
  type OrganizationSide,
  type Permission,
  type Role,
} from "./auth";

/**
 * Plain-English names and purposes for the access model, for the generated
 * access matrix. Identifiers never change; where a role name misdescribes the
 * role, the label says what it is.
 */
export const roleDescriptions = {
  owner: {
    label: "Customer owner",
    purpose:
      "Runs a customer account: users, agreements, quotes, orders and billing.",
  },
  admin: {
    label: "Customer administrator",
    purpose: "As the owner, except changing billing details.",
  },
  billing: {
    label: "Customer billing contact",
    purpose: "Pays invoices and keeps billing details current.",
  },
  member: {
    label: "Customer member",
    purpose: "Reads the account's agreements, quotes, orders and invoices.",
  },
  partner_admin: {
    label: "Partner administrator",
    purpose:
      "Runs a partner account: deals, end clients, partner orders and the partner's own billing.",
  },
  partner_seller: {
    label: "Partner seller",
    purpose: "Registers deals and prepares partner quotes.",
  },
  internal_operator: {
    label: "Fil One operator",
    purpose:
      "Works the operations queues, provisioning, recovery and assisted sessions.",
  },
  finance_approver: {
    label: "Fil One finance approver",
    purpose:
      "Decides pricing, credits, refunds and other money controls; sees only the finance records it decides.",
  },
  legal_approver: {
    label: "Fil One legal approver",
    purpose: "Decides agreements and contract approvals.",
  },
  destructive_action_approver: {
    label: "Fil One deletion approver",
    purpose: "Approves teardown, offboarding and other destructive actions.",
  },
  revenue: {
    label: "Fil One seller",
    purpose: "Sends MNDAs, prepares contracts and uses the sales references.",
  },
  commerce_admin: {
    label: "Fil One commerce administrator",
    purpose: "Every internal permission, plus staff and who signs for Fil One.",
  },
} as const satisfies Record<Role, { label: string; purpose: string }>;

export const permissionDescriptions = {
  "account:read": "See account details",
  "account:write": "Change account details, users and invitations",
  "agreement:read": "Read agreements",
  "agreement:execute": "Sign agreements for the account",
  "agreement:approve": "Approve agreements and legal terms",
  "quote:read": "Read quotes",
  "quote:write": "Prepare and change quotes",
  "quote:approve": "Approve pricing, price books and quote exceptions",
  "order:read": "Read orders",
  "order:write": "Place, change and renew orders",
  "billing:read": "Read invoices and billing",
  "billing:write": "Change billing details and pay",
  "billing:approve":
    "Approve credits, refunds, commissions and other money controls",
  "partner:portfolio:read": "Read partner portfolios",
  "partner:quote:write": "Prepare partner quotes for resale",
  "poc:manage": "Run proofs of concept",
  "report:read": "Read and export reports",
  "system:operate": "Use the platform tools",
  "impersonation:assume":
    "Start an assisted session in a customer or partner account",
  "destructive:request": "Ask for an account to be ended or deleted",
  "destructive:approve": "Approve teardown and deletion",
  "migration:execute": "Run migrations from legacy systems",
  "mnda:send": "Send MNDAs",
  "contract:read": "Read contracts",
  "contract:write": "Prepare contracts",
  "contract:approve": "Approve contracts",
  "signatory:manage": "Choose who signs for Fil One and where notices go",
  "sales:read": "Use the sales workspace and references",
  "collateral:manage": "Manage sales collateral",
  "operations:read": "Use the operations workspace",
  "operations:write": "Work the operations queues and records",
  "staff:manage": "Invite staff, change their roles and deactivate them",
  "audit:read": "Read the full activity history of reachable accounts",
  "audit:append": "Record activity beyond one's own finance decisions",
  "deal:register": "Register deals with Fil One",
} as const satisfies Record<Permission, string>;

export const sideDescriptions = {
  fil_one: "Fil One",
  customer: "Customer",
  channel_partner: "Channel partner (resale, MSP, distribution, marketplace)",
  referral_partner: "Referral partner",
} as const satisfies Record<OrganizationSide, string>;

/** The marker that identifies a generated permission-model migration. */
export const permissionModelMarker = "clockwork:generated-permission-model";

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

function valuesBlock(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `  (${row.map(sqlText).join(", ")})`).join(",\n");
}

/**
 * The SQL that mirrors the role table into the database, so stored-role checks
 * and the side guard read the same bundles the application does. Generated,
 * never hand-edited: `pnpm generate:access-model`.
 */
export function permissionModelSql(): string {
  const rolePermissionRows = roles.flatMap((role) =>
    (rolePermissions[role] as readonly Permission[]).map((permission) => [
      role,
      permission,
    ]),
  );
  const sideRoleRows = organizationSides.flatMap((side) =>
    (sideRoles[side] as readonly Role[]).map((role) => [side, role]),
  );
  const withheldRows = organizationSides.flatMap((side) =>
    (sideWithheldPermissions[side] as readonly Permission[]).map(
      (permission) => [side, permission],
    ),
  );
  const tables = [
    "role_permissions",
    "organization_side_roles",
    "organization_side_withheld_permissions",
  ];
  return `-- ${permissionModelMarker}
-- GENERATED from packages/contracts/src/auth.ts by
-- scripts/generate-access-model.ts. Do not edit by hand: change auth.ts, then
-- write the next migration with
--   pnpm generate:access-model --migration supabase/migrations/<next>.sql
-- A test fails while this file and auth.ts disagree.
--
-- role_permissions: the permissions each role confers.
-- organization_side_roles: the roles a member of an organization on each side
--   may hold.
-- organization_side_withheld_permissions: permissions a side never confers.

create table if not exists public.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);
create table if not exists public.organization_side_roles (
  side text not null,
  role text not null,
  primary key (side, role)
);
create table if not exists public.organization_side_withheld_permissions (
  side text not null,
  permission text not null,
  primary key (side, permission)
);

${tables
  .map(
    (table) => `alter table public.${table} enable row level security;
alter table public.${table} force row level security;
drop policy if exists ${table}_read on public.${table};
create policy ${table}_read on public.${table}
  for select to clockwork_runtime, clockwork_service using (true);
revoke all on public.${table} from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.${table} to clockwork_runtime, clockwork_service;`,
  )
  .join("\n\n")}

delete from public.role_permissions;
insert into public.role_permissions (role, permission) values
${valuesBlock(rolePermissionRows)};

delete from public.organization_side_roles;
insert into public.organization_side_roles (side, role) values
${valuesBlock(sideRoleRows)};

delete from public.organization_side_withheld_permissions;
${
  withheldRows.length
    ? `insert into public.organization_side_withheld_permissions (side, permission) values
${valuesBlock(withheldRows)};`
    : ""
}

comment on table public.role_permissions is
  'Generated from packages/contracts/src/auth.ts. The permissions each role confers.';
comment on table public.organization_side_roles is
  'Generated from packages/contracts/src/auth.ts. The roles a member of an organization on each side may hold.';
comment on table public.organization_side_withheld_permissions is
  'Generated from packages/contracts/src/auth.ts. Permissions an organization side never confers.';
`;
}

const mark = (value: boolean) => (value ? "x" : "");

/** Short column headers for the role matrix, in role order. */
const roleColumns = {
  owner: "own",
  admin: "adm",
  billing: "bil",
  member: "mem",
  partner_admin: "pAdm",
  partner_seller: "pSel",
  internal_operator: "op",
  finance_approver: "fin",
  legal_approver: "leg",
  destructive_action_approver: "dest",
  revenue: "rev",
  commerce_admin: "cAdm",
} as const satisfies Record<Role, string>;

/** Where a permission is enforced, for the matrix's last section. */
export interface PermissionEnforcement {
  readonly permission: Permission;
  readonly places: readonly string[];
}

/**
 * The access matrix as Markdown. Generated, never hand-edited:
 * `pnpm generate:access-model` writes docs/security/access-matrix.md and CI
 * fails while the file is stale.
 */
export function accessMatrixMarkdown(
  enforcement: readonly PermissionEnforcement[] = [],
): string {
  const header = `| Permission | ${roles.map((role) => roleColumns[role]).join(" | ")} |`;
  const divider = `|---|${roles.map(() => ":-:").join("|")}|`;
  const rows = permissions.map(
    (permission) =>
      `| \`${permission}\` | ${roles
        .map((role) =>
          mark(
            (rolePermissions[role] as readonly Permission[]).includes(
              permission,
            ),
          ),
        )
        .join(" | ")} |`,
  );
  const roleRows = roles.map((role) => {
    const sides = organizationSides.filter((side) =>
      (sideRoles[side] as readonly Role[]).includes(role),
    );
    return `| \`${role}\` (${roleColumns[role]}) | ${roleDescriptions[role].label} | ${sides
      .map((side) => sideDescriptions[side])
      .join(
        ", ",
      )} | ${mark((privilegedRoles as readonly Role[]).includes(role)) || "no"} | ${roleDescriptions[role].purpose} |`;
  });
  const sideRows = organizationSides.map((side) => {
    const withheld = sideWithheldPermissions[side] as readonly Permission[];
    return `| \`${side}\` | ${sideDescriptions[side]} | ${(
      sideRoles[side] as readonly Role[]
    )
      .map((role) => `\`${role}\``)
      .join(
        ", ",
      )} | ${withheld.length ? withheld.map((permission) => `\`${permission}\``).join(", ") : "none"} |`;
  });
  const inviteRows = roles.flatMap((role) => {
    const ceiling = inviteRoleCeilings[role];
    return ceiling
      ? [
          `| \`${role}\` | ${ceiling.map((invited) => `\`${invited}\``).join(", ")} |`,
        ]
      : [];
  });
  const permissionRows = permissions.map(
    (permission) =>
      `| \`${permission}\` | ${permissionDescriptions[permission]} |`,
  );
  const enforcementRows = enforcement.map(
    ({ permission, places }) =>
      `| \`${permission}\` | ${places.length ? places.join("<br>") : "not checked in application code"} |`,
  );
  return `# Access matrix

Generated from \`packages/contracts/src/auth.ts\` by
\`scripts/generate-access-model.ts\`. Do not edit by hand: run
\`pnpm generate:access-model\`. CI fails while this file is stale.

Roles are named bundles of permissions. Every check in the application and in
the database tests a permission; the database reads the same bundles from the
generated \`role_permissions\` table. A person may hold several roles; they hold
the union of the bundles, less what their organization's side withholds, and
an assisted session never carries the approver permissions
(${assistedSessionWithheldPermissions.map((permission) => `\`${permission}\``).join(", ")}).

## Roles

| Role | Name | Side | MFA required | Purpose |
|---|---|---|:-:|---|
${roleRows.join("\n")}

Internal (Fil One staff) roles: ${internalRoles.map((role) => `\`${role}\``).join(", ")}.

## Permissions by role

${header}
${divider}
${rows.join("\n")}

## Sides

| Side | Name | Roles its members may hold | Permissions it withholds |
|---|---|---|---|
${sideRows.join("\n")}

## Who may invite whom

A person may invite the roles any of their roles allows, and only roles their
organization's side may hold. Fil One staff are added on the Team page.

| Inviter | May invite |
|---|---|
${inviteRows.join("\n")}

## Permissions

| Permission | Meaning |
|---|---|
${permissionRows.join("\n")}
${
  enforcementRows.length
    ? `
## Where each permission is checked

Application call sites that name the permission (pages, server actions, API
routes and navigation). Database policies are listed in the migrations.

| Permission | Checked in |
|---|---|
${enforcementRows.join("\n")}
`
    : ""
}`;
}
