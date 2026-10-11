begin;
select plan(5);
set local search_path=public,extensions;

insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
values ('019a44ae-0000-7000-8000-0000000f0001','pgtap_current_factor','current.factor@clockwork.test','Current Factor',true,true);
select is((select access_token_mfa_factor_id from commerce_users
  where id='019a44ae-0000-7000-8000-0000000f0001'),null,
  'a person with no receipt has no current token factor');

set local role clockwork_service;
insert into experience_mfa_receipts (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('pgtap_current_factor_1','pgtap_old_session','pgtap_current_factor','org_pgtap','factor_old');
select is((select access_token_mfa_factor_id from commerce_users
  where id='019a44ae-0000-7000-8000-0000000f0001'),'factor_old',
  'the first verified factor becomes current');
insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,mfa_factor_id,expires_at)
values('019a44ae-0000-7000-8000-0000000f0002','019a44ae-0000-7000-8000-0000000f0001','30000000-0000-4000-8000-000000000008',
  'Before change','read','fo_pat_abcd',sha256('pgtap_current_factor_token'::bytea),'factor_old',now() + interval '90 days');
insert into experience_mfa_receipts (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('pgtap_current_factor_2','pgtap_new_session','pgtap_current_factor','org_pgtap','factor_new');
select is((select access_token_mfa_factor_id from commerce_users
  where id='019a44ae-0000-7000-8000-0000000f0001'),'factor_new',
  'a verification in another session replaces the current factor');
select is((select revoked_reason from commerce_access_tokens
  where id='019a44ae-0000-7000-8000-0000000f0002'),'mfa_reset',
  'the factor change still revokes the previous factor token');
select is((select count(*)::int from audit_events
  where aggregate_type='access_token' and aggregate_id='019a44ae-0000-7000-8000-0000000f0002'
  and event_type='access_token.revoked'),1,
  'the revocation remains audited');

reset role;
select * from finish();
rollback;
