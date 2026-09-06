begin;
select plan(7);
set local search_path = public, extensions;

select is((select rate_bps from core_referral_commission_policy_snapshots where quote_id = '70000000-0000-4000-8000-000000000002'), 1200, 'referral quote captures the configured rate');
update accounts set commission_rate_bps = 2500 where id = '10000000-0000-4000-8000-000000000002';
select is((select rate_bps from core_referral_commission_policy_snapshots where quote_id = '70000000-0000-4000-8000-000000000002'), 1200, 'later account changes do not rewrite quote economics');
select throws_ok($$update core_referral_commission_policy_snapshots set rate_bps = 2500 where quote_id = '70000000-0000-4000-8000-000000000002'$$, '55000', 'quoted referral commission policy is immutable', 'even privileged writers cannot rewrite the snapshot');
select throws_ok($$delete from core_referral_commission_policy_snapshots where quote_id = '70000000-0000-4000-8000-000000000002'$$, '55000', 'quoted referral commission policy is immutable', 'snapshot cannot be removed to fall back to mutable rates');
insert into invoices (id, order_id, account_id, stripe_invoice_id, currency, amount_minor, tax_minor, tax_treatment, po_number, status) values
('90000000-0000-4000-8000-000000001426','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','in_policy_1426','USD',120000,0,'standard','PO-REF-002','open');
insert into payments (id, invoice_id, order_id, stripe_payment_intent_id, currency, amount_minor, status, received_at) values
('91000000-0000-4000-8000-000000001426','90000000-0000-4000-8000-000000001426','80000000-0000-4000-8000-000000000002','pi_policy_1426','USD',120000,'succeeded','2026-08-01T16:00:00Z');
select lives_ok($$insert into commission_accruals (id, partner_account_id, invoice_id, source_type, source_id, rate_bps, holdback_bps, currency, net_collected_revenue_minor, amount_minor, holdback_minor, period, status) values
('92000000-0000-4000-8000-000000001426','10000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000001426','payment','91000000-0000-4000-8000-000000001426',1200,1000,'USD',120000,14400,1440,'2026-Q3','accrued')$$, 'payment uses quote snapshot after the partner account rate changes');
select is((select rate_bps from core_referral_commission_policy_snapshots where quote_id = '70000000-0000-4000-8000-000000000003'), null::integer, 'non-referral partner quote captures explicit ineligible economics rather than looking legacy');
insert into quotes (id,account_id,price_book_id,series_id,revision,status,currency,total_minor,margin_floor_result,expires_at,created_by) values ('70000000-0000-4000-8000-000000001426','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','70100000-0000-4000-8000-000000001426',1,'draft','USD',100,'pass','2026-12-31T00:00:00Z','20000000-0000-4000-8000-000000000001');
select throws_ok($$update quotes set partner_account_id = '10000000-0000-4000-8000-000000000002' where id = '70000000-0000-4000-8000-000000001426'$$,'55000','quote chain identity and evidence timestamps are immutable','new direct quotes cannot bypass snapshots by acquiring a partner later');
select * from finish();
rollback;
