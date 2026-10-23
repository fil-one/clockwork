begin;
select plan(9);

select has_column('public', 'commerce_account_documents', 'removed_at', 'documents record a removal');

select ok(not has_table_privilege('clockwork_service', 'public.commerce_account_documents', 'UPDATE'),
  'staff have no table-wide update');

select ok(has_column_privilege('clockwork_service', 'public.commerce_account_documents', 'removed_at', 'UPDATE')
  and has_column_privilege('clockwork_service', 'public.commerce_account_documents', 'removal_reason', 'UPDATE'),
  'staff may set the removal columns');

select ok(not has_column_privilege('clockwork_service', 'public.commerce_account_documents', 'title', 'UPDATE')
  and not has_column_privilege('clockwork_service', 'public.commerce_account_documents', 'sha256', 'UPDATE')
  and not has_column_privilege('clockwork_service', 'public.commerce_account_documents', 'storage_key', 'UPDATE'),
  'original details stay immutable for staff');

select ok(not has_table_privilege('clockwork_service', 'public.commerce_account_documents', 'DELETE'),
  'documents are never erased by staff');

insert into public.commerce_account_documents
  (id, account_id, title, kind, file_name, storage_backend, storage_key, sha256, size_bytes, content_type,
   uploaded_by_id, uploaded_by_name)
values ('00000000-0000-4000-8000-0000000014f1', '10000000-0000-4000-8000-000000000001', 'Wrong NDA', 'mnda',
  'Wrong.pdf', 'pgtap', 'pgtap-1484-a', repeat('b', 64), 8, 'application/pdf', gen_random_uuid(), 'Staff');

select throws_ok($$update public.commerce_account_documents
  set removed_at = now(), removed_by_id = gen_random_uuid(), removed_by_name = 'Staff', removal_reason = null,
      version = version + 1
  where id = '00000000-0000-4000-8000-0000000014f1'$$,
  '23514', null, 'a removal states who and why');

select throws_ok($$update public.commerce_account_documents set title = 'Edited', version = version + 1
  where id = '00000000-0000-4000-8000-0000000014f1'$$,
  'P0001', 'ATTACHMENT_IMMUTABLE', 'the trigger keeps original details');

update public.commerce_account_documents
  set removed_at = now(), removed_by_id = gen_random_uuid(), removed_by_name = 'Staff',
      removal_reason = 'Attached to the wrong account', version = version + 1
  where id = '00000000-0000-4000-8000-0000000014f1';

select lives_ok($$insert into public.commerce_account_documents
  (id, account_id, title, kind, file_name, storage_backend, storage_key, sha256, size_bytes, content_type,
   uploaded_by_id, uploaded_by_name)
  values (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', 'Same NDA again', 'mnda',
  'Again.pdf', 'pgtap', 'pgtap-1484-b', repeat('b', 64), 8, 'application/pdf', gen_random_uuid(), 'Staff')$$,
  'a removed copy does not block attaching the same PDF again');

select throws_ok($$update public.commerce_account_documents
  set removed_at = null, removed_by_id = null, removed_by_name = null, removal_reason = null, version = version + 1
  where id = '00000000-0000-4000-8000-0000000014f1'$$,
  '23505', null, 'a restore cannot duplicate an identical document on the record');

select * from finish();
rollback;
