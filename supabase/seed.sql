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

insert into core_order_line_snapshots (
  id, order_line_id, snapshot, snapshot_hash
) values
('81100000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','{"id":"81000000-0000-4000-8000-000000000001","quoteLineId":"71000000-0000-4000-8000-000000000001","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"15000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"180000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','002c45d1dd255fba9878cd04a4f4d69d8922bf1b818504c09de72871b962085c'),
('81100000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','{"id":"81000000-0000-4000-8000-000000000002","quoteLineId":"71000000-0000-4000-8000-000000000002","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"10000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"120000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','2a0bfa1d589b946057d48fc2e11cbf79a532f2eb92479b3761f9b1b8ce301615'),
('81100000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','{"id":"81000000-0000-4000-8000-000000000003","quoteLineId":"71000000-0000-4000-8000-000000000003","sku":"LOCKED-STORAGE-TB","region":"eu-west-1","quantity":"1","termMonths":12,"unitPrice":{"currency":"EUR","minor":"14000"},"overageRate":{"currency":"EUR","minor":"17000"},"lineTotal":{"currency":"EUR","minor":"168000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','bc3e89170ba795aa34821be6523e55d4762112b3958b3dc9ce5339f8ecb7e9c7'),
('81100000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000004','{"id":"81000000-0000-4000-8000-000000000004","quoteLineId":"71000000-0000-4000-8000-000000000004","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"11000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"132000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','86c9b82f012779c8f7c8c950d422e33e2dfbbea9bd9090f79dff6c67c1344c33'),
('81100000-0000-4000-8000-000000000005','81000000-0000-4000-8000-000000000005','{"id":"81000000-0000-4000-8000-000000000005","quoteLineId":"71000000-0000-4000-8000-000000000005","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"12000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"144000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','582df6b8a4592b0466ff4e2bc4d40e31a32bdc3476a4840775041eb9b964be86'),
('81100000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000006','{"id":"81000000-0000-4000-8000-000000000006","quoteLineId":"71000000-0000-4000-8000-000000000006","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"13000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"156000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','daae7791cd7d00e7dec0bc90ab5b3e74ae0a073fa0ef7d913286770a71f03d3d'),
('81100000-0000-4000-8000-000000000007','81000000-0000-4000-8000-000000000007','{"id":"81000000-0000-4000-8000-000000000007","quoteLineId":"71000000-0000-4000-8000-000000000007","sku":"LOCKED-STORAGE-TB","region":"us-east-2","quantity":"1","termMonths":12,"unitPrice":{"currency":"USD","minor":"15000"},"overageRate":{"currency":"USD","minor":"18000"},"lineTotal":{"currency":"USD","minor":"180000"},"commitType":"term_drawdown","stripeTaxCode":"txcd_demo","qboIncomeAccount":"4000-Storage"}','c32becf2aecdfe76bf257b9be38c60e04915e3fe75d1fd400dadc210b9181dc1');

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
('85000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','40 TB archive migration','synthetic-only','[{"id":"restore-test","description":"Restore test","target":"100% checksum match","passedAt":null}]','{"minimum":{"currency":"USD","minor":"120000"},"maximum":{"currency":"USD","minor":"360000"}}',40,2,30,array['poc-demo-key'],'2026-08-15T16:00:00Z','20000000-0000-4000-8000-000000000001','2026-07-16T16:00:00Z','2026-07-31T16:00:00Z','2026-08-14T16:00:00Z','USD','active');

insert into invoices (id, order_id, account_id, stripe_invoice_id, currency, amount_minor, po_number, status, due_at) values
('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','in_demo_overdue','USD',180000,'PO-DEMO-001','open','2026-06-30T16:00:00Z'),
('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','in_demo_referral','USD',120000,'PO-REF-002','paid','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','in_demo_resale','EUR',168000,'PO-RESALE-003','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','in_demo_distributor','USD',132000,'PO-DIST-004','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000007','in_demo_white_label','USD',144000,'PO-WHITE-005','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','in_demo_marketplace','USD',156000,'PO-MARKET-006','open','2026-08-31T16:00:00Z'),
('90000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004',null,'USD',180000,'PO-DIRECT-007','draft','2026-08-31T16:00:00Z');
-- A paid invoice is settled in full. The overdue invoice keeps its full
-- remainder: its only payment is the one under dispute.
--
-- Guarded on the column, because the populated-upgrade drill replays this seed
-- against 001230 and `amount_paid_minor` only arrives in 001340. Unguarded, the
-- whole reset aborts on SQLSTATE 42703 and the drill cannot run at all.
do $invoice_settlement$
begin
if to_regclass('public.invoices') is not null and exists (
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'invoices'
    and column_name = 'amount_paid_minor'
) then
execute $seed_sql$
update invoices set amount_paid_minor = amount_minor where status = 'paid';
$seed_sql$;
end if;
end
$invoice_settlement$;

