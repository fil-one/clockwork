begin;
select plan(12);

select has_table('public', 'accounts', 'accounts exists');
select has_table('public', 'agreements', 'agreements exists');
select has_table('public', 'quotes', 'quotes exists');
select has_table('public', 'orders', 'orders exists');
select has_table('public', 'commitment_ledgers', 'commitment ledger exists');
select has_table('public', 'entitlements', 'entitlements exists');
select has_table('public', 'audit_events', 'audit events exists');
select has_table('public', 'outbox_messages', 'outbox exists');
select has_index('public', 'audit_events', 'audit_account_timeline_idx', 'account timeline index exists');
select has_index('public', 'orders', 'orders_renewal_idx', 'renewal index exists');
select has_index('public', 'webhook_events', 'webhook_provider_dedup_unique', 'webhook dedup index exists');
select has_index('public', 'outbox_messages', 'outbox_dispatch_queue_idx', 'outbox queue index exists');

select * from finish();
rollback;
