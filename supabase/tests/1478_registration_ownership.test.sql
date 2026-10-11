begin;
select plan(22);
set local search_path = public, extensions;

-- 1. Registrations start registered or rejected, and their identity is fixed.
select throws_ok($$insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at)
  values('94000000-0000-4000-8000-000000001478','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Inserted approved',1,'approved',now(),now()+interval '30 days')$$,
  '23514', 'REGISTRATION_MUST_START_REGISTERED', 'a registration cannot be inserted already approved');
select throws_ok($$insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at)
  values('94000000-0000-4000-8000-000000001479','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Inserted converted',1,'converted',now(),now()+interval '30 days')$$,
  '23514', 'REGISTRATION_MUST_START_REGISTERED', 'a registration cannot be inserted already converted');
select throws_ok($$update deal_registrations set workload = 'A different opportunity' where id = '94000000-0000-4000-8000-000000000003'$$,
  '23514', 'REGISTRATION_IDENTITY_IMMUTABLE', 'the workload is fixed after creation');
select throws_ok($$update deal_registrations set partner_account_id = '10000000-0000-4000-8000-000000000006' where id = '94000000-0000-4000-8000-000000000003'$$,
  '23514', 'REGISTRATION_IDENTITY_IMMUTABLE', 'the partner is fixed after creation');
select throws_ok($$update deal_registrations set end_client_account_id = '10000000-0000-4000-8000-000000000001' where id = '94000000-0000-4000-8000-000000000003'$$,
  '23514', 'REGISTRATION_IDENTITY_IMMUTABLE', 'the end client is fixed after creation');

-- 2a. A converted registration owns its workload only within the lookback.
-- Legacy defaults: the 90-day default protection window.
update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000002'
  where id = '94000000-0000-4000-8000-000000000001';
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001480','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Referral archive modernization',1,'registered',now(),now()+interval '30 days');
select throws_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001480'$$,
  '23514', 'REGISTRATION_ECONOMIC_OWNER_EXISTS', 'a recent conversion still owns the workload');
update deal_registrations set decided_at = now() - interval '91 days' where id = '94000000-0000-4000-8000-000000000001';
select lives_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001480'$$,
  'a conversion older than the default lookback no longer blocks another partner');

-- 2b. The same partner is never its own competing owner: a renewal of a
-- converted registration on the same workload is approved.
update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000005'
  where id = '94000000-0000-4000-8000-000000000004';
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001481','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','white-label embedded archive ',1,'registered',now(),now()+interval '30 days');
select lives_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001481'$$,
  'the same partner renews its converted workload');
select lives_ok($$insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at)
  values('94000000-0000-4000-8000-000000001482','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000004','Expansion workload',1,'registered',now(),now()+interval '30 days')$$,
  'the same partner registers another workload on the same client');

-- 2c. An approved registration owns its workload only while protected.
update deal_registrations set protection_ends_at = now() + interval '30 days' where id = '94000000-0000-4000-8000-000000000005';
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001483','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Marketplace archive listing',1,'registered',now(),now()+interval '30 days');
select throws_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001483'$$,
  '23514', 'REGISTRATION_ECONOMIC_OWNER_EXISTS', 'a protected approval owns the workload');
update deal_registrations set protection_ends_at = now() - interval '1 day' where id = '94000000-0000-4000-8000-000000000005';
select lives_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001483'$$,
  'an approval past its protection window no longer blocks another partner');

-- 2e. Extensions (legacy-default snapshots, before a policy is approved). A lapsed registration cannot be extended back to life (A
-- lapses, B is approved, A must not return beside B), and an approved one is
-- re-checked for a competing owner when its window moves forward.
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001486','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Lapse extension check',1,'registered',now(),now()+interval '30 days'),
  ('94000000-0000-4000-8000-000000001487','10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000004','Lapse extension check',1,'registered',now(),now()+interval '30 days');
update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001486';
update deal_registrations set protection_ends_at = now() - interval '1 day' where id = '94000000-0000-4000-8000-000000001486';
update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001487';
select throws_ok($$update deal_registrations set protection_ends_at = now() + interval '30 days' where id = '94000000-0000-4000-8000-000000001486'$$,
  '23514', 'REGISTRATION_PROTECTION_LAPSED', 'a lapsed owner cannot extend itself back beside the new one');
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001488','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Extension owner check',1,'registered',now(),now()+interval '30 days'),
  ('94000000-0000-4000-8000-000000001489','10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000004','Extension owner check',1,'registered',now(),now()+interval '30 days');
