-- clockwork:generated-permission-model
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

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
drop policy if exists role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions
  for select to clockwork_runtime, clockwork_service using (true);
revoke all on public.role_permissions from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.role_permissions to clockwork_runtime, clockwork_service;

alter table public.organization_side_roles enable row level security;
alter table public.organization_side_roles force row level security;
drop policy if exists organization_side_roles_read on public.organization_side_roles;
create policy organization_side_roles_read on public.organization_side_roles
  for select to clockwork_runtime, clockwork_service using (true);
revoke all on public.organization_side_roles from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.organization_side_roles to clockwork_runtime, clockwork_service;

alter table public.organization_side_withheld_permissions enable row level security;
alter table public.organization_side_withheld_permissions force row level security;
drop policy if exists organization_side_withheld_permissions_read on public.organization_side_withheld_permissions;
create policy organization_side_withheld_permissions_read on public.organization_side_withheld_permissions
  for select to clockwork_runtime, clockwork_service using (true);
revoke all on public.organization_side_withheld_permissions from public, anon, authenticated, clockwork_runtime, clockwork_service;
grant select on public.organization_side_withheld_permissions to clockwork_runtime, clockwork_service;

delete from public.role_permissions;
insert into public.role_permissions (role, permission) values
  ('owner', 'account:read'),
  ('owner', 'account:write'),
  ('owner', 'agreement:read'),
  ('owner', 'agreement:execute'),
  ('owner', 'quote:read'),
  ('owner', 'quote:write'),
  ('owner', 'order:read'),
  ('owner', 'order:write'),
  ('owner', 'billing:read'),
  ('owner', 'billing:write'),
  ('owner', 'poc:manage'),
  ('owner', 'report:read'),
  ('owner', 'destructive:request'),
  ('owner', 'audit:read'),
  ('owner', 'audit:append'),
  ('admin', 'account:read'),
  ('admin', 'account:write'),
  ('admin', 'agreement:read'),
  ('admin', 'agreement:execute'),
  ('admin', 'quote:read'),
  ('admin', 'quote:write'),
  ('admin', 'order:read'),
  ('admin', 'order:write'),
  ('admin', 'billing:read'),
  ('admin', 'poc:manage'),
  ('admin', 'report:read'),
  ('admin', 'destructive:request'),
  ('admin', 'audit:read'),
  ('admin', 'audit:append'),
  ('billing', 'account:read'),
  ('billing', 'quote:read'),
  ('billing', 'order:read'),
  ('billing', 'billing:read'),
  ('billing', 'billing:write'),
  ('billing', 'report:read'),
  ('billing', 'audit:read'),
  ('billing', 'audit:append'),
  ('member', 'account:read'),
  ('member', 'agreement:read'),
  ('member', 'quote:read'),
  ('member', 'order:read'),
  ('member', 'billing:read'),
  ('member', 'audit:read'),
  ('member', 'audit:append'),
  ('partner_admin', 'account:read'),
  ('partner_admin', 'account:write'),
  ('partner_admin', 'agreement:read'),
  ('partner_admin', 'agreement:execute'),
  ('partner_admin', 'quote:read'),
  ('partner_admin', 'partner:quote:write'),
  ('partner_admin', 'order:read'),
  ('partner_admin', 'order:write'),
  ('partner_admin', 'billing:read'),
  ('partner_admin', 'partner:portfolio:read'),
  ('partner_admin', 'poc:manage'),
  ('partner_admin', 'deal:register'),
  ('partner_admin', 'audit:read'),
  ('partner_admin', 'audit:append'),
  ('partner_seller', 'account:read'),
  ('partner_seller', 'quote:read'),
  ('partner_seller', 'partner:quote:write'),
  ('partner_seller', 'order:read'),
  ('partner_seller', 'partner:portfolio:read'),
  ('partner_seller', 'deal:register'),
  ('partner_seller', 'audit:read'),
  ('partner_seller', 'audit:append'),
  ('internal_operator', 'account:read'),
  ('internal_operator', 'account:write'),
  ('internal_operator', 'agreement:read'),
  ('internal_operator', 'quote:read'),
  ('internal_operator', 'quote:write'),
  ('internal_operator', 'order:read'),
  ('internal_operator', 'order:write'),
  ('internal_operator', 'billing:read'),
  ('internal_operator', 'partner:portfolio:read'),
  ('internal_operator', 'poc:manage'),
  ('internal_operator', 'report:read'),
  ('internal_operator', 'system:operate'),
  ('internal_operator', 'impersonation:assume'),
  ('internal_operator', 'destructive:request'),
  ('internal_operator', 'migration:execute'),
  ('internal_operator', 'mnda:send'),
  ('internal_operator', 'contract:read'),
  ('internal_operator', 'contract:write'),
  ('internal_operator', 'sales:read'),
  ('internal_operator', 'operations:read'),
  ('internal_operator', 'operations:write'),
  ('internal_operator', 'audit:read'),
  ('internal_operator', 'audit:append'),
  ('finance_approver', 'account:read'),
  ('finance_approver', 'quote:read'),
  ('finance_approver', 'quote:approve'),
  ('finance_approver', 'billing:read'),
  ('finance_approver', 'billing:approve'),
  ('finance_approver', 'report:read'),
  ('finance_approver', 'mnda:send'),
  ('finance_approver', 'contract:read'),
  ('finance_approver', 'contract:approve'),
  ('finance_approver', 'sales:read'),
  ('finance_approver', 'operations:read'),
  ('legal_approver', 'account:read'),
  ('legal_approver', 'agreement:read'),
  ('legal_approver', 'agreement:approve'),
  ('legal_approver', 'quote:read'),
  ('legal_approver', 'order:read'),
  ('legal_approver', 'mnda:send'),
  ('legal_approver', 'contract:read'),
  ('legal_approver', 'contract:write'),
  ('legal_approver', 'contract:approve'),
  ('legal_approver', 'sales:read'),
  ('legal_approver', 'operations:read'),
  ('legal_approver', 'audit:read'),
  ('legal_approver', 'audit:append'),
  ('destructive_action_approver', 'account:read'),
  ('destructive_action_approver', 'order:read'),
  ('destructive_action_approver', 'system:operate'),
  ('destructive_action_approver', 'destructive:approve'),
  ('destructive_action_approver', 'operations:read'),
  ('destructive_action_approver', 'audit:read'),
  ('destructive_action_approver', 'audit:append'),
  ('revenue', 'mnda:send'),
  ('revenue', 'contract:read'),
  ('revenue', 'contract:write'),
  ('revenue', 'sales:read'),
  ('revenue', 'audit:read'),
  ('revenue', 'audit:append'),
  ('commerce_admin', 'account:read'),
  ('commerce_admin', 'account:write'),
  ('commerce_admin', 'agreement:read'),
  ('commerce_admin', 'agreement:execute'),
  ('commerce_admin', 'agreement:approve'),
  ('commerce_admin', 'quote:read'),
  ('commerce_admin', 'quote:write'),
  ('commerce_admin', 'quote:approve'),
  ('commerce_admin', 'order:read'),
  ('commerce_admin', 'order:write'),
  ('commerce_admin', 'billing:read'),
  ('commerce_admin', 'billing:write'),
  ('commerce_admin', 'billing:approve'),
  ('commerce_admin', 'partner:portfolio:read'),
  ('commerce_admin', 'poc:manage'),
  ('commerce_admin', 'report:read'),
  ('commerce_admin', 'system:operate'),
  ('commerce_admin', 'impersonation:assume'),
  ('commerce_admin', 'destructive:request'),
  ('commerce_admin', 'destructive:approve'),
  ('commerce_admin', 'migration:execute'),
  ('commerce_admin', 'mnda:send'),
  ('commerce_admin', 'contract:read'),
  ('commerce_admin', 'contract:write'),
  ('commerce_admin', 'contract:approve'),
  ('commerce_admin', 'signatory:manage'),
  ('commerce_admin', 'sales:read'),
  ('commerce_admin', 'collateral:manage'),
  ('commerce_admin', 'operations:read'),
  ('commerce_admin', 'staff:manage'),
  ('commerce_admin', 'operations:write'),
  ('commerce_admin', 'audit:read'),
  ('commerce_admin', 'audit:append');

delete from public.organization_side_roles;
insert into public.organization_side_roles (side, role) values
  ('fil_one', 'internal_operator'),
  ('fil_one', 'finance_approver'),
  ('fil_one', 'legal_approver'),
  ('fil_one', 'destructive_action_approver'),
  ('fil_one', 'revenue'),
  ('fil_one', 'commerce_admin'),
  ('customer', 'owner'),
  ('customer', 'admin'),
  ('customer', 'billing'),
  ('customer', 'member'),
  ('channel_partner', 'partner_admin'),
  ('channel_partner', 'partner_seller'),
  ('referral_partner', 'partner_admin'),
  ('referral_partner', 'partner_seller');

delete from public.organization_side_withheld_permissions;
insert into public.organization_side_withheld_permissions (side, permission) values
  ('referral_partner', 'partner:quote:write');

comment on table public.role_permissions is
  'Generated from packages/contracts/src/auth.ts. The permissions each role confers.';
comment on table public.organization_side_roles is
  'Generated from packages/contracts/src/auth.ts. The roles a member of an organization on each side may hold.';
comment on table public.organization_side_withheld_permissions is
  'Generated from packages/contracts/src/auth.ts. Permissions an organization side never confers.';
