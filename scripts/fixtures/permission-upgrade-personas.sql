-- One person in every role on every side, and a row in every table whose
-- policies the upgrade rewrites, on top of the canonical seed, for
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

-- Shapes the side backfill must handle on real data without stopping:
--   * a memberless POC organization (every POC creates one; a WorkOS
--     membership delete can leave others),
--   * a memberless organization bound to the production Fil One WorkOS
--     organization,
--   * a stray customer `member` row in the Fil One staff organization (a
--     side conflict, resolved to fil_one and grandfathered),
--   * a partner account with no agreement type (a channel partner, so it
--     keeps partner quoting).
insert into accounts (id, legal_name, relationship_roles, registered_address,
  billing_contact, ap_contact, invoice_delivery_email, domain, country, currency,
  screening_status, partner_agreement_type)
values
  ('19450000-0000-4000-8000-000000000001','Fil One Production Staff',array['direct_client'],
   '{"line1":"1 Main St","city":"Wilmington","postalCode":"19801","country":"US"}',
   '{"name":"Billing","email":"billing@fil-one-prod.test"}','{"name":"AP","email":"ap@fil-one-prod.test"}',
   'billing@fil-one-prod.test','fil-one-prod.test','US','USD','clear',null),
  ('19450000-0000-4000-8000-000000000002','Untyped Partner Co',array['partner'],
   '{"line1":"2 Main St","city":"Austin","postalCode":"78701","country":"US"}',
   '{"name":"Billing","email":"billing@untyped.test"}','{"name":"AP","email":"ap@untyped.test"}',
   'billing@untyped.test','untyped.test','US','USD','clear',null);

insert into organizations (id, account_id, name, isolated, workos_organization_id) values
  ('39450000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-000000000004','POC upgrade rehearsal',true,null),
  ('39450000-0000-4000-8000-0000000000a2','19450000-0000-4000-8000-000000000001','Fil One LLC',false,'org_01M21RDQDM5NHYD4CEHWJZFG3J'),
  ('39450000-0000-4000-8000-0000000000a3','19450000-0000-4000-8000-000000000002','Untyped Partner',false,'org_upgrade_untyped');

insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
  ('29450000-0000-4000-8000-000000000011','upgrade_stray_member','stray@clockwork.test','Stray Member',false,false),
  ('29450000-0000-4000-8000-000000000012','upgrade_untyped_admin','admin@untyped.test','Una Untyped',false,true);

insert into memberships (id, organization_id, user_id, role) values
  ('39450000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000008','29450000-0000-4000-8000-000000000011','member'),
  ('39450000-0000-4000-8000-000000000012','39450000-0000-4000-8000-0000000000a3','29450000-0000-4000-8000-000000000012','partner_admin');

-- At least one row in every table whose row policies 001447 rewrites, so the
-- rehearsal compares real rows. Ids start 49450000. Where a policy separates
-- audiences, accounts or channels, there is a row on each side of the line.

-- The seeded upgrade amendment (82..01, one more unit at 7500 from
-- 2026-07-01) lands as money: 183 of the term's 364 days remain, so the
-- supersession bills 7500 x 183 / 364 = 3770.6, rounded away from zero.
insert into core_amendment_financial_terms (amendment_id, contractual_time_zone,
  proration_convention, period_starts_on, period_ends_on, billable_numerator,
  billable_denominator, currency, forecast_delta_minor, monthly_delta_minor)
values ('82000000-0000-4000-8000-000000000001','UTC','actual_actual',
  '2026-01-01','2026-12-31',183,364,'USD',3771,625);
insert into core_amendment_line_supersessions (id, amendment_id,
  superseded_order_line_id, replacement_snapshot, effective_on,
  net_quantity_delta, net_revenue_delta_minor)
values ('49450000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001','{}','2026-07-01',1,3771);

-- Collections on a customer invoice (owned by the finance approver) and on a
-- channel partner's invoice (owned by the operator).
insert into core_collection_cases (id, invoice_id, account_id, owner_user_id,
  aging_bucket, next_action_at, status)
values
  ('49450000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001','29450000-0000-4000-8000-000000000006',
   '1_30','2026-11-01T16:00:00Z','open'),
  ('49450000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',
   '31_60','2026-11-02T16:00:00Z','promised');
insert into core_collection_actions (id, collection_case_id, action,
  actor_user_id, outcome, occurred_at)
values
  ('49450000-0000-4000-8000-000000000004','49450000-0000-4000-8000-000000000002',
   'email_reminder','29450000-0000-4000-8000-000000000006','sent','2026-10-01T16:00:00Z'),
  ('49450000-0000-4000-8000-000000000005','49450000-0000-4000-8000-000000000003',
   'call','20000000-0000-4000-8000-000000000001','promise_to_pay','2026-10-02T16:00:00Z');

insert into core_partner_transfer_tiers (id, rate_card_id, agreement_type, tier,
  transfer_price_minor, floor_price_minor, effective_from)
