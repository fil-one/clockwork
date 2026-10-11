begin;
select plan(17);
set local search_path=public,extensions;

-- Channel policy windows keep sanity bounds only.
select lives_ok($$insert into core_channel_policy_versions(id,terms,created_by,last_edited_by) values('99000000-0000-4000-8000-000000001468',
 jsonb_build_object('version',1468,'effectiveFrom',current_date::text,'selfServeThresholdTb',100,'defaultProtectionDays',365,'maximumProtectionDays',1095,'extensionDays',365,'maximumExtensions',7,'sourceEvidence','per-partner channel terms'),
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
 'a policy may protect a registration for three years with yearly extensions up to ten years in total');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
 select jsonb_set(jsonb_set(terms,'{version}','14681'),'{maximumProtectionDays}','3651'),created_by,last_edited_by
 from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001468'$$,'23514',null,
 'protection beyond ten years is still rejected as nonsense');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
 select jsonb_set(jsonb_set(terms,'{version}','14683'),'{maximumExtensions}','8'),created_by,last_edited_by
 from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001468'$$,'23514',null,
 'cumulative protection beyond ten years is rejected');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
 select jsonb_set(jsonb_set(terms,'{version}','14682'),'{maximumExtensions}','101'),created_by,last_edited_by
 from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001468'$$,'23514',null,
 'more than one hundred extensions is still rejected as nonsense');

-- A house-account match is review evidence on an open registration; a prior
-- deal still requires the refusal it records. The end client is a seeded
-- direct client no other test registers against.
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
 ('94000000-0000-4000-8000-000000001468','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000009','House review',1,'registered',now(),now()+interval '30 days'),
 ('94000000-0000-4000-8000-000000001469','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000009','Prior refusal',1,'rejected',now(),now()+interval '30 days');

select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000003',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('partner_admin'),'isInternalStaff',false,'requestId','channel-terms-1468',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;

select lives_ok($$insert into core_deal_registration_exclusions(registration_id,kind,matched_account_id,evidence,status)
 values('94000000-0000-4000-8000-000000001468','house_account','10000000-0000-4000-8000-000000000009',
 '{"source":"unified_account_and_active_deal_records"}','detected')$$,
 'a house-account match is recorded against an open registration');
select throws_ok($$insert into core_deal_registration_exclusions(registration_id,kind,matched_account_id,evidence,status)
 values('94000000-0000-4000-8000-000000001469','house_account','10000000-0000-4000-8000-000000000009',
 '{"source":"unified_account_and_active_deal_records"}','detected')$$,'42501',null,
 'a house-account match cannot be attached to a refused registration');
select throws_ok($$insert into core_deal_registration_exclusions(registration_id,kind,matched_account_id,evidence,status)
 values('94000000-0000-4000-8000-000000001468','prior_deal','10000000-0000-4000-8000-000000000009',
 '{"source":"unified_account_and_active_deal_records"}','detected')$$,'42501',null,
 'a prior-deal match still requires the refused registration it explains');
select lives_ok($$insert into core_deal_registration_exclusions(registration_id,kind,matched_account_id,evidence,status)
 values('94000000-0000-4000-8000-000000001469','prior_deal','10000000-0000-4000-8000-000000000009',
 '{"source":"unified_account_and_active_deal_records"}','detected')$$,
 'a prior-deal match is recorded against its refused registration');

-- Channel ops resolves the house-account match with its decision, through
-- the definer function; a partner cannot.
select throws_ok($$select core_resolve_house_account_match('94000000-0000-4000-8000-000000001468', 'Partner tries to self-clear')$$,
 '42501', 'HOUSE_ACCOUNT_DECISION_STAFF_ONLY', 'a partner cannot resolve its own house-account match');
reset role;
update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001468';
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('finance_approver'),'isInternalStaff',true,'requestId','channel-terms-1468-staff',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$select core_resolve_house_account_match('94000000-0000-4000-8000-000000001468', 'short')$$,
 '23514', 'HOUSE_ACCOUNT_OVERRIDE_REASON_REQUIRED', 'approving over a house-account match needs an override reason');
select is(core_resolve_house_account_match('94000000-0000-4000-8000-000000001468', 'Net-new build-out from the partner'), 1,
 'a reasoned approval clears the match');
reset role;
select is((select status || ':' || resolved_by::text || ':' || (evidence->'decision'->>'overrideReason')
  from core_deal_registration_exclusions
  where registration_id = '94000000-0000-4000-8000-000000001468' and kind = 'house_account'),
 'cleared:20000000-0000-4000-8000-000000000001:Net-new build-out from the partner',
 'the cleared match records the deciding staff user and the override reason');

-- One economic owner, and conversion only from an approval with a matching
-- order. 94..01 is the seeded approved referral registration (partner 0002,
-- end client 0004) and 80..02 its referral order.
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at) values
 ('94000000-0000-4000-8000-000000001470','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000004','referral archive modernization ',1,'registered',now(),now()+interval '30 days');
select throws_ok($$update deal_registrations set status = 'approved' where id = '94000000-0000-4000-8000-000000001470'$$,
 '23514', 'REGISTRATION_ECONOMIC_OWNER_EXISTS', 'a second partner cannot be approved on an owned client and workload');
select throws_ok($$update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000002'
  where id = '94000000-0000-4000-8000-000000001470'$$,
 '23514', 'REGISTRATION_CONVERT_REQUIRES_APPROVAL', 'an unapproved registration cannot be converted');
select throws_ok($$update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000003'
  where id = '94000000-0000-4000-8000-000000000001'$$,
 '23514', 'REGISTRATION_CONVERT_ORDER_MISMATCH', 'conversion needs an order for the same partner and end client');
select lives_ok($$update deal_registrations set status = 'converted', converted_order_id = '80000000-0000-4000-8000-000000000002'
  where id = '94000000-0000-4000-8000-000000000001'$$,
 'an approved registration converts to its own partner and end client order');
-- Staff without quote approval authority cannot resolve a match.
select set_config('app.authorization_context', jsonb_build_object(
  'userId','20000000-0000-4000-8000-000000000001',
  'accountIds',jsonb_build_array('10000000-0000-4000-8000-000000000002'),
  'roles',jsonb_build_array('internal_operator'),'isInternalStaff',true,'requestId','channel-terms-1468-operator',
  'expiresAt',(clock_timestamp() + interval '5 minutes')::text)::text, true);
select set_config('app.authorization_signature', encode(extensions.hmac(
  current_setting('app.authorization_context'),
  (select secret from private.authorization_secrets where active order by created_at desc limit 1),'sha256'),'hex'), true);
set local role clockwork_runtime;
set local search_path = public, extensions;
select throws_ok($$select core_resolve_house_account_match('94000000-0000-4000-8000-000000001468', 'A reason that is long enough')$$,
 '42501', 'HOUSE_ACCOUNT_DECISION_STAFF_ONLY', 'resolving a match needs quote approval authority');
reset role;

select * from finish();
rollback;
