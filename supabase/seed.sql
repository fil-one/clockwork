-- Deterministic fictional demo at 2026-07-31T16:00:00Z. Reset with `pnpm db:reset`.
insert into private.authorization_secrets (id, secret, active)
values ('local', 'clockwork-local-auth-context-secret-change-me', true)
on conflict (id) do update set secret = excluded.secret, active = true, rotated_at = now();
set role clockwork_service;

insert into accounts (
  id, legal_name, relationship_roles, registered_address, billing_contact, ap_contact,
  invoice_delivery_email, domain, country, currency, screening_status,
  parent_partner_id, partner_agreement_type, partner_discount_tier, commission_rate_bps, commission_holdback_bps, aggregate_credit_limit_minor
) values
('10000000-0000-4000-8000-000000000001','Northstar Archive Labs',array['direct_client'], '{"line1":"1 Fiction Way","city":"Boston","postalCode":"02108","country":"US"}', '{"name":"Dana Direct","email":"billing@northstar.test"}', '{"name":"Alex AP","email":"ap@northstar.test"}', 'ap@northstar.test','northstar.test','US','USD','clear',null,null,null,null,null,0),
('10000000-0000-4000-8000-000000000002','Redwood Channel Group',array['partner'], '{"line1":"2 Fiction Way","city":"London","postalCode":"EC1A 1AA","country":"GB"}', '{"name":"Riley Referral","email":"billing@redwood.test"}', '{"name":"Parker AP","email":"ap@redwood.test"}', 'ap@redwood.test','redwood.test','GB','GBP','clear',null,'referral','gold',1200,1000,5000000),
('10000000-0000-4000-8000-000000000003','Blue Harbor MSP',array['partner'], '{"line1":"3 Fiction Way","city":"Madrid","postalCode":"28001","country":"ES"}', '{"name":"Morgan MSP","email":"billing@blueharbor.test"}', '{"name":"Sam AP","email":"ap@blueharbor.test"}', 'ap@blueharbor.test','blueharbor.test','ES','EUR','clear',null,'resale','silver',null,null,10000000),
('10000000-0000-4000-8000-000000000004','Juniper Health Demo',array['end_client'], '{"line1":"4 Fiction Way","city":"Denver","postalCode":"80202","country":"US"}', '{"name":"Jamie Client","email":"billing@juniper.test"}', '{"name":"Taylor AP","email":"ap@juniper.test"}', 'ap@juniper.test','juniper.test','US','USD','clear',null,null,null,null,null,0),
('10000000-0000-4000-8000-000000000005','Atlas Distribution Demo',array['partner'], '{"line1":"5 Fiction Way","city":"Chicago","postalCode":"60601","country":"US"}', '{"name":"Drew Distributor","email":"billing@atlas.test"}', '{"name":"Casey AP","email":"ap@atlas.test"}', 'ap@atlas.test','atlas.test','US','USD','clear',null,'resale','distributor',null,null,25000000),
('10000000-0000-4000-8000-000000000006','Cobalt Reseller Demo',array['partner'], '{"line1":"6 Fiction Way","city":"Austin","postalCode":"78701","country":"US"}', '{"name":"Avery Seller","email":"billing@cobalt.test"}', '{"name":"Finley AP","email":"ap@cobalt.test"}', 'ap@cobalt.test','cobalt.test','US','USD','clear','10000000-0000-4000-8000-000000000005','resale','two-tier',null,null,3000000),
('10000000-0000-4000-8000-000000000007','Ivory Embedded Demo',array['partner'], '{"line1":"7 Fiction Way","city":"Seattle","postalCode":"98101","country":"US"}', '{"name":"Robin White Label","email":"billing@ivory.test"}', '{"name":"Skyler AP","email":"ap@ivory.test"}', 'ap@ivory.test','ivory.test','US','USD','clear',null,'embedded','white-label',null,null,5000000),
('10000000-0000-4000-8000-000000000008','Mercury Marketplace Demo',array['partner'], '{"line1":"8 Fiction Way","city":"New York","postalCode":"10001","country":"US"}', '{"name":"Quinn Market","email":"billing@mercury.test"}', '{"name":"Emerson AP","email":"ap@mercury.test"}', 'ap@mercury.test','mercury.test','US','USD','clear',null,'resale','marketplace',null,null,8000000),
('10000000-0000-4000-8000-000000000009','Clockwork Internal Operations',array['direct_client'], '{"line1":"9 Fiction Way","city":"Wilmington","postalCode":"19801","country":"US"}', '{"name":"Internal Operations","email":"operations@clockwork.test"}', '{"name":"Internal Finance","email":"finance@clockwork.test"}', 'finance@clockwork.test','clockwork.test','US','USD','clear',null,null,null,null,null,0);

