begin;
select plan(25);
set local search_path=public,extensions;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_access_tokens'::regclass),
  'access tokens force row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_access_tokens','SELECT'),
  'customer identities cannot read access tokens');
select ok(not has_table_privilege('authenticated','public.commerce_access_tokens','SELECT')
  and not has_table_privilege('anon','public.commerce_access_tokens','INSERT'),
  'authenticated and anonymous callers have no access');
select ok(has_table_privilege('clockwork_service','public.commerce_access_tokens','SELECT')
  and has_table_privilege('clockwork_service','public.commerce_access_tokens','INSERT'),
  'the service role creates and reads tokens');
select ok(not has_table_privilege('clockwork_service','public.commerce_access_tokens','DELETE'),
  'tokens are never deleted');
select ok(not has_column_privilege('clockwork_service','public.commerce_access_tokens','token_hash','UPDATE')
  and not has_column_privilege('clockwork_service','public.commerce_access_tokens','scope','UPDATE')
  and not has_column_privilege('clockwork_service','public.commerce_access_tokens','expires_at','UPDATE')
  and not has_column_privilege('clockwork_service','public.commerce_access_tokens','user_id','UPDATE'),
  'the service role cannot change what a token is');
select ok(has_column_privilege('clockwork_service','public.commerce_access_tokens','revoked_at','UPDATE')
  and has_column_privilege('clockwork_service','public.commerce_access_tokens','last_used_at','UPDATE'),
  'the service role records use and revocation');
select is((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'commerce_access_tokens'
    and (column_name like '%secret%' or column_name = 'token')),
  null, 'no column holds a secret');
select is((select data_type::text from information_schema.columns
  where table_schema = 'public' and table_name = 'commerce_access_tokens' and column_name = 'token_hash'),
  'bytea', 'the token is stored as a hash');

-- A staff member of their own for this test, so removing the membership
-- touches no seeded row.
insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
values ('019a44ae-0000-7000-8000-0000000d0001','pgtap_token_staff','token.staff@clockwork.test','Token Staff',true,true);
insert into memberships (id, organization_id, user_id, role)
values ('019a44ae-0000-7000-8000-0000000d0002','30000000-0000-4000-8000-000000000008','019a44ae-0000-7000-8000-0000000d0001','revenue');

set local role clockwork_service;
select lives_ok($$insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,mfa_factor_id,expires_at)
  values('019a44ae-0000-7000-8000-0000000e0001','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Claude Code','read_write','fo_pat_abcd',sha256('fo_pat_one'::bytea),'factor_a',now() + interval '90 days')$$,
  'a token is created with its hash');
select throws_ok($$insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,expires_at)
  values('019a44ae-0000-7000-8000-0000000e0002','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Short','read','fo_pat_abcd','\x0102'::bytea,now() + interval '90 days')$$,
  '23514',null,'only a 32-byte hash is stored');
select throws_ok($$insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,expires_at)
  values('019a44ae-0000-7000-8000-0000000e0002','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Whole secret','read','fo_pat_abcdefghijklmnop',sha256('fo_pat_two'::bytea),now() + interval '90 days')$$,
  '23514',null,'the display prefix cannot carry the secret');
select throws_ok($$insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,expires_at)
  values('019a44ae-0000-7000-8000-0000000e0002','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Forever','read','fo_pat_abcd',sha256('fo_pat_two'::bytea),now() + interval '400 days')$$,
  '23514',null,'a token expires within a year');
select throws_ok($$insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,expires_at)
  values('019a44ae-0000-7000-8000-0000000e0002','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Admin','admin','fo_pat_abcd',sha256('fo_pat_two'::bytea),now() + interval '90 days')$$,
  '23514',null,'a token is read or read_write, nothing else');
select lives_ok($$update commerce_access_tokens set revoked_at=now(), revoked_reason='owner',
  revoked_by_id='019a44ae-0000-7000-8000-0000000d0001', version=2
  where id='019a44ae-0000-7000-8000-0000000e0001'$$,
  'a token is revoked');
