begin;
select plan(15);
set local search_path=public,extensions;
select is(core_current_channel_policy()->>'source','legacy_defaults','absence of approved policy retains explicit legacy defaults');
insert into core_channel_policy_versions(id,terms,created_by,last_edited_by) values('99000000-0000-4000-8000-000000001431',
 jsonb_build_object('version',1,'effectiveFrom',current_date::text,'selfServeThresholdTb',250,'defaultProtectionDays',30,'maximumProtectionDays',60,'extensionDays',30,'maximumExtensions',1,'sourceEvidence','reviewed-channel-program'),
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
select throws_ok($$insert into core_channel_policy_versions(terms,created_by,last_edited_by)
 select jsonb_set(terms,'{version}','null'),'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001' from core_channel_policy_versions$$,'23514',null,'null policy controls cannot bypass constraints');
update core_channel_policy_versions set status='proposed',proposed_by=created_by,row_version=2 where id='99000000-0000-4000-8000-000000001431';
select throws_ok($$update core_channel_policy_versions set status='approved',approved_by='20000000-0000-4000-8000-000000000002',approval_evidence='signed-policy',terms=jsonb_set(terms,'{selfServeThresholdTb}','500'),row_version=3 where id='99000000-0000-4000-8000-000000001431'$$,'P0001','CHANNEL_POLICY_PROPOSED_CONTENT_IMMUTABLE','proposed controls cannot change during approval');
select throws_ok($$update core_channel_policy_versions set status='approved',approved_by=created_by,approval_evidence='signed-policy',row_version=3 where id='99000000-0000-4000-8000-000000001431'$$,'23514',null,'policy creator cannot approve their own version');
select lives_ok($$update core_channel_policy_versions set status='approved',approved_by='20000000-0000-4000-8000-000000000002',approval_evidence='signed-policy',row_version=3 where id='99000000-0000-4000-8000-000000001431'$$,'distinct approval publishes effective controls');
select is((core_current_channel_policy()->>'selfServeThresholdTb')::integer,250,'new requests resolve approved threshold');
select throws_ok($$insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at)
 values('94000000-0000-4000-8000-000000001432','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Policy test',1,'registered',now(),now()+interval '61 days')$$,
 'P0001','REGISTRATION_POLICY_PROTECTION_MAXIMUM','caller cannot request beyond the approved maximum');
insert into deal_registrations(id,partner_account_id,end_client_account_id,workload,expected_volume,status,protection_starts_at,protection_ends_at,channel_policy_snapshot,policy_extension_count)
 values('94000000-0000-4000-8000-000000001431','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Policy test',1,'registered',now(),now()+interval '30 days','{"source":"legacy_defaults"}',999);
select is((select channel_policy_snapshot->>'policyId' from deal_registrations where id='94000000-0000-4000-8000-000000001431'),'99000000-0000-4000-8000-000000001431','server overwrites forged policy snapshot with approved source');
select throws_ok($$update core_channel_policy_versions set terms=jsonb_set(terms,'{defaultProtectionDays}','60'),row_version=4 where id='99000000-0000-4000-8000-000000001431'$$,'P0001','CHANNEL_POLICY_IMMUTABLE','approved policy cannot rewrite existing economics');
insert into core_channel_policy_versions(id,terms,created_by,last_edited_by)
 select '99000000-0000-4000-8000-000000001432',terms||jsonb_build_object('version',2,'effectiveFrom',(current_date+1)::text,'selfServeThresholdTb',500),created_by,last_edited_by from core_channel_policy_versions where id='99000000-0000-4000-8000-000000001431';
update core_channel_policy_versions set status='proposed',proposed_by=created_by,row_version=2 where id='99000000-0000-4000-8000-000000001432';
update core_channel_policy_versions set status='approved',approved_by='20000000-0000-4000-8000-000000000002',approval_evidence='signed-future',row_version=3 where id='99000000-0000-4000-8000-000000001432';
select is((core_current_channel_policy()->>'selfServeThresholdTb')::integer,250,'future approved policy does not change current requests');
select throws_ok($$update deal_registrations set protection_ends_at=protection_ends_at+interval '30 days' where id='94000000-0000-4000-8000-000000001431'$$,'P0001','REGISTRATION_POLICY_EXTENSION_LIMIT_OR_REASON','extension requires documented progress');
update deal_registrations set protection_ends_at=protection_ends_at+interval '30 days',extension_reason='Documented sales progress' where id='94000000-0000-4000-8000-000000001431';
select is((select policy_extension_count from deal_registrations where id='94000000-0000-4000-8000-000000001431'),1,'allowed extension increments captured-policy count');
select throws_ok($$update deal_registrations set protection_ends_at=protection_ends_at+interval '1 day',extension_reason='Another progress report' where id='94000000-0000-4000-8000-000000001431'$$,'P0001','REGISTRATION_POLICY_EXTENSION_LIMIT_OR_REASON','maximum extensions cannot be reset by a later request');
select throws_ok($$update deal_registrations set channel_policy_snapshot='{"source":"legacy_defaults"}' where id='94000000-0000-4000-8000-000000001431'$$,'P0001','REGISTRATION_CHANNEL_POLICY_IMMUTABLE','registration snapshot cannot be replaced to evade its controls');
select is((select channel_policy_snapshot->>'source' from deal_registrations where id='94000000-0000-4000-8000-000000000001'),'legacy_defaults','new program does not rewrite earlier registration snapshots');
select * from finish();
rollback;
