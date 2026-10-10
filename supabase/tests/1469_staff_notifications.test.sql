begin;
select plan(31);
set local search_path=public,extensions;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.commerce_staff_notifications'::regclass,
    'public.commerce_staff_notification_deliveries'::regclass,
    'public.commerce_staff_notification_settings'::regclass,
    'public.commerce_staff_notification_preferences'::regclass)),
  'every notification table forces row security');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_staff_notifications','SELECT'),
  'customer identities cannot read notifications');
select ok(not has_table_privilege('authenticated','public.commerce_staff_notifications','SELECT'),
  'authenticated cannot read notifications');
select ok(not has_table_privilege('anon','public.commerce_staff_notification_settings','SELECT'),
  'anonymous callers cannot read the settings');
select ok(not has_table_privilege('clockwork_runtime','public.commerce_staff_notification_preferences','UPDATE'),
  'customer identities cannot change preferences');
select ok(not has_table_privilege('clockwork_service','public.commerce_staff_notifications','DELETE'),
  'notifications are never deleted');
select ok(has_column_privilege('clockwork_service','public.commerce_staff_notifications','read_at','UPDATE')
  and not has_column_privilege('clockwork_service','public.commerce_staff_notifications','subject','UPDATE'),
  'the service role marks notifications read and changes nothing else');
select ok(not has_table_privilege('clockwork_service','public.commerce_staff_notification_settings','INSERT')
  and not has_table_privilege('clockwork_service','public.commerce_staff_notification_settings','DELETE'),
  'the settings row is updated, never added or removed');
select is((select count(*)::int from commerce_staff_notification_settings), 1,
  'one settings row exists');
select ok((select not email_enabled and not slack_enabled from commerce_staff_notification_settings),
  'email and Slack start off');
select ok((select slack_kinds @> k and slack_kinds <@ k from commerce_staff_notification_settings,
  (select array['mnda.completed','contract.executed','contract.approval_requested','handoff.requested']::text[] k) defaults),
  'Slack starts with the four headline kinds');

insert into commerce_users(id, workos_user_id, email, name, is_internal_staff)
values
  ('019a44ad-0000-7000-8000-00000000a469','user_1469_a','seller-1469@clockwork.test','Seller',true),
  ('019a44ad-0000-7000-8000-00000000b469','user_1469_b','approver-1469@clockwork.test','Approver',true);
insert into audit_events(id, aggregate_type, aggregate_id, aggregate_version, event_type, event_version, actor, occurred_at, request_id)
values
  ('019a44ad-0000-7000-8000-00000000e469','agreement','019a44ad-0000-7000-8000-00000000c469',1,'mnda.completed',1,
   '{"kind":"system","id":"esign-reconciliation"}', now(), 'pgtap-1469'),
  ('019a44ad-0000-7000-8000-00000000f469','agreement','019a44ad-0000-7000-8000-00000000c469',2,'mnda.attention',1,
   '{"kind":"system","id":"esign-reconciliation"}', now(), 'pgtap-1469');

set local role clockwork_service;
select lives_ok($$insert into commerce_staff_notifications(id,recipient_user_id,event_id,kind,record_type,record_id,href,subject)
  values('019a44ad-0000-7000-8000-000000001469','019a44ad-0000-7000-8000-00000000a469','019a44ad-0000-7000-8000-00000000e469',
  'mnda.completed','mnda','019a44ad-0000-7000-8000-00000000c469','/internal/mndas?q=Acme','Acme, Inc.')$$,
  'the handler writes a notification');
select throws_ok($$insert into commerce_staff_notifications(recipient_user_id,event_id,kind,record_type,record_id,href,subject)
  values('019a44ad-0000-7000-8000-00000000a469','019a44ad-0000-7000-8000-00000000e469',
  'mnda.completed','mnda','019a44ad-0000-7000-8000-00000000c469','/internal/mndas?q=Acme','Acme, Inc.')$$,
  '23505',null,'a replayed event notifies the same person once');
select lives_ok($$insert into commerce_staff_notifications(recipient_user_id,event_id,kind,record_type,record_id,href,subject)
  values('019a44ad-0000-7000-8000-00000000b469','019a44ad-0000-7000-8000-00000000e469',
  'mnda.completed','mnda','019a44ad-0000-7000-8000-00000000c469','/internal/mndas?q=Acme','Acme, Inc.')$$,
  'another recipient of the same event is notified');