update accounts
set stripe_customer_id = 'cus_demo_' || replace(id::text, '-', '')
where id between '10000000-0000-4000-8000-000000000001'::uuid
  and '10000000-0000-4000-8000-000000000009'::uuid;

insert into core_billing_policies (
  account_id, collection_method, payment_rail, terms_days,
  consolidate_partner_invoices, dunning_policy_version, require_po, require_vendor_setup
) values
('10000000-0000-4000-8000-000000000001','net_terms','wire',30,false,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000002','net_terms','bacs',30,true,'demo-v1',false,false),
('10000000-0000-4000-8000-000000000003','net_terms','sepa_credit',30,true,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000004','auto_charge','card',null,false,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000005','net_terms','wire',30,true,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000006','net_terms','wire',30,true,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000007','net_terms','wire',30,true,'demo-v1',true,false),
('10000000-0000-4000-8000-000000000008','prepay','marketplace',null,true,'demo-v1',true,false);

-- Persisted commercial profiles are authoritative acceptance inputs, not
-- values synthesized by the command path. Credit limits remain exactly the
-- account limits above; zero-limit net-terms accounts stay unapproved.
insert into core_account_commercial_profiles(
  account_id, legal_entity_fingerprint, billing_model, payment_terms_days,
  credit_status, approved_credit_limit_minor, current_exposure_minor,
  new_service_blocked
)
select
  account_record.id,
  encode(extensions.digest(
    account_record.id::text || '|' || account_record.legal_name || '|'
      || account_record.country || '|' || account_record.currency,
    'sha256'
  ), 'hex'),
  policy.collection_method,
  policy.terms_days,
  case
    when policy.collection_method = 'net_terms'
      and account_record.aggregate_credit_limit_minor > 0 then 'approved'
    else 'not_requested'
  end,
  account_record.aggregate_credit_limit_minor,
  0,
  false
from accounts account_record
join core_billing_policies policy on policy.account_id = account_record.id;

insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled) values
('20000000-0000-4000-8000-000000000001','local_internal_operator','operator@clockwork.test','Iris Operator',true,true),
('20000000-0000-4000-8000-000000000002','local_direct_owner','owner@northstar.test','Dana Direct',false,true),
('20000000-0000-4000-8000-000000000003','local_partner_admin','admin@redwood.test','Riley Referral',false,true),
('20000000-0000-4000-8000-000000000004','local_end_client_owner','owner@juniper.test','Jamie Client',false,true),
('20000000-0000-4000-8000-000000000005','local_distributor_admin','admin@atlas.test','Drew Distributor',false,true),
('20000000-0000-4000-8000-000000000006','local_white_label_admin','admin@ivory.test','Robin White Label',false,true),
('20000000-0000-4000-8000-000000000007','local_marketplace_admin','admin@mercury.test','Quinn Market',false,true),
('20000000-0000-4000-8000-000000000008','local_reseller_admin','admin@blueharbor.test','Morgan MSP',false,true);

insert into organizations (id, account_id, name, isolated, workos_organization_id) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Northstar Production',false,'org_local_northstar'),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Redwood Partner',false,'org_local_redwood'),
('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','Juniper Referral POC',true,'org_local_juniper'),
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','Blue Harbor Portfolio',false,'org_local_blueharbor'),
('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','Atlas Distribution',false,'org_local_atlas'),
('30000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000007','Ivory Embedded',false,'org_local_ivory'),
('30000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000008','Mercury Marketplace',false,'org_local_mercury'),
('30000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000009','Clockwork Staff',true,'org_local_clockwork_staff');

insert into memberships (id, organization_id, user_id, role) values
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','owner'),
('31000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','partner_admin'),
('31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000001','internal_operator'),
('31000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','owner'),
('31000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','partner_admin'),
('31000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','partner_admin'),
('31000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000007','partner_admin'),
('31000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000008','partner_admin');