do $invoice_snapshots$
begin
if to_regclass('public.core_invoice_document_snapshots') is not null then
execute $seed_sql$
insert into core_invoice_document_snapshots (
  invoice_id, order_id, quote_id, currency, line_items, subtotal_minor,
  tax_minor, total_minor, source_hash, source_version
) values
('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','USD','[{"id":"81000000-0000-4000-8000-000000000001","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"15000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,'491eb3ce605fe8f01771d4d29b6f856ff53d227967819305237a3dad1a6a193a','quote:70000000-0000-4000-8000-000000000001:r1'),
('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','USD','[{"id":"81000000-0000-4000-8000-000000000002","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"10000"},"amount":{"currency":"USD","minorUnits":"120000"}}]',120000,0,120000,'35b92e9bd1a25f40375408fcae0c9caf6427490f44f78211dcae1f7f261ebdc9','quote:70000000-0000-4000-8000-000000000002:r1'),
('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000003','EUR','[{"id":"81000000-0000-4000-8000-000000000003","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"EUR","minorUnits":"14000"},"amount":{"currency":"EUR","minorUnits":"168000"}}]',168000,0,168000,'0e45cb6e9b83bf0e967cde46730479777e4a97f7a330fe6d6b9ad010f076fdf4','quote:70000000-0000-4000-8000-000000000003:r1'),
('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004','USD','[{"id":"81000000-0000-4000-8000-000000000004","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"11000"},"amount":{"currency":"USD","minorUnits":"132000"}}]',132000,0,132000,'c186e16fa75ccd7fd128b5d1685c744d023e8e5c27a43ee2e03392f95dd2f777','quote:70000000-0000-4000-8000-000000000004:r1'),
('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','70000000-0000-4000-8000-000000000005','USD','[{"id":"81000000-0000-4000-8000-000000000005","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"12000"},"amount":{"currency":"USD","minorUnits":"144000"}}]',144000,0,144000,'a14d73e1658517c430a25cba8449eb1cb36ffa28bd0f8298601de7042b5e1f0d','quote:70000000-0000-4000-8000-000000000005:r1'),
('90000000-0000-4000-8000-000000000006','80000000-0000-4000-8000-000000000006','70000000-0000-4000-8000-000000000006','USD','[{"id":"81000000-0000-4000-8000-000000000006","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"13000"},"amount":{"currency":"USD","minorUnits":"156000"}}]',156000,0,156000,'8e346ae57431c15ecd3072ed2b7290fbae6cebc74e96767a7d47bf5fe8489b36','quote:70000000-0000-4000-8000-000000000006:r1'),
('90000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','70000000-0000-4000-8000-000000000007','USD','[{"id":"81000000-0000-4000-8000-000000000007","description":"LOCKED-STORAGE-TB","quantity":"1","unitPrice":{"currency":"USD","minorUnits":"15000"},"amount":{"currency":"USD","minorUnits":"180000"}}]',180000,0,180000,'0306c29d720df09a7cc6bd7a0c17ec021fc5aa51312f64a66197ad3aa253281a','quote:70000000-0000-4000-8000-000000000007:r1');
$seed_sql$;
end if;
end
$invoice_snapshots$;

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
      'legalHold',false,
      'reason','object_lock_retention'
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

-- ---------------------------------------------------------------------------
-- TAX: the supplier side, the rule books, and the rates the engine consults.
--
-- EVERY BOOK BELOW SHIPS AS `repository_fixture`. That is the honest label and
-- it is what makes shipping rates at all defensible: the engine is live,
-- exercised and tested end to end against these, usable for demo, staging and
-- test, and system_gate_is_active (001000:22-42) already refuses to report
-- EXT-TAX-01 active unless provenance is live_signed — so no live-signed
-- invoice can be issued against a single figure here. When an accountant signs
-- one jurisdiction's matrix, that book alone flips to live_signed. Per
-- jurisdiction, not all-or-nothing.
--
-- The numbers are plausible fixtures for a first global beta, not advice and
-- not a verified matrix. Each carries the authority_reference and legal_basis
-- an accountant would review before signing, and every one of them says
-- "fixture" so no reader can mistake it for a signed input.
--
-- There is deliberately NO 'EU' rule book. Reverse charge is a member-state
-- rule applied by the member state, so it lives in each member's
-- rule_parameters where the resolver can actually reach it; an 'EU' book would
-- be an ancestor of nothing (ES is not EU-ES) and could never resolve.

insert into documents (id, account_id, kind, storage_key, content_hash, mime_type, byte_length, object_lock_mode, retain_until, storage_version_id) values
('40000000-0000-4000-8000-000000000040',null,'tax_registration_evidence','sha256/40/gb-vat-fixture.pdf',lpad('40',64,'0'),'application/pdf',1024,'COMPLIANCE','2036-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000041',null,'tax_registration_evidence','sha256/41/us-ny-fixture.pdf',lpad('41',64,'0'),'application/pdf',1024,'COMPLIANCE','2036-07-31T16:00:00Z','demo-v1'),
('40000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000003','tax_registration_evidence','sha256/42/es-partner-fixture.pdf',lpad('42',64,'0'),'application/pdf',1024,'COMPLIANCE','2036-07-31T16:00:00Z','demo-v1');

-- Our selling entities, plus the Spanish reseller acting as its own merchant of
-- record. That third row is the case the current determination gets wrong:
-- quote 70000000-...-003 is a resale route whose merchant_of_record is
-- 'partner' and whose invoiced account is Blue Harbor MSP (ES), so today the
-- determination is made against ES with a US supplier. With a supplier side in
-- the data, the supply can be determined from both parties.
insert into core_legal_entities (
  id, legal_name, merchant_role, account_id, established_country,
  registered_address, invoice_header_text, invoice_footer_text
) values
('97000000-0000-4000-8000-000000000001','Clockwork Commerce Ltd','our_entity',null,'GB',
 '{"line1":"1 Fiction Row","city":"London","postalCode":"EC1A 1BB","country":"GB"}',
 'Clockwork Commerce Ltd (fictional)','Fictional footer text pending EXT-BRAND-01 approval.'),
('97000000-0000-4000-8000-000000000002','Clockwork Commerce Inc','our_entity',null,'US',
 '{"line1":"2 Fiction Row","city":"Wilmington","postalCode":"19801","country":"US"}',
 'Clockwork Commerce Inc (fictional)','Fictional footer text pending EXT-BRAND-01 approval.'),
('97000000-0000-4000-8000-000000000003','Blue Harbor MSP','partner_entity','10000000-0000-4000-8000-000000000003','ES',
 '{"line1":"3 Fiction Way","city":"Madrid","postalCode":"28001","country":"ES"}',
 'Blue Harbor MSP (fictional partner merchant of record)','Fictional footer text pending EXT-BRAND-01 approval.');

-- Operator statements. Note what is NOT here: no registration anywhere in
-- Connecticut, although US-CT has a rule book with rates. A supply there
-- resolves a book, finds no registration, and is `not_registered` — no tax
-- charged, treatment recorded, exception raised. That absence is the point.
insert into core_tax_registrations (
  id, legal_entity_id, jurisdiction, scheme, registration_number,
  effective_from, effective_to, status, stated_by, stated_at, evidence_document_id
) values
('97100000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','GB','vat','GB000000000',
 '2020-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000040'),
('97100000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001','IE','vat_oss','IE0000000XX',
 '2021-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000040'),
('97100000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000002','US-NY','sales_tax','NY-000000000',
 '2022-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000041'),
-- Applied for, certificate not yet received. A pending row carries no evidence
-- and answers no determination; recording the application is a legitimate
-- operation and refusing to record it would block one.
('97100000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000002','US-TX','sales_tax','TX-000000000',
 '2026-09-01',null,'pending','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z',null),
('97100000-0000-4000-8000-000000000005','97000000-0000-4000-8000-000000000003','ES','vat','ESX0000000X',
 '2023-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000042');

-- Rule books are created as drafts and published through the two-person
-- approval the database enforces (001412). The seed walks that flow rather than
-- inserting published rows, because a seed that could not pass the control
-- would be evidence the control is wrong.
insert into core_tax_rule_books (
  id, jurisdiction, version, status, effective_from, effective_to,
  rule_parameters, authority_reference, determination_source,
  input_provenance, subdivision_scope
) values
-- The superseded United Kingdom book. It is retired and it still answers: a
-- supply with a 2025 tax point resolves HERE, not to the 2026 book. Filtering
-- resolution on 'active' alone would price last year's supply at this year's
-- rates and nothing would look wrong.
('97200000-0000-4000-8000-000000000001','GB',1,'draft','2020-01-01','2026-01-01',
 '{"placeOfSupply":"destination_b2b","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_outside_gb","notationCode":"RC-GB"}}',
 'Repository fixture: superseded United Kingdom matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000002','GB',2,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_outside_gb","notationCode":"RC-GB"}}',
 'Repository fixture: United Kingdom matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000003','IE',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","memberState":true,"roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_in_another_member_state","notationCode":"RC-EU","scheme":"vat","basis":"article_196_style_fixture"}}',
 'Repository fixture: Ireland matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000004','ES',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","memberState":true,"roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_in_another_member_state","notationCode":"RC-EU","scheme":"vat","basis":"article_196_style_fixture"}}',
 'Repository fixture: Spain matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000005','DE',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","memberState":true,"roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_in_another_member_state","notationCode":"RC-EU","scheme":"vat","basis":"article_196_style_fixture"}}',
 'Repository fixture: Germany matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000006','FR',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","memberState":true,"roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_in_another_member_state","notationCode":"RC-EU","scheme":"vat","basis":"article_196_style_fixture"}}',
 'Repository fixture: France matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000007','NL',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination_b2b","memberState":true,"roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","reverseCharge":{"appliesWhen":"customer_registered_in_another_member_state","notationCode":"RC-EU","scheme":"vat","basis":"article_196_style_fixture"}}',
 'Repository fixture: Netherlands matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
-- United States, state level. Every one of these is `this_level_only` except
-- Connecticut, which levies no local sales tax in this fixture. That single
-- column is why asking for a New York City address does not silently come back
-- with New York State's 4%.
('97200000-0000-4000-8000-000000000008','US-NY',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":true}',
 'Repository fixture: New York State matrix, pending EXT-TAX-01 signature','local','repository_fixture','this_level_only'),
-- The combined New York City rate, decomposed. Three stacked components summing
-- to 88750 ppm — 8.875% — which is 887.5 basis points and therefore not
-- expressible as an integer in the repository's usual rate unit. This row is
-- the concrete reason core_tax_rates.rate_ppm is parts per million.
('97200000-0000-4000-8000-000000000009','US-NY-36061',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","stacks":["state_share","city","district"]}',
 'Repository fixture: New York County combined matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction'),
('97200000-0000-4000-8000-000000000010','US-TX',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":true}',
 'Repository fixture: Texas matrix, pending EXT-TAX-01 signature','local','repository_fixture','this_level_only'),
('97200000-0000-4000-8000-000000000011','US-PA',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":true}',
 'Repository fixture: Pennsylvania matrix, pending EXT-TAX-01 signature','local','repository_fixture','this_level_only'),
('97200000-0000-4000-8000-000000000012','US-WA',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":true}',
 'Repository fixture: Washington matrix, pending EXT-TAX-01 signature','local','repository_fixture','this_level_only'),
('97200000-0000-4000-8000-000000000013','US-OH',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":true}',
 'Repository fixture: Ohio matrix, pending EXT-TAX-01 signature','local','repository_fixture','this_level_only'),
('97200000-0000-4000-8000-000000000014','US-CT',1,'draft','2026-01-01',null,
 '{"placeOfSupply":"destination","roundingRule":"half_up_minor_unit","taxPointRule":"invoice_date","localRatesStack":false}',
 'Repository fixture: Connecticut matrix, pending EXT-TAX-01 signature','local','repository_fixture','whole_jurisdiction');

-- Rates in PARTS PER MILLION: 20% is 200000, 8.875% is 88750.
insert into core_tax_rates (id, tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis, notation) values
('97300000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001','txcd_demo','standard',200000,'Repository fixture: superseded United Kingdom standard rate',''),
('97300000-0000-4000-8000-000000000002','97200000-0000-4000-8000-000000000002','txcd_demo','standard',200000,'Repository fixture: United Kingdom standard rate',''),
('97300000-0000-4000-8000-000000000003','97200000-0000-4000-8000-000000000002','txcd_demo_zero','zero',0,'Repository fixture: United Kingdom zero rate','Zero-rated supply'),
('97300000-0000-4000-8000-000000000004','97200000-0000-4000-8000-000000000003','txcd_demo','standard',230000,'Repository fixture: Ireland standard rate',''),
('97300000-0000-4000-8000-000000000005','97200000-0000-4000-8000-000000000004','txcd_demo','standard',210000,'Repository fixture: Spain standard rate',''),
('97300000-0000-4000-8000-000000000006','97200000-0000-4000-8000-000000000005','txcd_demo','standard',190000,'Repository fixture: Germany standard rate',''),
('97300000-0000-4000-8000-000000000007','97200000-0000-4000-8000-000000000006','txcd_demo','standard',200000,'Repository fixture: France standard rate',''),
('97300000-0000-4000-8000-000000000008','97200000-0000-4000-8000-000000000007','txcd_demo','standard',210000,'Repository fixture: Netherlands standard rate',''),
('97300000-0000-4000-8000-000000000009','97200000-0000-4000-8000-000000000008','txcd_demo','standard',40000,'Repository fixture: New York State rate, local rates stack on top',''),
('97300000-0000-4000-8000-000000000010','97200000-0000-4000-8000-000000000009','txcd_demo_state','state_share',40000,'Repository fixture: New York State share of the New York County combined rate',''),
('97300000-0000-4000-8000-000000000011','97200000-0000-4000-8000-000000000009','txcd_demo_city','city',45000,'Repository fixture: New York City share of the New York County combined rate',''),
('97300000-0000-4000-8000-000000000012','97200000-0000-4000-8000-000000000009','txcd_demo_district','district',3750,'Repository fixture: transit district share of the New York County combined rate','0.375% — the component that cannot be an integer number of basis points'),
('97300000-0000-4000-8000-000000000013','97200000-0000-4000-8000-000000000010','txcd_demo','standard',62500,'Repository fixture: Texas state rate, local rates stack on top',''),
('97300000-0000-4000-8000-000000000014','97200000-0000-4000-8000-000000000011','txcd_demo','standard',60000,'Repository fixture: Pennsylvania state rate, local rates stack on top',''),
('97300000-0000-4000-8000-000000000015','97200000-0000-4000-8000-000000000012','txcd_demo','standard',65000,'Repository fixture: Washington state rate, local rates stack on top',''),
('97300000-0000-4000-8000-000000000016','97200000-0000-4000-8000-000000000013','txcd_demo','standard',57500,'Repository fixture: Ohio state rate, local rates stack on top',''),
('97300000-0000-4000-8000-000000000017','97200000-0000-4000-8000-000000000014','txcd_demo','standard',63500,'Repository fixture: Connecticut rate, no local sales tax in this fixture','');

-- Two distinct people per book, as the database requires. Iris Operator
-- requests and Dana Direct approves; they are different users, which is what
-- approvals_two_person_check (000001:136) and 001412's trigger between them
-- insist on.
insert into approvals (id, account_id, action, object_type, object_id, requested_by, approved_by, status, requested_at, decided_at)
select
  ('97400000-0000-4000-8000-' || lpad(row_number() over (order by book.jurisdiction, book.version)::text, 12, '0'))::uuid,
  null, 'tax_rule_book_activation', 'tax_rule_book', book.id,
  '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
  'approved', '2026-07-31T15:00:00Z', '2026-07-31T15:30:00Z'
from core_tax_rule_books book
where book.id between '97200000-0000-4000-8000-000000000001'::uuid
  and '97200000-0000-4000-8000-000000000014'::uuid;

-- The superseded book is published straight to retired: it is history, and it
-- has to pass the same two-person control precisely because a retired book
-- still answers a back-dated tax point.
update core_tax_rule_books set status = 'retired'
where id = '97200000-0000-4000-8000-000000000001';

update core_tax_rule_books set status = 'active'
where id between '97200000-0000-4000-8000-000000000002'::uuid
  and '97200000-0000-4000-8000-000000000014'::uuid;

insert into core_tax_rule_book_activation_events (
  id, tax_rule_book_id, action, previous_status, resulting_status,
  previous_provenance, resulting_provenance, effective_at,
  actor_user_id, reason, request_id
)
select
  ('97500000-0000-4000-8000-' || lpad(row_number() over (order by book.jurisdiction, book.version)::text, 12, '0'))::uuid,
  book.id,
  case when book.status = 'retired' then 'retire' else 'activate' end,
  'draft', book.status, null, null,
  (book.effective_from || 'T00:00:00Z')::timestamptz,
  '20000000-0000-4000-8000-000000000002',
  'Fixture matrix published for demo, staging and test. Provenance stays repository_fixture, so EXT-TAX-01 remains blocked and no live-signed invoice can be issued against it.',
  'seed-2026-07-31'
from core_tax_rule_books book
where book.id between '97200000-0000-4000-8000-000000000001'::uuid
  and '97200000-0000-4000-8000-000000000014'::uuid;

reset role;

-- ===========================================================================
-- WS-9: THE SUPPLIER BINDING, AND THE ENGINE PARAMETERS THE BOOKS DID NOT CARRY
-- ===========================================================================
--
-- Two gaps this section closes, both found by driving the database rather than
-- by reading it.
--
-- 1. NOTHING SAID WHICH OF OUR ENTITIES SELLS. 001416 gives that answer a home
--    (core_selling_entity_assignments) and a pin (core_order_supplier_bindings).
--    The statements below are the fixture's answer, at all three scopes, so the
--    resolution order is exercised and not merely declared.
--
-- 2. THE PUBLISHED BOOKS CARRIED NO PARAMETERS THE ENGINE CAN READ.
--    `rule_parameters` on the books above holds a sketch — "placeOfSupply":
--    "destination_b2b", "roundingRule": "half_up_minor_unit" — which is a note
--    to a reader, not an input to `determineTax`. The engine needs territories,
--    taxing authorities, unions, schemes, notations and what a rate kind means,
--    and 001411 says exactly where those live: rule_parameters, "everything an
--    accountant might amend that is not a rate".
--
--    Those books are published and published books are immutable, which is the
--    control working as designed. So the parameters arrive the way any change
--    to a published book arrives: A NEW VERSION, through the same two-person
--    approval, closing its predecessor's window. The predecessors stay in the
--    database and stay answerable for a tax point before 2026-08-01, which is
--    what 001413's retired-book rule is for.
set role clockwork_service;

-- WHO SELLS. Three scopes, most specific first (001416).
--
--   default        -> Clockwork Commerce Inc (US)
--   country GB     -> Clockwork Commerce Ltd (GB)
--   Blue Harbor    -> Clockwork Commerce Inc (US)
--
-- The third is 001410's worked example made real: the Spanish reseller is
-- contracted by our US entity, so the supply is US -> ES and is outside UK and
-- Spanish VAT rather than a Spanish-VAT sale to our own customer. Without the
-- account statement the country default would have picked the US entity
-- anyway; it is stated explicitly because "the Spaniards happen to fall to the
-- default" and "we decided the US entity contracts Blue Harbor" are different
-- facts, and only the second survives a change of default.
insert into core_selling_entity_assignments (
  id, legal_entity_id, account_id, customer_country, effective_from,
  stated_by, stated_at, reason
) values
('97700000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002',
 null, null, '2020-01-01','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z',
 'Fixture: the US entity contracts everyone no other statement covers.'),
('97700000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001',
 null, 'GB', '2020-01-01','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z',
 'Fixture: United Kingdom counterparties contract with the UK entity.'),
('97700000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000003', null, '2020-01-01',
 '20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z',
 'Fixture: Blue Harbor MSP is contracted by the US entity (001410 worked example).');

-- REGISTRATIONS FOR THE STATES THE FIXTURE ACTUALLY SUPPLIES INTO. Without
-- these the seeded books for Massachusetts, Colorado, Illinois and Washington
-- resolve, find no registration, and every demo invoice is `not_registered` at
-- zero — a jurisdiction that is reachable in the resolver and unreachable in
-- practice. Connecticut is still deliberately absent: it has a book, it has
-- rates, and we hold no registration there, which is the case the vocabulary
-- needs to be able to record.
insert into core_tax_registrations (
  id, legal_entity_id, jurisdiction, scheme, registration_number,
  effective_from, effective_to, status, stated_by, stated_at, evidence_document_id
) values
('97100000-0000-4000-8000-000000000006','97000000-0000-4000-8000-000000000002','US-MA','sales_tax','MA-000000000',
 '2022-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000041'),
('97100000-0000-4000-8000-000000000007','97000000-0000-4000-8000-000000000002','US-CO','sales_tax','CO-000000000',
 '2022-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000041'),
('97100000-0000-4000-8000-000000000008','97000000-0000-4000-8000-000000000002','US-IL','sales_tax','IL-000000000',
 '2022-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000041'),
('97100000-0000-4000-8000-000000000009','97000000-0000-4000-8000-000000000002','US-WA','sales_tax','WA-000000000',
 '2022-01-01',null,'active','20000000-0000-4000-8000-000000000001','2026-07-31T16:00:00Z','40000000-0000-4000-8000-000000000041');

-- THE ENGINE PARAMETERS, AS A NEW VERSION OF EVERY BOOK.
--
-- What each fragment says, and why it is data and not code:
--
--   territory          The unit place-of-supply rules compare. Declared by the
--                      COUNTRY book only — a state book contributes an
--                      authority inside the United States, not a territory of
--                      its own, and two books declaring "US" differently would
--                      be two answers to one question.
--   jurisdictions      The authorities that can charge, and the addresses that
--                      reach them. US ZIP prefixes are three digits and exact:
--                      "02" would put Rhode Island in Massachusetts.
--   unions             Membership, which is what makes a cross-border business
--                      service reverse charge. GB has none, which is how Brexit
--                      is expressed here — a fact about a row, not a branch.
--   schemes            Which register a number sits on and whether a CUSTOMER
--                      number on it can carry a reverse charge. A sales-tax
--                      permit cannot; a VAT number can.
--   notations          Wording the document must print. Legal text is never a
--                      literal in TypeScript.
--   rateKindTreatments What `standard`, `zero` and `exempt` MEAN. Nothing infers
--                      "exempt" from a rate of zero: same zero on the bill, a
--                      different number in the accounts.
with places(jurisdiction, kind, prefix_lo, prefix_hi, subdivision_scope,
            new_rate_ppm, new_rate_kind, authority) as (values
  ('GB','vat_country',null::integer,null::integer,'whole_jurisdiction',null::bigint,null::text,'United Kingdom'),
  ('IE','eu_country',null,null,'whole_jurisdiction',null,null,'Ireland'),
  ('ES','eu_country',null,null,'whole_jurisdiction',null,null,'Spain'),
  ('DE','eu_country',null,null,'whole_jurisdiction',null,null,'Germany'),
  ('FR','eu_country',null,null,'whole_jurisdiction',null,null,'France'),
  ('NL','eu_country',null,null,'whole_jurisdiction',null,null,'Netherlands'),
  -- The United States at country level: a territory, an export rule and a
  -- registration scheme, and NO taxing authority of its own. There is no
  -- federal sales tax, and the rate row below says so with its basis because
  -- 001412 refuses to publish a book with no rates at all — a control that is
  -- right for a jurisdiction that charges and that this book satisfies by
  -- recording the position rather than by inventing a federal rate.
  ('US','us_country',null,null,'this_level_only',0,'federal_none','United States (federal)'),
  -- New York STATE, deliberately not covering 100-104. Those are New York
  -- County, whose combined 8.875% has its own book, and answering a Manhattan
  -- address with the state's 4% alone is the wrong number 001411 was written to
  -- prevent. The county book decomposes its rate by TAX CODE while the engine
  -- attributes by AUTHORITY, so until it is re-published per authority a
  -- Manhattan address reaches no authority and the determination refuses. A
  -- refusal is the correct failure; 4% is not.
  ('US-NY','us_state',105,149,'this_level_only',null,null,'New York State'),
  ('US-TX','us_state',750,799,'this_level_only',null,null,'Texas'),
  ('US-PA','us_state',150,196,'this_level_only',null,null,'Pennsylvania'),
  ('US-WA','us_state',980,994,'this_level_only',null,null,'Washington'),
  ('US-OH','us_state',430,459,'this_level_only',null,null,'Ohio'),
  ('US-CT','us_state',60,69,'whole_jurisdiction',null,null,'Connecticut'),
  -- Three states the fixture's own customers are in — Boston, Denver, Chicago —
  -- which had no book at all, so every determination for the demo dataset
  -- resolved nothing and refused.
  ('US-MA','us_state',10,27,'this_level_only',62500,'standard','Massachusetts'),
  ('US-CO','us_state',800,816,'this_level_only',29000,'standard','Colorado'),
  ('US-IL','us_state',600,629,'this_level_only',62500,'standard','Illinois')
)
insert into core_tax_rule_books (
  id, jurisdiction, version, status, effective_from, effective_to,
  rule_parameters, authority_reference, determination_source,
  input_provenance, subdivision_scope
)
select
  ('97600000-0000-4000-8000-' || lpad(row_number() over (order by place.jurisdiction)::text, 12, '0'))::uuid,
  place.jurisdiction,
  coalesce((select max(book.version) from core_tax_rule_books book
            where book.jurisdiction = place.jurisdiction), 0) + 1,
  'draft',
  '2026-08-01',
  null,
  coalesce(
    (select book.rule_parameters from core_tax_rule_books book
     where book.jurisdiction = place.jurisdiction and book.status = 'active'),
    '{}'::jsonb
  ) || jsonb_build_object('engine',
    case place.kind
      when 'us_state' then jsonb_build_object(
        'jurisdictions', jsonb_build_array(jsonb_build_object(
          'id', place.jurisdiction, 'territoryId', 'US', 'level', 'state',
          'sequence', 0, 'effectiveFrom', '2026-08-01',
          'postalPrefixes', (
            select jsonb_agg(lpad(prefix::text, 3, '0') order by prefix)
            from generate_series(place.prefix_lo, place.prefix_hi) prefix
          )
        )),
        'thresholds', jsonb_build_array(jsonb_build_object(
          'jurisdictionId', place.jurisdiction, 'currency', 'USD',
          'amountMinor', '10000000', 'periodMonths', 12,
          'basis', 'Repository fixture: economic nexus threshold for ' || place.authority
        )),
        'rateKindTreatments', jsonb_build_object('standard', 'standard')
      )
      when 'us_country' then jsonb_build_object(
        'territory', jsonb_build_object(
          'id', 'US', 'country', 'US', 'sourcing', 'destination',
          'rounding', 'line', 'effectiveFrom', '2026-08-01',
          'exportOfServices', jsonb_build_object(
            'treatment', 'out_of_scope', 'rateKind', 'none',
            'legalBasis', 'Repository fixture: a service supplied to a customer outside the United States is outside the scope of state sales tax'
          )
        ),
        'schemes', jsonb_build_array(jsonb_build_object(
          'id', 'sales_tax', 'scope', 'territory', 'territories', jsonb_build_array('US'),
          'admitsReverseCharge', false
        )),
        'notations', jsonb_build_array(
          jsonb_build_object('treatment', 'not_registered', 'territoryId', 'US',
            'text', 'No sales tax charged: the supplier holds no registration in this jurisdiction'),
          jsonb_build_object('treatment', 'out_of_scope', 'territoryId', 'US',
            'text', 'Outside the scope of United States state sales tax')
        ),
        'rateKindTreatments', jsonb_build_object(
          'standard', 'standard', 'federal_none', 'out_of_scope'
        )
      )
      else jsonb_build_object(
        'territory', jsonb_build_object(
          'id', place.jurisdiction, 'country', place.jurisdiction,
          'sourcing', 'destination', 'rounding', 'line',
          'effectiveFrom', '2026-08-01',
          'exportOfServices', jsonb_build_object(
            'treatment', 'out_of_scope', 'rateKind', 'none',
            'legalBasis', 'Repository fixture: a service supplied to a business customer outside the regime is outside its scope'
          )
        ) || case when place.kind = 'eu_country'
               then jsonb_build_object('unionId', 'eu-vat') else '{}'::jsonb end,
        'jurisdictions', jsonb_build_array(jsonb_build_object(
          'id', place.jurisdiction, 'territoryId', place.jurisdiction,
          'level', 'country', 'sequence', 0, 'effectiveFrom', '2026-08-01'
        )),
        'unions', case when place.kind = 'eu_country' then jsonb_build_array(
          jsonb_build_object('id', 'eu-vat', 'reverseCharge', jsonb_build_array(
            jsonb_build_object('supplyType', 'service', 'available', true,
              'legalBasis', 'Repository fixture: cross-border business services are accounted for by the customer'),
            jsonb_build_object('supplyType', 'digital_service', 'available', true,
              'legalBasis', 'Repository fixture: cross-border business services are accounted for by the customer'),
            jsonb_build_object('supplyType', 'goods', 'available', false,
              'legalBasis', 'Repository fixture: cross-border goods follow their own regime and are not reverse charged here')
          ))
        ) else '[]'::jsonb end,
        'schemes', jsonb_build_array(jsonb_build_object(
          'id', 'vat', 'scope', 'territory',
          'territories', jsonb_build_array(place.jurisdiction),
          'admitsReverseCharge', true
        )) || case when place.kind = 'eu_country' then jsonb_build_array(
          jsonb_build_object('id', 'vat_oss', 'scope', 'union', 'unionId', 'eu-vat',
            'territories', '[]'::jsonb, 'admitsReverseCharge', true)
        ) else '[]'::jsonb end,
        'notations', jsonb_build_array(
          jsonb_build_object('treatment', 'reverse_charge', 'territoryId', place.jurisdiction,
            'text', 'Reverse charge: the customer accounts for the tax on this supply'),
          jsonb_build_object('treatment', 'not_registered', 'territoryId', place.jurisdiction,
            'text', 'No tax charged: the supplier holds no registration in this jurisdiction'),
          jsonb_build_object('treatment', 'out_of_scope', 'territoryId', place.jurisdiction,
            'text', 'Outside the scope of this jurisdiction''s tax'),
          jsonb_build_object('treatment', 'zero_rated', 'territoryId', place.jurisdiction,
            'text', 'Zero-rated supply')
        ),
        'rateKindTreatments', jsonb_build_object(
          'standard', 'standard', 'reduced', 'standard',
          'zero', 'zero_rated', 'exempt', 'exempt'
        )
      )
    end
  ),
  'Repository fixture: ' || place.authority
    || ' matrix with engine parameters, pending EXT-TAX-01 signature',
  'local', 'repository_fixture', place.subdivision_scope
from places place;

-- Rates carry forward unchanged from the predecessor: this version adds
-- parameters, not numbers, and a rate that moved while nobody was looking is
-- the thing the replay test exists to catch.
insert into core_tax_rates (
  id, tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis, notation
)
select
  ('97800000-0000-4000-8000-' || lpad(row_number() over (
     order by successor.jurisdiction, rate.tax_code)::text, 12, '0'))::uuid,
  successor.id, rate.tax_code, rate.rate_kind, rate.rate_ppm,
  rate.legal_basis, rate.notation
from core_tax_rule_books successor
join core_tax_rule_books predecessor
  on predecessor.jurisdiction = successor.jurisdiction
 and predecessor.status = 'active'
join core_tax_rates rate on rate.tax_rule_book_id = predecessor.id
where successor.id between '97600000-0000-4000-8000-000000000001'::uuid
                       and '97600000-0000-4000-8000-000000000099'::uuid;

with places(jurisdiction, kind, prefix_lo, prefix_hi, subdivision_scope,
            new_rate_ppm, new_rate_kind, authority) as (values
  ('GB','vat_country',null::integer,null::integer,'whole_jurisdiction',null::bigint,null::text,'United Kingdom'),
  ('IE','eu_country',null,null,'whole_jurisdiction',null,null,'Ireland'),
  ('ES','eu_country',null,null,'whole_jurisdiction',null,null,'Spain'),
  ('DE','eu_country',null,null,'whole_jurisdiction',null,null,'Germany'),
  ('FR','eu_country',null,null,'whole_jurisdiction',null,null,'France'),
  ('NL','eu_country',null,null,'whole_jurisdiction',null,null,'Netherlands'),
  -- The United States at country level: a territory, an export rule and a
  -- registration scheme, and NO taxing authority of its own. There is no
  -- federal sales tax, and the rate row below says so with its basis because
  -- 001412 refuses to publish a book with no rates at all — a control that is
  -- right for a jurisdiction that charges and that this book satisfies by
  -- recording the position rather than by inventing a federal rate.
  ('US','us_country',null,null,'this_level_only',0,'federal_none','United States (federal)'),
  -- New York STATE, deliberately not covering 100-104. Those are New York
  -- County, whose combined 8.875% has its own book, and answering a Manhattan
  -- address with the state's 4% alone is the wrong number 001411 was written to
  -- prevent. The county book decomposes its rate by TAX CODE while the engine
  -- attributes by AUTHORITY, so until it is re-published per authority a
  -- Manhattan address reaches no authority and the determination refuses. A
  -- refusal is the correct failure; 4% is not.
  ('US-NY','us_state',105,149,'this_level_only',null,null,'New York State'),
  ('US-TX','us_state',750,799,'this_level_only',null,null,'Texas'),
  ('US-PA','us_state',150,196,'this_level_only',null,null,'Pennsylvania'),
  ('US-WA','us_state',980,994,'this_level_only',null,null,'Washington'),
  ('US-OH','us_state',430,459,'this_level_only',null,null,'Ohio'),
  ('US-CT','us_state',60,69,'whole_jurisdiction',null,null,'Connecticut'),
  -- Three states the fixture's own customers are in — Boston, Denver, Chicago —
  -- which had no book at all, so every determination for the demo dataset
  -- resolved nothing and refused.
  ('US-MA','us_state',10,27,'this_level_only',62500,'standard','Massachusetts'),
  ('US-CO','us_state',800,816,'this_level_only',29000,'standard','Colorado'),
  ('US-IL','us_state',600,629,'this_level_only',62500,'standard','Illinois')
)
insert into core_tax_rates (
  id, tax_rule_book_id, tax_code, rate_kind, rate_ppm, legal_basis, notation
)
select
  ('97810000-0000-4000-8000-' || lpad(row_number() over (
     order by book.jurisdiction)::text, 12, '0'))::uuid,
  book.id,
  case when place.kind = 'us_country' then 'txcd_federal' else 'txcd_demo' end,
  place.new_rate_kind, place.new_rate_ppm,
  case when place.kind = 'us_country'
    then 'Repository fixture: the United States levies no federal sales tax; authority is held by the states and each publishes its own book'
    else 'Repository fixture: ' || place.authority || ' state rate' end,
  ''
from places place
join core_tax_rule_books book
  on book.jurisdiction = place.jurisdiction
 and book.id between '97600000-0000-4000-8000-000000000001'::uuid
                 and '97600000-0000-4000-8000-000000000099'::uuid
where place.new_rate_ppm is not null;

-- Two different people per book, as 001412 requires of every publication.
insert into approvals (
  id, account_id, action, object_type, object_id, requested_by, approved_by,
  status, requested_at, decided_at
)
select
  ('97900000-0000-4000-8000-' || lpad(row_number() over (order by book.jurisdiction)::text, 12, '0'))::uuid,
  null, 'tax_rule_book_activation', 'tax_rule_book', book.id,
  '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
  'approved', '2026-07-31T15:00:00Z', '2026-07-31T15:30:00Z'
from core_tax_rule_books book
where book.id between '97600000-0000-4000-8000-000000000001'::uuid
                  and '97600000-0000-4000-8000-000000000099'::uuid;

-- The predecessor's window closes on the day the successor's opens. Half-open,
-- so a supply on 2026-08-01 belongs to the successor and to nothing else, and a
-- supply before it still resolves the book that was in force.
update core_tax_rule_books predecessor
set effective_to = '2026-08-01'
where predecessor.status = 'active'
  and predecessor.effective_to is null
  and exists (
    select 1 from core_tax_rule_books successor
    where successor.jurisdiction = predecessor.jurisdiction
      and successor.id between '97600000-0000-4000-8000-000000000001'::uuid
                           and '97600000-0000-4000-8000-000000000099'::uuid
  );

update core_tax_rule_books predecessor
set status = 'retired'
where predecessor.status = 'active'
  and predecessor.effective_to = '2026-08-01'
  and exists (
    select 1 from core_tax_rule_books successor
    where successor.jurisdiction = predecessor.jurisdiction
      and successor.id between '97600000-0000-4000-8000-000000000001'::uuid
                           and '97600000-0000-4000-8000-000000000099'::uuid
  );

update core_tax_rule_books set status = 'active'
where id between '97600000-0000-4000-8000-000000000001'::uuid
             and '97600000-0000-4000-8000-000000000099'::uuid;

insert into core_tax_rule_book_activation_events (
  id, tax_rule_book_id, action, previous_status, resulting_status,
  previous_provenance, resulting_provenance, effective_at,
  actor_user_id, reason, request_id
)
select
  ('97910000-0000-4000-8000-' || lpad(row_number() over (order by book.jurisdiction, book.version)::text, 12, '0'))::uuid,
  book.id,
  case when book.status = 'retired' then 'retire' else 'activate' end,
  case when book.status = 'retired' then 'active' else 'draft' end,
  book.status, null, null,
  case when book.status = 'retired' then '2026-08-01T00:00:00Z'::timestamptz
       else (book.effective_from || 'T00:00:00Z')::timestamptz end,
  '20000000-0000-4000-8000-000000000002',
  'Engine parameters added to the fixture matrix. Rates unchanged from the predecessor; provenance stays repository_fixture, so EXT-TAX-01 remains blocked.',
  'seed-2026-08-16'
from core_tax_rule_books book
where book.id between '97600000-0000-4000-8000-000000000001'::uuid
                  and '97600000-0000-4000-8000-000000000099'::uuid
   or (book.status = 'retired' and book.effective_to = '2026-08-01');


-- THE BINDING FOR THE FIXTURE'S OWN ORDERS, through the same function the
-- acceptance writer calls. A seed that inserted these rows directly would prove
-- nothing about the writer; this one fails if the writer is wrong.
select public.core_bind_order_selling_entity(o.id, o.immutable_at)
from orders o
where o.immutable_at is not null
order by o.id;

reset role;

-- THE SPANISH RESELLER'S OWN VAT NUMBER, which the fixture never carried.
--
-- Without it the engine reads Blue Harbor as a consumer — the rule that decides
-- a reverse charge is "a validated registration or no reverse charge", and an
-- absent number is not a validated one — so a supply to a Spanish RESELLER is
-- placed in Spain as a consumer digital service and comes back
-- `not_registered`. With it the same supply is business-to-business, leaves the
-- US regime under that territory's export rule, and is out of scope with the
-- customer accounting for its own tax. That is 001410's worked example landing
-- correctly, and the difference between the two answers is one row of stated
-- evidence rather than a line of code.
set role clockwork_service;
insert into core_account_tax_identifiers (
  id, account_id, jurisdiction, type, normalized_value, validation_status,
  verification_reference, reverse_charge_eligible, validated_at
) values (
  '97a00000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'ES', 'vat', 'ESX0000000B', 'valid',
  'fixture:vies:2026-07-31', true, '2026-07-31T16:00:00Z'
);
reset role;
