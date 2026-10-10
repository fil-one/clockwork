begin;
select plan(24);
set local search_path=public,extensions;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_handoff_requests'::regclass),
  'handoff requests force row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_handoff_requests','SELECT'),
  'customer identities cannot read handoffs');
select ok(not has_table_privilege('authenticated','public.commerce_handoff_requests','SELECT'),
  'authenticated cannot read handoffs');
select ok(not has_table_privilege('anon','public.commerce_handoff_requests','INSERT'),
  'anonymous callers cannot raise handoffs');
select ok(has_table_privilege('clockwork_service','public.commerce_handoff_requests','UPDATE'),
  'the service role moves handoffs');
select ok(not has_table_privilege('clockwork_service','public.commerce_handoff_requests','DELETE'),
  'handoffs are never deleted');

set local role clockwork_service;
insert into commerce_contracts(id,counterparty_name,contract_type,paper,status,owner_name,created_by_id,created_by_name)
values
  ('019a44ad-0000-7000-8000-00000000c001','Acme, Inc.','customer_msa','ours','executed','R.W.','019a44ad-0000-7000-8000-00000000a001','R.W.'),
  ('019a44ad-0000-7000-8000-00000000c002','Acme, Inc.','order_form','ours','out_for_signature','R.W.','019a44ad-0000-7000-8000-00000000a001','R.W.'),
  ('019a44ad-0000-7000-8000-00000000c003','Globex','customer_msa','theirs','executed','R.W.','019a44ad-0000-7000-8000-00000000a001','R.W.');
insert into commerce_mnda_requests(id,input,countersigner,owner_id,owner_name,state,template_hash,test_mode)
values
  ('019a44ad-0000-7000-8000-00000000d001','{"company":"Acme, Inc."}','{}','019a44ad-0000-7000-8000-00000000a001','R.W.','completed',repeat('a',64),true),
  ('019a44ad-0000-7000-8000-00000000d002','{"company":"Acme, Inc."}','{}','019a44ad-0000-7000-8000-00000000a001','R.W.','sent',repeat('a',64),true);

select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c002']::uuid[],'customer')$$,
  'P0001','HANDOFF_CONTRACT_NOT_SIGNED','a contract out for signature cannot be handed off');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c001','019a44ad-0000-7000-8000-00000000c001']::uuid[],'customer')$$,
  'P0001','HANDOFF_CONTRACT_REPEATED','a contract is named once');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,mnda_id,requested_side)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c001']::uuid[],'019a44ad-0000-7000-8000-00000000d002','customer')$$,
  'P0001','HANDOFF_MNDA_NOT_COMPLETED','only a completed MNDA is attached');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,pricing_scenario_id,requested_side)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c001']::uuid[],'019a44ad-0000-7000-8000-00000000f009','customer')$$,
  'P0001','HANDOFF_PRICING_SCENARIO_NOT_FOUND','an attached scenario exists');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side,status,assignee_id,assignee_name)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c001']::uuid[],'customer','in_progress','019a44ad-0000-7000-8000-00000000a002','Ops')$$,
  'P0001','HANDOFF_REQUEST_MUST_START_OPEN','a request starts open');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','not-an-email',
  array['019a44ad-0000-7000-8000-00000000c001']::uuid[],'customer')$$,
  '23514',null,'the signer email is an address');
select lives_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,mnda_id,requested_side,notes)
  values('019a44ad-0000-7000-8000-00000000e001','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c001']::uuid[],'019a44ad-0000-7000-8000-00000000d001','customer','Starts in November')$$,
  'a seller hands an executed contract to operations');
select throws_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e002','019a44ad-0000-7000-8000-00000000a001','R.W.','Acme, Inc.','Pat Lee','pat@acme.test',
  array['019a44ad-0000-7000-8000-00000000c003','019a44ad-0000-7000-8000-00000000c001']::uuid[],'customer')$$,
  'P0001','HANDOFF_ALREADY_REQUESTED','a contract is in one live request at a time');
select throws_ok($$update commerce_handoff_requests set status='done', decided_at=now(), decided_by_id='019a44ad-0000-7000-8000-00000000a002', version=2
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'P0001','HANDOFF_TRANSITION_INVALID','an open request is taken before it is done');
select throws_ok($$update commerce_handoff_requests set status='in_progress', assignee_id='019a44ad-0000-7000-8000-00000000a002', assignee_name='Ops'
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'P0001','HANDOFF_VERSION_MUST_ADVANCE','every change advances the version');
select throws_ok($$update commerce_handoff_requests set notes='Changed', version=2
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'P0001','HANDOFF_REQUEST_IMMUTABLE','what the seller asked for never changes');
select lives_ok($$update commerce_handoff_requests set status='in_progress', assignee_id='019a44ad-0000-7000-8000-00000000a002', assignee_name='Ops', version=2
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'operations takes the request');
select throws_ok($$update commerce_handoff_requests set status='declined', decided_at=now(), decided_by_id='019a44ad-0000-7000-8000-00000000a002', version=3
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  '23514',null,'a decline carries a note');
select lives_ok($$update commerce_handoff_requests set status='done', decided_at=now(), decided_by_id='019a44ad-0000-7000-8000-00000000a002', version=3
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'operations completes the request');
select throws_ok($$update commerce_handoff_requests set status='declined', decision_note='Too late', version=4
  where id='019a44ad-0000-7000-8000-00000000e001'$$,
  'P0001','HANDOFF_REQUEST_CLOSED','a completed request is final');
select lives_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e003','019a44ad-0000-7000-8000-00000000a001','R.W.','Globex','Sam Roe','sam@globex.test',
  array['019a44ad-0000-7000-8000-00000000c003']::uuid[],'partner')$$,
  'a partner handoff is raised');
select lives_ok($$update commerce_handoff_requests set status='declined', decision_note='Wrong entity', decided_at=now(), decided_by_id='019a44ad-0000-7000-8000-00000000a002', version=2
  where id='019a44ad-0000-7000-8000-00000000e003'$$,
  'operations declines an open request with a note');
select lives_ok($$insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side)
  values('019a44ad-0000-7000-8000-00000000e004','019a44ad-0000-7000-8000-00000000a001','R.W.','Globex Ltd','Sam Roe','sam@globex.test',
  array['019a44ad-0000-7000-8000-00000000c003']::uuid[],'partner')$$,
  'a declined contract can be handed off again');
reset role;

select * from finish();
rollback;