values ('49450000-0000-4000-8000-000000000006','61000000-0000-4000-8000-000000000001',
  'resale','standard',10000,8000,'2026-01-01');

insert into core_price_book_activation_events (id, price_book_id, action,
  previous_status, resulting_status, effective_at, actor_user_id, reason, request_id)
values ('49450000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000001',
  'activate','draft','active','2026-01-01T00:00:00Z',
  '29450000-0000-4000-8000-000000000006','upgrade rehearsal','permission-upgrade:activation');

-- Snapshots of a direct quote, the referral partner's quote and the channel
-- partner's quote.
insert into core_quote_snapshots (id, quote_id, revision, snapshot, snapshot_hash,
  issued_at, created_by)
select fixture.id::uuid, q.id, q.revision,
  jsonb_build_object('currency', q.currency, 'totalMinor', q.total_minor::text),
  encode(sha256(convert_to(fixture.id, 'UTF8')), 'hex'), '2026-07-20T16:00:00Z',
  '20000000-0000-4000-8000-000000000001'
from (values
  ('49450000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000001'),
  ('49450000-0000-4000-8000-000000000009','70000000-0000-4000-8000-000000000002'),
  ('49450000-0000-4000-8000-000000000010','70000000-0000-4000-8000-000000000003')
) fixture(id, quote_id)
join quotes q on q.id = fixture.quote_id::uuid;

-- Adjustments on a customer's invoice, a channel partner's invoice and an end
-- client's payment.
insert into credit_notes (id, invoice_id, order_id, stripe_credit_note_id,
  currency, amount_minor, reason_code, approved_by, status)
values
  ('49450000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001','cn_upgrade_rehearsal_1','USD',1000,
   'commercial_correction','29450000-0000-4000-8000-000000000006','issued'),
  ('49450000-0000-4000-8000-000000000012','90000000-0000-4000-8000-000000000003',
   '80000000-0000-4000-8000-000000000003','cn_upgrade_rehearsal_2','EUR',1000,
   'commercial_correction','29450000-0000-4000-8000-000000000006','issued');
insert into refunds (id, payment_id, order_id, stripe_refund_id, currency,
  amount_minor, reason_code, status)
values
  ('49450000-0000-4000-8000-000000000013','91000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001','re_upgrade_rehearsal_1','USD',500,
   'customer_request','succeeded'),
  ('49450000-0000-4000-8000-000000000014','91000000-0000-4000-8000-000000000002',
   '80000000-0000-4000-8000-000000000002','re_upgrade_rehearsal_2','USD',500,
   'customer_request','succeeded');

-- Rendered documents for a customer, a channel partner and Fil One staff.
insert into experience_document_render_requests (id, account_id, audience,
  audience_account_id, subject_type, subject_id, document_kind, input,
  source_hash, requested_by, retain_until, status, source_version)
values
  ('49450000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000001','customer',
   '10000000-0000-4000-8000-000000000001','quote','70000000-0000-4000-8000-000000000001',
   'direct_quote','{}',encode(sha256('render customer'::bytea),'hex'),
   '20000000-0000-4000-8000-000000000002','2099-01-01T00:00:00Z','stored','v1'),
  ('49450000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000004','partner',
   '10000000-0000-4000-8000-000000000003','quote','70000000-0000-4000-8000-000000000003',
   'partner_resale_quote','{}',encode(sha256('render partner'::bytea),'hex'),
   '20000000-0000-4000-8000-000000000008','2099-01-01T00:00:00Z','stored','v1'),
  ('49450000-0000-4000-8000-000000000017',null,'internal',null,'report_export',
   '49450000-0000-4000-8000-000000000031','report_export','{}',
   encode(sha256('render internal'::bytea),'hex'),
   '20000000-0000-4000-8000-000000000001','2099-01-01T00:00:00Z','stored','v1');
insert into experience_artifact_deliveries (id, render_request_id, account_id,
  audience, audience_account_id, subject_type, subject_id, document_kind,
  document_id, immutable_version, source_hash, content_hash, storage_version_id,
  mime_type, byte_length, filename, retain_until)
select fixture.id::uuid, request.id, request.account_id, request.audience,
  request.audience_account_id, request.subject_type, request.subject_id,
  request.document_kind, fixture.document_id::uuid, 'v1', request.source_hash,
  encode(sha256(convert_to(fixture.id, 'UTF8')), 'hex'), 'version-1',
  'application/pdf', 1024, fixture.filename, request.retain_until
from (values
  ('49450000-0000-4000-8000-000000000018','49450000-0000-4000-8000-000000000015',
   '40000000-0000-4000-8000-000000000003','northstar-quote.pdf'),
  ('49450000-0000-4000-8000-000000000019','49450000-0000-4000-8000-000000000016',
   '40000000-0000-4000-8000-000000000014','blue-harbor-quote.pdf'),
  ('49450000-0000-4000-8000-000000000020','49450000-0000-4000-8000-000000000017',
   '40000000-0000-4000-8000-000000000040','report-export.pdf')
) fixture(id, render_request_id, document_id, filename)
join experience_document_render_requests request
  on request.id = fixture.render_request_id::uuid;

