begin;
select plan(7);
set local search_path=public,extensions;

-- Channel policy windows keep sanity bounds only.
select lives_ok($$insert into core_channel_policy_versions(id,terms,created_by,last_edited_by) values('99000000-0000-4000-8000-000000001468',
 jsonb_build_object('version',1468,'effectiveFrom',current_date::text,'selfServeThresholdTb',100,'defaultProtectionDays',365,'maximumProtectionDays',1095,'extensionDays',365,'maximumExtensions',20,'sourceEvidence','per-partner channel terms'),
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')$$,
 'a policy may protect a registration for three years with yearly extensions');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
 select jsonb_set(jsonb_set(terms,'{version}','14681'),'{maximumProtectionDays}','3651'),created_by,last_edited_by
 from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001468'$$,'23514',null,
 'protection beyond ten years is still rejected as nonsense');
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

select * from finish();
rollback;