select lives_ok($$insert into commerce_staff_notifications(recipient_user_id,event_id,kind,record_type,record_id,href,subject)
  values('019a44ad-0000-7000-8000-00000000a469','019a44ad-0000-7000-8000-00000000e469',
  'mnda.completed','mnda','019a44ad-0000-7000-8000-00000000c469','/internal/mndas?q=Acme','Acme, Inc.')
  on conflict (event_id, recipient_user_id) do nothing$$,
  'the handler''s replay is accepted');
select is((select count(*)::int from commerce_staff_notifications
  where event_id='019a44ad-0000-7000-8000-00000000e469'), 2,
  'and writes nothing new');
select throws_ok($$insert into commerce_staff_notifications(recipient_user_id,event_id,kind,record_type,record_id,href,subject)
  values('019a44ad-0000-7000-8000-00000000a469','019a44ad-0000-7000-8000-00000000f469',
  'mnda.attention','mnda','019a44ad-0000-7000-8000-00000000c469','https://elsewhere.test/','Acme, Inc.')$$,
  '23514',null,'a notification links inside the staff portal only');
select throws_ok($$update commerce_staff_notifications set subject='Changed' where id='019a44ad-0000-7000-8000-000000001469'$$,
  '42501',null,'what a notification says cannot be changed');
select lives_ok($$update commerce_staff_notifications set read_at=now() where id='019a44ad-0000-7000-8000-000000001469'$$,
  'the recipient marks it read');
select throws_ok($$update commerce_staff_notifications set read_at=null where id='019a44ad-0000-7000-8000-000000001469'$$,
  'P0001','STAFF_NOTIFICATION_ALREADY_READ','reading is not undone');

select lives_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,recipient_user_id,kind,status,reason)
  values('019a44ad-0000-7000-8000-00000000e469','email','019a44ad-0000-7000-8000-00000000a469','mnda.completed','failed','provider_unavailable')$$,
  'a failed email is recorded');
select throws_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,recipient_user_id,kind,status,reason)
  values('019a44ad-0000-7000-8000-00000000e469','email','019a44ad-0000-7000-8000-00000000a469','mnda.completed','sent',null)$$,
  '23505',null,'one email per event and recipient');
select lives_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,kind,status,reason)
  values('019a44ad-0000-7000-8000-00000000e469','slack','mnda.completed','sent',null)$$,
  'the Slack post is recorded');
select throws_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,kind,status,reason)
  values('019a44ad-0000-7000-8000-00000000e469','slack','mnda.completed','sent',null)$$,
  '23505',null,'one Slack post per event');
select throws_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,recipient_user_id,kind,status)
  values('019a44ad-0000-7000-8000-00000000f469','slack','019a44ad-0000-7000-8000-00000000a469','mnda.attention','sent')$$,
  '23514',null,'a Slack post names no recipient');
select throws_ok($$update commerce_staff_notification_deliveries set status='failed', reason='provider_rejected'
  where event_id='019a44ad-0000-7000-8000-00000000e469' and channel='slack'$$,
  'P0001','STAFF_NOTIFICATION_DELIVERY_SENT','a sent delivery stays sent');
select lives_ok($$update commerce_staff_notification_deliveries set status='sent', reason=null, attempts=2
  where event_id='019a44ad-0000-7000-8000-00000000e469' and channel='email'$$,
  'a failed delivery can succeed on retry');
select lives_ok($$insert into commerce_staff_notification_deliveries(event_id,channel,recipient_user_id,kind,status)
  values('019a44ad-0000-7000-8000-00000000f469','email','019a44ad-0000-7000-8000-00000000a469','mnda.attention','sending')$$,
  'a delivery is recorded as sending before the provider is called');
select throws_ok($$update commerce_staff_notification_deliveries set reason='provider_rejected'
  where event_id='019a44ad-0000-7000-8000-00000000f469' and channel='email'$$,
  '23514',null,'a delivery in flight carries no reason');
select lives_ok($$update commerce_staff_notification_deliveries set status='failed', reason='provider_rejected', provider_code='SES_MessageRejected'
  where event_id='019a44ad-0000-7000-8000-00000000f469' and channel='email'$$,
  'the provider''s answer is recorded with its code');
select lives_ok($$insert into commerce_staff_notification_preferences(user_id,email_enabled,email_muted_kinds)
  values('019a44ad-0000-7000-8000-00000000a469',false,array['mnda.attention'])$$,
  'a person saves their own preferences');
reset role;

select * from finish();
rollback;
