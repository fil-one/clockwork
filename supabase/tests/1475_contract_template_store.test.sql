-- The contract template store (001475): versioned templates, edited only as
-- drafts, frozen on activation, one active version per template, never
-- changed once used, and signing requests pinned to the active version.
begin;
select plan(38);
set local search_path = public, extensions;

-- Row security and grants: the service role only.
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.commerce_contract_templates'::regclass),
  'templates force row security');
select ok(not has_table_privilege('clockwork_runtime', 'public.commerce_contract_templates', 'SELECT'),
  'customer identities cannot read templates');
select ok(not has_table_privilege('authenticated', 'public.commerce_contract_templates', 'SELECT'),
  'authenticated cannot read templates');
select ok(not has_table_privilege('anon', 'public.commerce_contract_templates', 'INSERT'),
  'anonymous callers cannot write templates');
select ok(has_table_privilege('clockwork_service', 'public.commerce_contract_templates', 'UPDATE'),
  'the service role manages templates');
select is((select count(*)::int from pg_policies
  where tablename = 'commerce_contract_templates' and 'clockwork_service' <> all(roles)), 0,
  'every policy is for the service role');

create function pg_temp.draft(id uuid, version int, hash text) returns void language sql as $$
  insert into commerce_contract_templates (id, template_key, version, name, contract_type, requires_approval,
    fields, document, content_hash, created_by_id, created_by_name)
  values (id, 'channel-partnership', version, 'Channel Partnership Agreement', 'channel_partnership', true,
    '[]', '{"title":"CPA","blocks":[]}', hash, 'a1475000-0000-4000-8000-000000000001', 'Elena Brooks')
$$;
create function pg_temp.sign(contract uuid, version text, hash text, template text default 'channel-partnership')
returns void language sql as $$
  insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
  values (contract, 'Bluefin', 'channel_partnership', 'ours', 'draft', 'R.W.', 'a1475000-0000-4000-8000-000000000002', 'R.W.');
  insert into commerce_contract_signing (contract_id, template_id, template_version, template_hash, document_name, input,
    counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode)
  values (contract, template, version, hash, 'Doc', '{}', '{}', '{}',
    'a1475000-0000-4000-8000-000000000002', 'R.W.', true, 'pending', true)
$$;

create function pg_temp.resend(version text, hash text) returns void language sql as $$
  insert into commerce_contract_signing (contract_id, request_number, template_id, template_version, template_hash,
    document_name, input, counterparty_signer, countersigner, preparer_id, preparer_name, approval_required, approval_state, test_mode)
  values ('c1475000-0000-4000-8000-000000000001', 2, 'channel-partnership', version, hash, 'Doc', '{}', '{}', '{}',
    'a1475000-0000-4000-8000-000000000002', 'R.W.', true, 'pending', true)
$$;

set local role clockwork_service;

-- =========================================================================
-- 1. Drafts are edited freely; activation is recorded and freezes content.
-- =========================================================================
select lives_ok($$select pg_temp.draft('b1475000-0000-4000-8000-000000000001', 1, repeat('a',64))$$,
  'an administrator saves a draft');
select throws_ok($$insert into commerce_contract_templates (id, template_key, version, name, contract_type, requires_approval,
    fields, document, content_hash, status, activated_by_id, activated_by_name, activated_at, created_by_id, created_by_name)
  values ('b1475000-0000-4000-8000-000000000009', 'channel-partnership', 9, 'CPA', 'channel_partnership', true,
    '[]', '{}', repeat('a',64), 'active', 'a1475000-0000-4000-8000-000000000001', 'E.B.', now(),
    'a1475000-0000-4000-8000-000000000001', 'E.B.')$$,
  'P0001', 'A contract template version starts as a draft', 'a version is never inserted already active');
select throws_ok($$select pg_temp.draft('b1475000-0000-4000-8000-000000000008', 1, repeat('a',64))$$,
  '23505', null, 'each version number is used once per template');
select lives_ok($$update commerce_contract_templates set name = 'Channel Partnership Agreement (2026)',
    content_hash = repeat('b',64), revision = 2 where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'a draft is edited');
