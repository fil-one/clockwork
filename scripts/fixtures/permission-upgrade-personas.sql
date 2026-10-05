-- One person in every role on every side, on top of the canonical seed, for
-- scripts/qualify-permission-upgrade.ts. Loaded BEFORE the permission-model
-- migrations (001445 onward), so it uses only the pre-upgrade schema: no
-- organizations.side, no membership_roles.
--
-- Organizations (seed): Northstar 30..01 (customer), Redwood 30..02 (referral
-- partner), Blue Harbor 30..04 (channel partner), Clockwork Staff 30..08
-- (Fil One). The seed already holds an owner, two partner administrators and
-- an operator; these add the rest.
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
  ('29450000-0000-4000-8000-000000000001','upgrade_customer_admin','admin@northstar.test','Casey Admin',false,true),
  ('29450000-0000-4000-8000-000000000002','upgrade_customer_billing','billing-user@northstar.test','Bailey Billing',false,true),
  ('29450000-0000-4000-8000-000000000003','upgrade_customer_member','member@northstar.test','Morgan Member',false,false),
  ('29450000-0000-4000-8000-000000000004','upgrade_referral_seller','seller@redwood.test','Sasha Referral Seller',false,false),
  ('29450000-0000-4000-8000-000000000005','upgrade_channel_seller','seller@blueharbor.test','Sam Channel Seller',false,false),
  ('29450000-0000-4000-8000-000000000006','upgrade_finance','finance@clockwork.test','Fran Finance',true,true),
  ('29450000-0000-4000-8000-000000000007','upgrade_legal','legal@clockwork.test','Lee Legal',true,true),
  ('29450000-0000-4000-8000-000000000008','upgrade_destructive','deletion@clockwork.test','Dana Deletion',true,true),
  ('29450000-0000-4000-8000-000000000009','upgrade_revenue','seller@clockwork.test','Rae Revenue',true,true),
  ('29450000-0000-4000-8000-000000000010','upgrade_commerce_admin','admin@clockwork.test','Ari Administrator',true,true);

insert into memberships (id, organization_id, user_id, role) values
  ('39450000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','29450000-0000-4000-8000-000000000001','admin'),
  ('39450000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','29450000-0000-4000-8000-000000000002','billing'),
  ('39450000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','29450000-0000-4000-8000-000000000003','member'),
  ('39450000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','29450000-0000-4000-8000-000000000004','partner_seller'),
  ('39450000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000004','29450000-0000-4000-8000-000000000005','partner_seller'),
  ('39450000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000006','finance_approver'),
  ('39450000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000007','legal_approver'),
  ('39450000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000008','destructive_action_approver'),
  ('39450000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000009','revenue'),
  ('39450000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000010','commerce_admin');
