begin;
select plan(13);
select has_table('public', 'commerce_account_documents', 'staff attachment table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commerce_account_documents'::regclass), 'forced row security');
select ok(has_table_privilege('clockwork_service','public.commerce_account_documents','SELECT') and has_table_privilege('clockwork_service','public.commerce_account_documents','INSERT'), 'staff service reads and appends');
select ok(not has_table_privilege('clockwork_service','public.commerce_account_documents','UPDATE'), 'staff cannot overwrite evidence');
select ok(not has_table_privilege('clockwork_service','public.commerce_account_documents','DELETE'), 'staff cannot erase evidence');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_account_documents','SELECT'), 'tenant runtime cannot read staff attachments');
select ok(not has_table_privilege('authenticated','public.commerce_account_documents','SELECT'), 'browser cannot read attachments');
select ok(not has_table_privilege('anon','public.commerce_account_documents','INSERT'), 'anonymous cannot attach');
select throws_ok($$insert into commerce_account_documents(id,title,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_id,uploaded_by_name)
 values(gen_random_uuid(),'External NDA','mnda','NDA.pdf','postgres',gen_random_uuid()::text,repeat('a',64),8,'application/pdf',gen_random_uuid(),'Staff')$$,
 '23514',null,'an explicit account or partner is required');
select throws_ok($$insert into commerce_account_documents(id,account_id,partner_id,title,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_id,uploaded_by_name)
 values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'External NDA','mnda','NDA.pdf','postgres',gen_random_uuid()::text,repeat('a',64),8,'application/pdf',gen_random_uuid(),'Staff')$$,
 '23514',null,'one target, never both');
select throws_ok($$insert into commerce_account_documents(id,account_id,title,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_id,uploaded_by_name)
 values(gen_random_uuid(),gen_random_uuid(),'External NDA','mnda','NDA.pdf','postgres',gen_random_uuid()::text,repeat('a',64),8,'application/pdf',gen_random_uuid(),'Staff')$$,
 '23503',null,'an account must exist');
select throws_ok($$insert into commerce_account_documents(id,account_id,title,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_id,uploaded_by_name)
 values(gen_random_uuid(),gen_random_uuid(),'External NDA','mnda','NDA.pdf','postgres',gen_random_uuid()::text,repeat('a',64),26214401,'application/pdf',gen_random_uuid(),'Staff')$$,
 '23514',null,'database enforces size limit');
select throws_ok($$insert into commerce_account_documents(id,account_id,title,kind,file_name,storage_backend,storage_key,sha256,size_bytes,content_type,uploaded_by_id,uploaded_by_name)
 values(gen_random_uuid(),gen_random_uuid(),'External NDA','mnda','NDA.pdf','postgres',gen_random_uuid()::text,repeat('a',64),8,'text/html',gen_random_uuid(),'Staff')$$,
 '23514',null,'only PDF metadata');
select * from finish();
rollback;