select throws_ok($$update commerce_contract_templates set name = 'Stale', revision = 2
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Contract template revision must advance by one', 'an edit advances the revision');
select throws_ok($$update commerce_contract_templates set status = 'active', revision = 3
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Activating a contract template version records who activated it', 'activation names who activated it');
select lives_ok($$update commerce_contract_templates set status = 'active', activated_by_id = 'a1475000-0000-4000-8000-000000000001',
    activated_by_name = 'Elena Brooks', activated_at = now(), revision = 3
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'an administrator activates the draft');
select throws_ok($$update commerce_contract_templates set document = '{"title":"CPA","blocks":[1]}', revision = 4
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'An activated or used contract template version cannot change; create a new version',
  'active content is frozen');
select throws_ok($$update commerce_contract_templates set source_note = 'Another note', revision = 4
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'An activated or used contract template version cannot change; create a new version',
  'the source note is frozen with the content');
select throws_ok($$update commerce_contract_templates set template_key = 'customer-msa', revision = 4
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Contract template identity is immutable', 'a version keeps its template and number');
select throws_ok($$delete from commerce_contract_templates where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Only an unused draft contract template can be discarded', 'an active version is never deleted');

-- =========================================================================
-- 2. One active version per template.
-- =========================================================================
select lives_ok($$select pg_temp.draft('b1475000-0000-4000-8000-000000000002', 2, repeat('c',64))$$,
  'the next version starts as a draft');
select throws_ok($$update commerce_contract_templates set status = 'active', activated_by_id = 'a1475000-0000-4000-8000-000000000001',
    activated_by_name = 'Elena Brooks', activated_at = now(), revision = 2
    where id = 'b1475000-0000-4000-8000-000000000002'$$,
  '23505', null, 'two versions of one template are never active at once');

-- =========================================================================
-- 3. Contracts are prepared from the active version, which then never changes.
-- =========================================================================
select throws_ok($$select pg_temp.sign('c1475000-0000-4000-8000-000000000001', 'v2', repeat('c',64))$$,
  'CW409', 'A contract is prepared only from the active version of its template', 'a draft version cannot be prepared');
select throws_ok($$select pg_temp.sign('c1475000-0000-4000-8000-000000000001', 'v1', repeat('a',64))$$,
  'CW409', 'A contract is prepared only from the active version of its template', 'the hash must be the version''s own');
select lives_ok($$select pg_temp.sign('c1475000-0000-4000-8000-000000000001', 'v1', repeat('b',64))$$,
  'a contract is prepared from the active version');
select lives_ok($$update commerce_contract_templates set status = 'retired', retired_by_name = 'Elena Brooks',
    retired_at = now(), revision = 4 where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'the used version is retired');
select throws_ok($$update commerce_contract_templates set retired_by_name = 'Someone else', revision = 5
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Contract template activation and retirement records are fixed', 'who retired a version is never rewritten');
select throws_ok($$update commerce_contract_templates set activated_by_name = 'Someone else', revision = 5
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', 'Contract template activation and retirement records are fixed', 'who activated a version is never rewritten');
select throws_ok($$select pg_temp.sign('c1475000-0000-4000-8000-000000000002', 'v1', repeat('b',64))$$,
  'CW409', 'A contract is prepared only from the active version of its template', 'a retired version cannot be prepared');
select throws_ok($$update commerce_contract_templates set status = 'draft', activated_by_id = null, activated_by_name = null,
    activated_at = null, retired_by_name = null, retired_at = null, revision = 5
    where id = 'b1475000-0000-4000-8000-000000000001'$$,
  'P0001', null, 'a used version never returns to draft');
-- Sent again after it ended, a contract keeps the version it was prepared
-- from, even though that version has been retired.
select lives_ok($$update commerce_contract_signing set state = 'canceled', cancel_code = 'discarded'
    where contract_id = 'c1475000-0000-4000-8000-000000000001'$$,
  'the first request ends unsent');
select lives_ok($$delete from commerce_contract_signing where contract_id = 'c1475000-0000-4000-8000-000000000001'$$,
  'the ended request moves to the history');
-- Only the version and hash of this contract's own earlier request: not a
-- draft, and not another retired version it was never prepared from.
select lives_ok($$select pg_temp.draft('b1475000-0000-4000-8000-000000000003', 3, repeat('e',64))$$,
  'a third version is drafted');
select lives_ok($$update commerce_contract_templates set status = 'active', activated_by_id = 'a1475000-0000-4000-8000-000000000001',
    activated_by_name = 'Elena Brooks', activated_at = now(), revision = 2
    where id = 'b1475000-0000-4000-8000-000000000003'$$,
  'the third version is activated');
select lives_ok($$update commerce_contract_templates set status = 'retired', retired_by_name = 'Elena Brooks',
    retired_at = now(), revision = 3 where id = 'b1475000-0000-4000-8000-000000000003'$$,
  'and retired');
select throws_ok($$select pg_temp.resend('v2', repeat('c',64))$$,
  'CW409', 'A contract is prepared only from the active version of its template',
  'a contract is not sent again on a draft');
select throws_ok($$select pg_temp.resend('v3', repeat('e',64))$$,
  'CW409', 'A contract is prepared only from the active version of its template',
  'a contract is not sent again on a retired version it was not prepared from');
select lives_ok($$select pg_temp.resend('v1', repeat('b',64))$$,
  'a contract is sent again on its retired version');
select lives_ok($$select pg_temp.sign('c1475000-0000-4000-8000-000000000003', 'fixture-2', repeat('d',64), 'test-fixture')$$,
  'a template key the store does not hold is left to the application');
select lives_ok($$delete from commerce_contract_templates where id = 'b1475000-0000-4000-8000-000000000002'$$,
  'an unused draft is discarded');

reset role;
select is((select status from commerce_contract_templates where id = 'b1475000-0000-4000-8000-000000000001'), 'retired',
  'the used version is kept');

select * from finish();
rollback;
