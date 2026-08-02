-- Durable evidence of every commercial notification the platform sends. A term
-- window, POC milestone, quote expiry, or dunning notice is only defensible if
-- the platform can show the template, the recipients, and the provider message
-- it produced, so each attempt lands here whether it succeeded or failed.

create table notification_deliveries (
  id uuid primary key default public.uuid_v7(),
  account_id uuid not null references accounts(id),
  channel text not null check (channel in ('email')),
  alert_kind text not null check (alert_kind in (
    'renewal_term_window',
    'renewal_notice_window',
    'poc_milestone',
    'quote_expiry',
    'collections_dunning'
  )),
  subject_type text not null check (subject_type in ('order', 'poc', 'quote', 'invoice')),
  subject_id uuid not null,
  template text not null check (length(template) between 1 and 200),
  recipients text[] not null check (
    cardinality(recipients) between 1 and 50
    and array_position(recipients, null) is null
  ),
  idempotency_key text not null check (length(idempotency_key) between 16 and 255),
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text check (length(provider_message_id) between 1 and 255),
  failure_code text check (length(failure_code) between 1 and 120),
  requested_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_delivery_idempotency_unique unique (idempotency_key),
  constraint notification_delivery_outcome_check check (
    (status = 'sent'
      and provider_message_id is not null
      and delivered_at is not null
      and failure_code is null)
    or (status = 'failed'
      and provider_message_id is null
      and delivered_at is null
      and failure_code is not null)
  ),
  constraint notification_delivery_order_check check (
    delivered_at is null or delivered_at >= requested_at
  )
);

create index notification_delivery_subject_idx
  on notification_deliveries (subject_type, subject_id, requested_at desc);
create index notification_delivery_account_idx
  on notification_deliveries (account_id, alert_kind, requested_at desc);

-- A delivery attempt is a fact about the past; a later attempt appends a row.
create trigger notification_deliveries_immutable
  before update or delete on notification_deliveries
  for each row execute function deny_immutable_mutation();

alter table notification_deliveries enable row level security;
alter table notification_deliveries force row level security;

create policy notification_delivery_read on notification_deliveries
  for select using (app_has_account(account_id));

create policy notification_delivery_service on notification_deliveries
  for all using (app_is_internal()) with check (app_is_internal());

grant select on notification_deliveries to clockwork_runtime;
grant select, insert on notification_deliveries to clockwork_service;