insert into documents (id, account_id, kind, storage_key, content_hash, mime_type, byte_length, object_lock_mode, retain_until, storage_version_id) values
('40000000-0000-4000-8000-000000000001',null,'agreement_template','sha256/aa/template.pdf',repeat('a',64),'application/pdf',1024,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','agreement','sha256/bb/agreement.pdf',repeat('b',64),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','quote','sha256/cc/quote.pdf',repeat('c',64),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','order_form','sha256/dd/order.pdf',repeat('d',64),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','amendment','sha256/ee/amendment.pdf',repeat('e',64),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','notice','sha256/ff/notice.pdf',repeat('f',64),'application/pdf',1024,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1');

insert into documents (id, account_id, kind, storage_key, content_hash, mime_type, byte_length, object_lock_mode, retain_until, storage_version_id) values
('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','agreement','demo/agreement-referral.pdf',lpad('7',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000003','agreement','demo/agreement-resale.pdf',lpad('8',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000005','agreement','demo/agreement-distributor.pdf',lpad('9',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000007','agreement','demo/agreement-white-label.pdf',lpad('10',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000008','agreement','demo/agreement-marketplace.pdf',lpad('11',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000004','quote','demo/quote-referral.pdf',lpad('12',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000003','quote','demo/quote-resale.pdf',lpad('13',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000003','partner_quote','demo/partner-quote-resale.pdf',lpad('14',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000005','quote','demo/quote-distributor.pdf',lpad('15',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000005','partner_quote','demo/partner-quote-distributor.pdf',lpad('16',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000007','quote','demo/quote-white-label.pdf',lpad('17',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000018','10000000-0000-4000-8000-000000000007','partner_quote','demo/partner-quote-white-label.pdf',lpad('18',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000019','10000000-0000-4000-8000-000000000004','quote','demo/quote-marketplace.pdf',lpad('19',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000004','settlement','demo/marketplace-settlement.pdf',lpad('20',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000004','order_form','demo/order-referral.pdf',lpad('21',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000003','order_form','demo/order-resale.pdf',lpad('22',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000005','order_form','demo/order-distributor.pdf',lpad('23',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000024','10000000-0000-4000-8000-000000000007','order_form','demo/order-white-label.pdf',lpad('24',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000025','10000000-0000-4000-8000-000000000004','order_form','demo/order-marketplace.pdf',lpad('25',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000026','10000000-0000-4000-8000-000000000001','deletion_certificate','demo/deletion-certificate.pdf',lpad('26',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000027','10000000-0000-4000-8000-000000000004','agreement','demo/agreement-conversion.pdf',lpad('27',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000028','10000000-0000-4000-8000-000000000004','quote','demo/quote-conversion.pdf',lpad('28',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000029','10000000-0000-4000-8000-000000000004','order_form','demo/order-conversion.pdf',lpad('29',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000002','agreement','demo/agreement-referral-partner.pdf',lpad('30',64,'0'),'application/pdf',2048,'COMPLIANCE','2033-07-31T16:00:00Z','demo-v1');

insert into agreement_templates (id, type, semantic_version, jurisdiction, effective_on, canonical_document_id, text_hash, execution_mode, approval_status, approved_by) values
('50000000-0000-4000-8000-000000000001','csa','1.0.0','US','2026-01-01','40000000-0000-4000-8000-000000000001',repeat('a',64),'click_through','approved','20000000-0000-4000-8000-000000000001');

insert into agreements (id, account_id, template_id, paper, execution_mode, executed_document_id, negotiation_status, effective_on, term_months, renewal_type, notice_days, status, signer_user_id, authority_title, authority_attested, accepted_ip, accepted_user_agent, text_hash) values
('51000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','ours','click_through','40000000-0000-4000-8000-000000000002','standard','2026-01-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000002','Chief Demo Officer',true,'192.0.2.1','Clockwork deterministic seed',repeat('a',64));

insert into agreements (id, account_id, template_id, paper, execution_mode, executed_document_id, negotiation_status, effective_on, term_months, renewal_type, notice_days, status, signer_user_id, authority_title, authority_attested, accepted_ip, accepted_user_agent, text_hash) values
('51000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000001','ours','click_through','40000000-0000-4000-8000-000000000007','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000004','Chief Demo Officer',true,'192.0.2.4','Clockwork referral seed',lpad('102',64,'0')),
('51000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000008','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000008','Partner Director',true,'192.0.2.8','Clockwork resale seed',lpad('103',64,'0')),
('51000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000009','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000005','Distribution Director',true,'192.0.2.5','Clockwork distributor seed',lpad('104',64,'0')),
('51000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000010','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000006','Embedded Director',true,'192.0.2.7','Clockwork white-label seed',lpad('105',64,'0')),
('51000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000008','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000011','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000007','Marketplace Director',true,'192.0.2.8','Clockwork marketplace seed',lpad('106',64,'0')),
('51000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000027','standard','2026-07-15',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000004','Chief Demo Officer',true,'192.0.2.4','Clockwork conversion seed',lpad('107',64,'0')),
('51000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','ours','counter_signed','40000000-0000-4000-8000-000000000030','standard','2026-06-01',12,'auto_renew',60,'active','20000000-0000-4000-8000-000000000003','Partner Director',true,'192.0.2.3','Clockwork referral partner seed',lpad('108',64,'0'));

insert into key_terms (id, agreement_id, breach_notice_hours, audit_rights, retention_liability_rule) values
('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',72,'Annual evidence review','liable_through_retention');

insert into price_books (id, name, currency, effective_from, status, version) values
('60000000-0000-4000-8000-000000000001','Demo USD 2026','USD','2026-01-01','active',1),
('60000000-0000-4000-8000-000000000002','Demo EUR 2026','EUR','2026-01-01','active',1);
insert into rate_cards (id, price_book_id, sku, approved_claim, region, unit, unit_price_minor, floor_price_minor, overage_rate_minor, minimum_quantity, trial_limit, egress_treatment, commit_type, stripe_tax_code, qbo_income_account, partner_transfer_prices) values
('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB','Fictional immutable storage capacity','us-east-2','TB-month',15000,10000,18000,1,5,'metered','term_drawdown','txcd_demo','4000-Storage','{"gold":{"currency":"USD","minor":"12500"},"silver":{"currency":"USD","minor":"12000"},"distributor":{"currency":"USD","minor":"11000"},"two-tier":{"currency":"USD","minor":"11500"},"white-label":{"currency":"USD","minor":"12000"},"marketplace":{"currency":"USD","minor":"13000"}}'),
('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','LOCKED-STORAGE-TB','Fictional immutable storage capacity','eu-west-1','TB-month',14000,9500,17000,1,5,'metered','term_drawdown','txcd_demo','4000-Storage','{"silver":{"currency":"EUR","minor":"14000"}}');

insert into quotes (id, account_id, end_client_account_id, partner_account_id, price_book_id, series_id, revision, status, currency, total_minor, margin_floor_result, expires_at, created_by, rendered_document_id, partner_document_id, partner_resale_total_minor, immutable_at) values
('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,null,'60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000001',1,'accepted','USD',180000,'pass','2026-08-31T16:00:00Z','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003',null,null,'2026-01-01T16:00:00Z'),
('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000002',1,'accepted','USD',120000,'pass','2026-08-31T16:00:00Z','20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000012',null,null,'2026-07-20T16:00:00Z'),
('70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000002','70100000-0000-4000-8000-000000000003',1,'accepted','EUR',168000,'pass','2026-08-31T16:00:00Z','20000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000014',216000,'2026-07-21T16:00:00Z'),
('70000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000004',1,'accepted','USD',132000,'pass','2026-09-30T16:00:00Z','20000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000016',180000,'2026-07-22T16:00:00Z'),
('70000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000005',1,'accepted','USD',144000,'pass','2026-09-30T16:00:00Z','20000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000017','40000000-0000-4000-8000-000000000018',192000,'2026-07-23T16:00:00Z'),
('70000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004',null,null,'60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000006',1,'accepted','USD',156000,'pass','2026-09-30T16:00:00Z','20000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000019',null,null,'2026-07-24T16:00:00Z'),
('70000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004',null,null,'60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000000007',1,'accepted','USD',180000,'pass','2026-09-30T16:00:00Z','20000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000028',null,null,'2026-07-25T16:00:00Z');

insert into core_quote_commercial_profiles (
  quote_id, channel_shape, merchant_of_record, pricing_authority, billing_account_id,
  distributor_account_id, marketplace_provider, transfer_total_minor,
  partner_resale_total_minor, white_label_metadata, pricing_inputs, pricing_calculated_at
) values
('70000000-0000-4000-8000-000000000001','direct','fil_one','fil_one','10000000-0000-4000-8000-000000000001',null,null,null,null,'{}','{"source":"demo-price-book"}','2026-01-01T15:59:00Z'),
('70000000-0000-4000-8000-000000000002','referral','fil_one','fil_one','10000000-0000-4000-8000-000000000004',null,null,null,null,'{}','{"source":"demo-price-book"}','2026-07-20T15:59:00Z'),
('70000000-0000-4000-8000-000000000003','resale','partner','partner','10000000-0000-4000-8000-000000000003',null,null,168000,216000,'{}','{"source":"demo-transfer-tier"}','2026-07-21T15:59:00Z'),
('70000000-0000-4000-8000-000000000004','distributor','partner','partner','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',null,132000,180000,'{}','{"source":"demo-transfer-tier"}','2026-07-22T15:59:00Z'),
('70000000-0000-4000-8000-000000000005','resale','partner','partner','10000000-0000-4000-8000-000000000007',null,null,144000,192000,'{"brandName":"Ivory Archive","customDomain":"archive.ivory.test"}','{"source":"demo-white-label-price-book"}','2026-07-23T15:59:00Z'),
('70000000-0000-4000-8000-000000000006','marketplace','marketplace','marketplace','10000000-0000-4000-8000-000000000004',null,'aws',156000,null,'{}','{"source":"demo-aws-offer"}','2026-07-24T15:59:00Z'),
('70000000-0000-4000-8000-000000000007','direct','fil_one','fil_one','10000000-0000-4000-8000-000000000004',null,null,null,null,'{}','{"source":"demo-poc-conversion"}','2026-07-25T15:59:00Z');

insert into quote_lines (id, quote_id, rate_card_id, sku, quantity, term_months, unit_price_minor, overage_rate_minor, discount_bps, line_total_minor) values
('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,15000,18000,0,180000),
('71000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,10000,18000,3333,120000),
('71000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000002','LOCKED-STORAGE-TB',1,12,14000,17000,0,168000),
('71000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,11000,18000,2667,132000),
('71000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,12000,18000,2000,144000),
('71000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000006','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,13000,18000,1333,156000),
('71000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000007','61000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,12,15000,18000,0,180000);

insert into orders (id, quote_id, agreement_id, account_id, invoicing_account_id, sourcing, po_number, signer_user_id, authority_title, authority_attested, status, service_starts_on, service_ends_on, notice_on, order_form_document_id, immutable_at) values
('80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','direct','PO-DEMO-001','20000000-0000-4000-8000-000000000002','Chief Demo Officer',true,'amended','2026-01-01','2026-12-31','2026-11-01','40000000-0000-4000-8000-000000000004','2026-01-01T16:00:00Z');
insert into orders (id, quote_id, agreement_id, account_id, invoicing_account_id, partner_account_id, sourcing, po_number, signer_user_id, authority_title, authority_attested, status, service_starts_on, service_ends_on, notice_on, order_form_document_id, immutable_at) values
('80000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','referral','PO-REF-002','20000000-0000-4000-8000-000000000004','Chief Demo Officer',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000021','2026-07-20T16:00:00Z'),
('80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','resale','PO-RESALE-003','20000000-0000-4000-8000-000000000008','Partner Director',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000022','2026-07-21T16:00:00Z'),
('80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','distributor','PO-DIST-004','20000000-0000-4000-8000-000000000005','Distribution Director',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000023','2026-07-22T16:00:00Z'),
('80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007','resale','PO-WHITE-005','20000000-0000-4000-8000-000000000006','Embedded Director',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000024','2026-07-23T16:00:00Z'),
('80000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000006','51000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',null,'marketplace','PO-MARKET-006','20000000-0000-4000-8000-000000000004','Chief Demo Officer',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000025','2026-07-24T16:00:00Z'),
('80000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000007','51000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',null,'direct','PO-DIRECT-007','20000000-0000-4000-8000-000000000004','Chief Demo Officer',true,'active','2026-08-01','2027-07-31','2027-06-01','40000000-0000-4000-8000-000000000029','2026-07-25T16:00:00Z');

insert into core_order_commercial_profiles (
  order_id, merchant_of_record, billing_shape, provisioning_idempotency_key,
  governing_agreement_version, distributor_account_id, invoice_grouping_key,
  contractual_time_zone, accepted_at
) values
('80000000-0000-4000-8000-000000000001','fil_one','direct','demo:provisioning:order-001',1,null,null,'America/New_York','2026-01-01T16:00:00Z'),
('80000000-0000-4000-8000-000000000002','fil_one','referral','demo:provisioning:order-002',1,null,null,'America/Denver','2026-07-20T16:00:00Z'),
('80000000-0000-4000-8000-000000000003','partner','resale','demo:provisioning:order-003',1,null,'partner:blue-harbor:2026-08','Europe/Madrid','2026-07-21T16:00:00Z'),
('80000000-0000-4000-8000-000000000004','partner','distributor','demo:provisioning:order-004',1,'10000000-0000-4000-8000-000000000005','partner:atlas:2026-08','America/Chicago','2026-07-22T16:00:00Z'),
('80000000-0000-4000-8000-000000000005','partner','resale','demo:provisioning:order-005',1,null,'partner:ivory:2026-08','America/Los_Angeles','2026-07-23T16:00:00Z'),
('80000000-0000-4000-8000-000000000006','marketplace','marketplace','demo:provisioning:order-006',1,null,'marketplace:aws:2026-08','America/New_York','2026-07-24T16:00:00Z'),
('80000000-0000-4000-8000-000000000007','fil_one','direct','demo:provisioning:order-007',1,null,null,'America/Denver','2026-07-25T16:00:00Z');

insert into order_lines (id, order_id, quote_line_id, sku, quantity, unit_price_minor, overage_rate_minor) values
('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,15000,18000),
('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','LOCKED-STORAGE-TB',1,10000,18000),
('81000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,14000,17000),
('81000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000004','LOCKED-STORAGE-TB',1,11000,18000),
('81000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000005','LOCKED-STORAGE-TB',1,12000,18000),
('81000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','71000000-0000-4000-8000-000000000006','LOCKED-STORAGE-TB',1,13000,18000),
('81000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007','LOCKED-STORAGE-TB',1,15000,18000);

insert into amendments (id, order_id, effective_on, kind, proration_method, document_id) values
('82000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','2026-07-01','upgrade','daily','40000000-0000-4000-8000-000000000005');
insert into amendment_lines (id, amendment_id, order_line_id, sku, quantity_delta, price_delta_minor) values
('82100000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',1,7500);
update order_lines set superseded_by_amendment_id = '82000000-0000-4000-8000-000000000001' where id = '81000000-0000-4000-8000-000000000001';

insert into entitlements (id, order_id, order_line_id, organization_id, sku, committed_quantity, region, activated_at, maximum_retention_at, provisioned_resource_id, status) values
('83000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','LOCKED-STORAGE-TB',2,'us-east-2','2026-01-01T16:00:00Z','2032-12-31T23:59:59Z','fictional-retention-locked-tenant','active'),
('83000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'us-east-2','2026-08-01T16:00:00Z',null,'fictional-referral-tenant','active'),
('83000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'eu-west-1','2026-08-01T16:00:00Z',null,'fictional-resale-tenant','active'),
('83000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'us-east-2','2026-08-01T16:00:00Z',null,'fictional-distributor-tenant','active'),
('83000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'us-east-2','2026-08-01T16:00:00Z',null,'fictional-white-label-tenant','active'),
('83000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'us-east-2','2026-08-01T16:00:00Z',null,'fictional-marketplace-tenant','active'),
('83000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','81000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000003','LOCKED-STORAGE-TB',1,'us-east-2','2026-08-01T16:00:00Z',null,'fictional-direct-conversion-tenant','active');
insert into commitment_ledgers (id, order_id, order_line_id, commit_type, committed_quantity, consumed_quantity, overage_quantity, period_starts_at, period_ends_at) values
('84000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','term_drawdown',12,8,0,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z');

insert into core_commitment_periods (
  id, ledger_id, sequence, starts_at, ends_at, contractual_time_zone,
  allowance_quantity, consumed_quantity, overage_quantity, contracted_overage_rate_minor, status
) values
('84300000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','America/New_York',12,8,0,18000,'open');

insert into usage_events (id, entitlement_id, external_event_id, measured_at, quantity, kind) values
('84100000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','usage-demo-001','2026-07-31T15:00:00Z',8,'storage');
insert into commitment_entries (id, ledger_id, usage_event_id, quantity, overage_quantity, recorded_at) values
('84200000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','84100000-0000-4000-8000-000000000001',8,0,'2026-07-31T16:00:00Z');

insert into core_usage_reconciliations (
  id, entitlement_id, period_starts_at, period_ends_at, source_system,
  source_quantity, ledger_quantity, variance_quantity, status
) values
('84400000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','provisioning-demo',8,8,0,'matched');

insert into pocs (id, account_id, organization_id, partner_account_id, workload, permitted_data_class, success_tests, commercial_range, capacity_cap, egress_cap, duration_days, named_keys, expires_at, support_owner_id, kickoff_at, midpoint_at, final_report_at, currency, status) values
('85000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','40 TB archive migration','synthetic-only','[{"description":"Restore test","passedAt":null}]','{"minimum":{"currency":"USD","minor":"120000"},"maximum":{"currency":"USD","minor":"360000"}}',40,2,30,array['poc-demo-key'],'2026-08-15T16:00:00Z','20000000-0000-4000-8000-000000000001','2026-07-16T16:00:00Z','2026-07-31T16:00:00Z','2026-08-14T16:00:00Z','USD','active');

insert into invoices (id, order_id, account_id, stripe_invoice_id, currency, amount_minor, po_number, status, due_at) values
('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','in_demo_overdue','USD',180000,'PO-DEMO-001','open','2026-06-30T16:00:00Z'),
('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','in_demo_referral','USD',120000,'PO-REF-002','paid','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','in_demo_resale','EUR',168000,'PO-RESALE-003','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','in_demo_distributor','USD',132000,'PO-DIST-004','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000007','in_demo_white_label','USD',144000,'PO-WHITE-005','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','in_demo_marketplace','USD',156000,'PO-MARKET-006','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004',null,'USD',180000,'PO-DIRECT-007','draft','2026-08-31T16:00:00Z');

insert into core_invoice_end_client_allocations (
  id, invoice_id, order_id, end_client_account_id, currency,
  subtotal_minor, tax_minor, total_minor, stripe_invoice_line_ids
) values
('90100000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','EUR',168000,0,168000,array['il_demo_resale']),
('90100000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','USD',132000,0,132000,array['il_demo_distributor']),
('90100000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004','USD',144000,0,144000,array['il_demo_white_label']);

insert into core_marketplace_reconciliations (
  id, provider, period_starts_on, period_ends_on, currency,
  provider_gross_minor, platform_gross_minor, provider_fees_minor,
  platform_fees_minor, variance_minor, status
) values
('90200000-0000-4000-8000-000000000001','aws','2026-07-01','2026-07-31','USD',156000,156000,12000,12000,0,'matched');

insert into core_three_way_tie_outs (
  id, period_starts_on, period_ends_on, currency,
  platform_revenue_minor, stripe_revenue_minor, qbo_revenue_minor,
  stripe_variance_minor, qbo_variance_minor, status, variances,
  reviewed_by, reviewed_at
) values
('90300000-0000-4000-8000-000000000001','2026-07-01','2026-07-31','USD',300000,300000,300000,0,0,'matched','[]','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z');

insert into payments (id, invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status, received_at) values
('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','pi_demo_disputed','USD',180000,'succeeded','2026-06-01T16:00:00Z'),
('91000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','pi_demo_referral','USD',120000,'succeeded','2026-08-01T16:00:00Z');
insert into dispute_cases (id, payment_id, order_id, stripe_dispute_id, currency, amount_minor, evidence_due_at, status) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','dp_demo_open','USD',180000,'2026-08-05T16:00:00Z','needs_response');

insert into inbound_notices (id, account_id, order_id, type, served_on, evidence_document_id, recorded_by) values
('93000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','non_renewal','2026-07-30','40000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001');

insert into commission_accruals (id, partner_account_id, invoice_id, source_type, source_id, rate_bps, holdback_bps, currency, net_collected_revenue_minor, amount_minor, holdback_minor, period, status) values
('93500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','payment','91000000-0000-4000-8000-000000000002',1200,1000,'USD',120000,14400,1440,'2026-Q3','accrued');

insert into terminations (id, account_id, order_id, effective_at, final_billing_status, teardown_status, deletion_scheduled_at) values
('93600000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','2027-01-01T00:00:00Z','settled','retention_blocked','2033-01-01T00:00:00Z');
insert into lifecycle_offboarding_plans (
  termination_id, account_id, organization_id, requested_by, reason, plan
) values (
  '93600000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'customer_request',
  jsonb_build_object(
    'terminationId','93600000-0000-4000-8000-000000000001',
    'accountId','10000000-0000-4000-8000-000000000001',
    'orderId','80000000-0000-4000-8000-000000000001',
    'organizationId','30000000-0000-4000-8000-000000000001',
    'reason','customer_request',
    'requestedBy','20000000-0000-4000-8000-000000000002',
    'effectiveAt','2027-01-01T00:00:00.000Z',
    'finalBillingStatus','settled',
    'retrievalStartsAt','2027-01-01T00:00:00.000Z',
    'retrievalEndsAt','2027-01-31T00:00:00.000Z',
    'maximumRetentionAt','2033-07-31T16:00:00.000Z',
    'status','retention_blocked',
    'lockedExclusions',jsonb_build_array(jsonb_build_object(
      'objectId','40000000-0000-4000-8000-000000000002',
      'scope','document:agreement',
      'retainUntil','2033-07-31T16:00:00.000Z',
      'legalHold',false
    )),
    'deletionScheduledAt','2033-07-31T16:00:00.000Z',
    'approvals',jsonb_build_array(),
    'teardownOperationId',null,
    'teardownConfirmedAt',null,
    'teardownExcludedObjectIds',jsonb_build_array()
  )
);
insert into deletion_certificates (id, termination_id, document_id, scope, method, completed_at, locked_exclusions) values
('93700000-0000-4000-8000-000000000001','93600000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000026','eligible metadata and expired evidence','cryptographic erasure plus provider deletion','2033-01-02T16:00:00Z','[{"scope":"fictional-retention-locked-tenant","retainedUntil":"2033-07-31T16:00:00Z","reason":"S3 Object Lock COMPLIANCE"}]');

insert into novations (id, account_id, former_partner_account_id, source_order_id, new_agreement_id, new_order_id, reason, continuity_confirmed_at) values
('93800000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','agreed_handoff','2026-07-31T16:00:00Z');

insert into deal_registrations (id, partner_account_id, end_client_account_id, workload, expected_volume, status, protection_starts_at, protection_ends_at) values
('94000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','Referral archive modernization',40,'approved','2026-07-01T16:00:00Z','2026-10-01T16:00:00Z'),
('94000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','Resale managed archive',20,'disputed','2026-07-15T16:00:00Z','2026-10-15T16:00:00Z'),
('94000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004','Two-tier distributor archive',30,'approved','2026-07-16T16:00:00Z','2026-10-16T16:00:00Z'),
('94000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','White-label embedded archive',25,'approved','2026-07-17T16:00:00Z','2026-10-17T16:00:00Z'),
('94000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000004','Marketplace archive listing',35,'approved','2026-07-18T16:00:00Z','2026-10-18T16:00:00Z');

insert into audit_events (id, account_id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, actor, occurred_at, request_id, after, metadata) values
('95000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','account','10000000-0000-4000-8000-000000000001',1,'demo.dataset.reset',1,'{"kind":"system","id":"demo-seed"}','2026-07-31T16:00:00Z','seed-2026-07-31','{"scenario":"direct/referral/resale/distributor/white-label/marketplace/poc/overdue/renewal/amendment/dispute/retention-locked"}','{}');
insert into outbox_messages (id, event_id, topic, payload, processed_at) values
('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','demo.reset','{"resetAt":"2026-07-31T16:00:00Z"}','2026-07-31T16:00:00Z');

reset role;