-- Evidence uploads: a customer's own, and staff uploads for Northstar on the
-- exception journey (operator) and the approval journey (legal approver and
-- commerce administrator).
insert into experience_evidence_uploads (id, public_upload_id, idempotency_key,
  owner_user_id, account_id, organization_id, journey, target_id, evidence_kind,
  declared_content_hash, declared_mime_type, declared_byte_length, retain_until,
  expires_at)
select fixture.id::uuid, 'upl_upgrade_rehearsal_' || right(fixture.id, 4),
  'upgrade-rehearsal-' || fixture.id, fixture.owner::uuid,
  '10000000-0000-4000-8000-000000000001', fixture.organization::uuid,
  fixture.journey, '70000000-0000-4000-8000-000000000001', fixture.kind,
  encode(sha256(convert_to(fixture.id, 'UTF8')), 'hex'), 'application/pdf', 2048,
  '2099-06-01T00:00:00Z', '2099-01-01T00:00:00Z'
from (values
  ('49450000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000001','customer_paper','agreement'),
  ('49450000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000001',
   null,'exception','notice'),
  ('49450000-0000-4000-8000-000000000023','29450000-0000-4000-8000-000000000007',
   null,'approval','approval'),
  ('49450000-0000-4000-8000-000000000024','29450000-0000-4000-8000-000000000010',
   null,'approval','approval')
) fixture(id, owner, organization, journey, kind);

-- Portal rows: partner billing (a restricted channel) for the referral and
-- the channel partner, a channel partner's unrestricted row, a customer row,
-- and staff rows in the approvals queue and in operations.
insert into experience_portal_projections (id, audience, audience_account_id,
  subject_account_id, channel, record_key, aggregate_type, aggregate_id, payload,
  source_hash, source_updated_at, source_aggregate_version)
select fixture.id::uuid, fixture.audience, fixture.audience_account::uuid,
  fixture.subject_account::uuid, fixture.channel, 'upgrade-rehearsal:' || fixture.id,
  fixture.aggregate_type, fixture.aggregate_id::uuid, '{}',
  encode(sha256(convert_to(fixture.id, 'UTF8')), 'hex'), '2026-10-01T16:00:00Z', 1
from (values
  ('49450000-0000-4000-8000-000000000025','partner','10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000004','billing','invoice','90000000-0000-4000-8000-000000000002'),
  ('49450000-0000-4000-8000-000000000026','partner','10000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000004','billing','invoice','90000000-0000-4000-8000-000000000003'),
  ('49450000-0000-4000-8000-000000000027','partner','10000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000004','quotes','quote','70000000-0000-4000-8000-000000000003'),
  ('49450000-0000-4000-8000-000000000028','customer','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001','invoices','invoice','90000000-0000-4000-8000-000000000001'),
  ('49450000-0000-4000-8000-000000000029','internal',null,
   '10000000-0000-4000-8000-000000000001','approvals','quote','70000000-0000-4000-8000-000000000001'),
  ('49450000-0000-4000-8000-000000000030','internal',null,
   '10000000-0000-4000-8000-000000000001','operations','order','80000000-0000-4000-8000-000000000001')
) fixture(id, audience, audience_account, subject_account, channel, aggregate_type, aggregate_id);

insert into report_exports (id, requested_by, report, parameters, status) values
  ('49450000-0000-4000-8000-000000000031','29450000-0000-4000-8000-000000000006',
   'revenue','{}','complete'),
  ('49450000-0000-4000-8000-000000000032','20000000-0000-4000-8000-000000000002',
   'invoices','{}','pending');

-- Pending invitations into a customer, a partner and the staff organization.
insert into invites (id, organization_id, email, role, token_hash, expires_at) values
  ('49450000-0000-4000-8000-000000000033','30000000-0000-4000-8000-000000000001',
   'invitee@northstar.test','member',encode(sha256('invite customer'::bytea),'hex'),
   '2099-01-01T00:00:00Z'),
  ('49450000-0000-4000-8000-000000000034','30000000-0000-4000-8000-000000000002',
   'invitee@redwood.test','partner_seller',encode(sha256('invite partner'::bytea),'hex'),
   '2099-01-01T00:00:00Z'),
  ('49450000-0000-4000-8000-000000000035','30000000-0000-4000-8000-000000000008',
   'invitee@clockwork.test','internal_operator',encode(sha256('invite staff'::bytea),'hex'),
   '2099-01-01T00:00:00Z');

-- A direct customer's procurement profile and an end client's (which its
-- partners read through their portfolio).
insert into procurement_profiles (id, account_id, po_required) values
  ('49450000-0000-4000-8000-000000000036','10000000-0000-4000-8000-000000000001',true),
  ('49450000-0000-4000-8000-000000000037','10000000-0000-4000-8000-000000000004',false);
