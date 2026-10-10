begin;
select plan(17);
set local search_path=public,extensions;

select has_column('public','invites','accepted_by','an invite records who accepted it');
select has_column('public','invites','invited_by','an invite records who sent it');

insert into accounts(id,legal_name,relationship_roles,registered_address,billing_contact,ap_contact,invoice_delivery_email,domain,country,currency)
values('019a44ae-0000-7000-8000-00000000a001','Invite Test Co.','{direct_client}','{"line1":"1 Way","city":"London","postalCode":"EC1A","country":"GB"}',
  '{"name":"Ada","email":"ada@invite-1463.test"}','{}','ada@invite-1463.test','invite-1463.test','GB','GBP');
insert into organizations(id,account_id,name,side)
values('019a44ae-0000-7000-8000-00000000b001','019a44ae-0000-7000-8000-00000000a001','Invite Test Co.','customer');
insert into commerce_users(id,workos_user_id,email,name)
values('019a44ae-0000-7000-8000-00000000c001','user_invite1463','ada@invite-1463.test','Ada');
insert into invites(id,organization_id,email,role,token_hash,expires_at)
values
  ('019a44ae-0000-7000-8000-00000000d001','019a44ae-0000-7000-8000-00000000b001','ada@invite-1463.test','owner',repeat('1',64),now() + interval '1 day'),
  ('019a44ae-0000-7000-8000-00000000d002','019a44ae-0000-7000-8000-00000000b001','ada@invite-1463.test','admin',repeat('2',64),now() - interval '1 minute'),
  ('019a44ae-0000-7000-8000-00000000d003','019a44ae-0000-7000-8000-00000000b001','bo@invite-1463.test','member',repeat('5',64),now() + interval '1 day');

select throws_ok($$update invites set accepted_at=now()
  where id='019a44ae-0000-7000-8000-00000000d001'$$,
  '23514',null,'an acceptance names who accepted');
select throws_ok($$update invites set accepted_at=now(), accepted_by='019a44ae-0000-7000-8000-00000000c001', role='member'
  where id='019a44ae-0000-7000-8000-00000000d001'$$,
  'P0001','INVITE_ACCEPTANCE_CHANGES_INVITE','accepting cannot change the role invited');
select throws_ok($$update invites set accepted_at=now(), accepted_by='019a44ae-0000-7000-8000-00000000c001'
  where id='019a44ae-0000-7000-8000-00000000d002'$$,
  'P0001','INVITE_EXPIRED','an expired invite cannot be accepted');
select lives_ok($$update invites set accepted_at=now(), accepted_by='019a44ae-0000-7000-8000-00000000c001', row_version=row_version+1
  where id='019a44ae-0000-7000-8000-00000000d001'$$,
  'a pending invite is accepted once');
select throws_ok($$update invites set accepted_at=now(), accepted_by='019a44ae-0000-7000-8000-00000000c001'
  where id='019a44ae-0000-7000-8000-00000000d001'$$,
  'P0001','INVITE_ALREADY_ACCEPTED','an accepted invite is not used again');
select throws_ok($$update invites set expires_at=now() + interval '30 days'
  where id='019a44ae-0000-7000-8000-00000000d001'$$,
  'P0001','INVITE_ALREADY_ACCEPTED','an accepted invite never changes');
select throws_ok($$update invites set expires_at=now() + interval '30 days'
  where id='019a44ae-0000-7000-8000-00000000d002'$$,
  'P0001','INVITE_EXPIRED','an expired invite is not revived');
select lives_ok($$update invites set expires_at=now() + interval '30 days'
  where id='019a44ae-0000-7000-8000-00000000d003'$$,
  'a pending invite can still be extended');
select lives_ok($$update invites set expires_at=now()
  where id='019a44ae-0000-7000-8000-00000000d003'$$,
  'a pending invite is revoked by ending it now');
select throws_ok($$update invites set expires_at=now() + interval '1 day'
  where id='019a44ae-0000-7000-8000-00000000d003'$$,
  'P0001','INVITE_EXPIRED','a revoked invite is not revived');

select throws_ok($$insert into invites(organization_id,email,role,token_hash,expires_at,accepted_at,accepted_by)
  values('019a44ae-0000-7000-8000-00000000b001','ada@invite-1463.test','owner',repeat('3',64),now() + interval '1 day',
    now(),'019a44ae-0000-7000-8000-00000000c001')$$,
  'P0001','INVITE_ACCEPTED_ON_INSERT','an invite cannot be created already accepted');
select ok(not has_column_privilege('clockwork_runtime','public.invites','email','UPDATE')
  and not has_column_privilege('clockwork_runtime','public.invites','role','UPDATE')
  and not has_column_privilege('clockwork_runtime','public.invites','token_hash','UPDATE')
  and not has_column_privilege('clockwork_runtime','public.invites','organization_id','UPDATE'),
  'tenant administrators cannot re-address, re-role or re-key an invite');
select ok(has_column_privilege('clockwork_runtime','public.invites','expires_at','UPDATE')
  and has_column_privilege('clockwork_runtime','public.invites','accepted_at','UPDATE'),
  'tenant administrators can still end or accept a pending invite');
set local role clockwork_runtime;
select throws_ok($$update invites set email='mallory@invite-1463.test'
  where id='019a44ae-0000-7000-8000-00000000d002'$$,
  '42501',null,'the runtime pool cannot change who an invite is for');
select throws_ok($$update invites set role='owner', token_hash=repeat('4',64)
  where id='019a44ae-0000-7000-8000-00000000d002'$$,
  '42501',null,'the runtime pool cannot change an invite''s role or token');
reset role;

select * from finish();
rollback;