update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001488';
update deal_registrations set status = 'disputed' where id = '94000000-0000-4000-8000-000000001489';
select throws_ok($$update deal_registrations set protection_ends_at = protection_ends_at + interval '30 days' where id = '94000000-0000-4000-8000-000000001488'$$,
  '23514', 'REGISTRATION_ECONOMIC_OWNER_EXISTS', 'an extension is refused while another partner owns the workload');
update deal_registrations set status = 'rejected' where id = '94000000-0000-4000-8000-000000001489';
select lives_ok($$update deal_registrations set protection_ends_at = protection_ends_at + interval '30 days' where id = '94000000-0000-4000-8000-000000001488'$$,
  'a current approval with no competitor extends');

-- 2d. The lookback is a channel-policy term.
insert into core_channel_policy_versions(id,terms,created_by,last_edited_by) values('99000000-0000-4000-8000-000000001478',
 jsonb_build_object('version',1478,'effectiveFrom',current_date::text,'selfServeThresholdTb',100,'defaultProtectionDays',90,'maximumProtectionDays',90,'extensionDays',30,'maximumExtensions',1,'conversionLookbackDays',500,'sourceEvidence','conversion lookback policy'),
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
update core_channel_policy_versions set status='proposed',proposed_by=created_by,row_version=2 where id='99000000-0000-4000-8000-000000001478';
update core_channel_policy_versions set status='approved',approved_by='20000000-0000-4000-8000-000000000002',approval_evidence='signed-policy',row_version=3 where id='99000000-0000-4000-8000-000000001478';
select is((core_current_channel_policy()->>'conversionLookbackDays')::integer, 500, 'the current policy publishes its conversion lookback');
update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000004'
  where id = '94000000-0000-4000-8000-000000000003';
update deal_registrations set decided_at = now() - interval '400 days' where id = '94000000-0000-4000-8000-000000000003';
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001484','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Two-tier distributor archive',1,'registered',now(),now()+interval '30 days');
select throws_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001484'$$,
  '23514', 'REGISTRATION_ECONOMIC_OWNER_EXISTS', 'a 400-day-old conversion owns the workload under a 500-day lookback');
update deal_registrations set decided_at = now() - interval '501 days' where id = '94000000-0000-4000-8000-000000000003';
select lives_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001484'$$,
  'a conversion older than the policy lookback no longer blocks another partner');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
  select jsonb_set(jsonb_set(terms,'{version}','14781'),'{conversionLookbackDays}','0'),created_by,last_edited_by
  from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001478'$$, '23514', null,
  'a zero-day lookback is rejected');

-- 5. Decisions need decision authority on the tenant pool, whatever the row
-- policies admit: a partner cannot approve or dispute its own registration.
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001490','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Self decision check',1,'registered',now(),now()+interval '30 days');
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000005',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000006'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,'requestId','registration-self-decision-1478',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001490'$$,
  '42501', 'REGISTRATION_DECISION_AUTHORITY_REQUIRED', 'a partner cannot approve its own registration in SQL');
select throws_ok($$update deal_registrations set status = 'disputed' where id = '94000000-0000-4000-8000-000000001490'$$,
  '42501', 'REGISTRATION_DECISION_AUTHORITY_REQUIRED', 'a partner cannot dispute its way into blocking everyone');
reset role;

-- 3. A finance approver (quote:approve) passes the row-level update guard.
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
  ('94000000-0000-4000-8000-000000001485','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','Finance decision check',1,'registered',now(),now()+interval '30 days');
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000006'),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,'requestId','registration-ownership-1478',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select lives_ok($$update deal_registrations set status = 'rejected', decided_at = now()
  where id = '94000000-0000-4000-8000-000000001485'$$, 'a finance approver can send a registration decision');
reset role;
select is((select status from deal_registrations where id = '94000000-0000-4000-8000-000000001485'), 'rejected',
  'the finance decision reaches the row (the update guard admits quote:approve)');

select * from finish();
rollback;