select throws_ok($$update commerce_access_tokens set revoked_at=null, revoked_reason=null, version=3
  where id='019a44ae-0000-7000-8000-0000000e0001'$$,
  'P0001','ACCESS_TOKEN_REVOKED','a revoked token never comes back');
insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,mfa_factor_id,expires_at)
values('019a44ae-0000-7000-8000-0000000e0003','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Factor A','read','fo_pat_efgh',sha256('fo_pat_three'::bytea),'factor_a',now() + interval '90 days'),
('019a44ae-0000-7000-8000-0000000e0004','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'No factor','read','fo_pat_ijkl',sha256('fo_pat_four'::bytea),null,now() + interval '90 days');
reset role;

-- A verification with the same authenticator keeps that token; one created
-- under no known authenticator does not survive a verification.
insert into experience_mfa_receipts (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('pgtap_challenge_1','pgtap_session','pgtap_token_staff','org_pgtap','factor_a');
select is((select revoked_at from commerce_access_tokens where id='019a44ae-0000-7000-8000-0000000e0003'),
  null, 'the same authenticator keeps the token');
select is((select revoked_reason from commerce_access_tokens where id='019a44ae-0000-7000-8000-0000000e0004'),
  'mfa_reset', 'a token created under no known authenticator is revoked at the next verification');

-- A different authenticator means the factor was reset.
insert into experience_mfa_receipts (challenge_id, session_id, workos_user_id, workos_organization_id, factor_id)
values ('pgtap_challenge_2','pgtap_session','pgtap_token_staff','org_pgtap','factor_b');
select is((select count(*)::int from commerce_access_tokens
  where user_id='019a44ae-0000-7000-8000-0000000d0001' and revoked_reason='mfa_reset'),
  2, 'tokens created under the old authenticator are revoked');
select is((select count(*)::int from audit_events
  where aggregate_type='access_token' and event_type='access_token.revoked'
    and aggregate_id in ('019a44ae-0000-7000-8000-0000000e0003','019a44ae-0000-7000-8000-0000000e0004')),
  2, 'each revocation is audited');

set local role clockwork_service;
insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,mfa_factor_id,expires_at)
values('019a44ae-0000-7000-8000-0000000e0005','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'After reset','read','fo_pat_mnop',sha256('fo_pat_five'::bytea),'factor_b',now() + interval '90 days');
reset role;
update commerce_users set mfa_enrolled = false where id = '019a44ae-0000-7000-8000-0000000d0001';
select is((select revoked_reason from commerce_access_tokens where id='019a44ae-0000-7000-8000-0000000e0005'),
  'mfa_reset', 'a person no longer enrolled in MFA loses their tokens');

update commerce_users set mfa_enrolled = true where id = '019a44ae-0000-7000-8000-0000000d0001';
set local role clockwork_service;
insert into commerce_access_tokens(id,user_id,organization_id,name,scope,token_prefix,token_hash,mfa_factor_id,expires_at)
values('019a44ae-0000-7000-8000-0000000e0006','019a44ae-0000-7000-8000-0000000d0001','30000000-0000-4000-8000-000000000008',
  'Before removal','read_write','fo_pat_qrst',sha256('fo_pat_six'::bytea),'factor_b',now() + interval '90 days');
reset role;
delete from memberships where id = '019a44ae-0000-7000-8000-0000000d0002';
select is((select revoked_reason from commerce_access_tokens where id='019a44ae-0000-7000-8000-0000000e0006'),
  'membership_removed', 'removing the staff membership revokes the token');
select is((select actor->>'kind' from audit_events
  where aggregate_type='access_token' and aggregate_id='019a44ae-0000-7000-8000-0000000e0006'
    and event_type='access_token.revoked'),
  'system', 'the revocation is recorded as the system''s');
select is((select revoked_reason from commerce_access_tokens where id='019a44ae-0000-7000-8000-0000000e0001'),
  'owner', 'an already revoked token keeps its first revocation');
select is((select count(*)::int from commerce_access_tokens
  where user_id='019a44ae-0000-7000-8000-0000000d0001' and revoked_at is null),
  0, 'the person has no live tokens left');

select * from finish();
rollback;
