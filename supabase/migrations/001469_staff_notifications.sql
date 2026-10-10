-- Staff notifications: an in-app inbox for every Fil One staff member, with
-- optional email and Slack delivery.
--
-- The outbox handler for a notifying event (packages/workflows/src/
-- staff-notifications) writes one notification per recipient. The pair of
-- source audit event and recipient is unique, so a replayed webhook, a
-- redelivered outbox message or a second reconcile run that re-reads the same
-- event writes nothing new. Each email or Slack post is a delivery row, unique
-- per event, channel and recipient, recorded as `sending` before the provider
-- is called: a replay never sends it again, and only a delivery the provider
-- could not take (`failed`, `provider_unavailable`) is retried, by the
-- scheduled retry task, a bounded number of times.
--
-- Settings are one row a commerce administrator edits (which channels are on,
-- which kinds each carries, the Slack channel's label); every change is
-- audited as staff_notifications.settings_changed. Each person's preferences
-- (email on or off, kinds muted) are one row of their own. Secrets never live
-- here: the Slack webhook URL and the email sender come from the deployment's
-- environment.
--
-- Staff reach these tables through server code on the service role, which
-- checks the reader is the recipient and still holds the permission the
-- notification's record needs. Customer identities have no grants.
set lock_timeout = '5s';

create table if not exists public.commerce_staff_notifications (
  id uuid primary key default uuid_v7(),
  recipient_user_id uuid not null references public.commerce_users(id),
  event_id uuid not null references public.audit_events(id),
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}\.[a-z][a-z_]{0,59}$'),
  record_type text not null check (record_type ~ '^[a-z][a-z_]{0,39}$'),
  record_id text not null check (length(record_id) between 1 and 200),
  -- A path inside the staff portal, never an external address.
  href text not null check (href ~ '^/internal(/|\?|$)' and length(href) <= 600),
  subject text not null check (length(btrim(subject)) between 1 and 300),
  actor_name text check (actor_name is null or length(btrim(actor_name)) between 1 and 200),
  detail text check (detail is null or length(detail) <= 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint commerce_staff_notifications_event_recipient_unique
    unique (event_id, recipient_user_id)
);

comment on table public.commerce_staff_notifications is
  'One in-app notification per recipient per notifying audit event. Written by the staff notification outbox handler; only read_at changes afterwards.';

create index if not exists commerce_staff_notifications_inbox
  on public.commerce_staff_notifications (recipient_user_id, created_at desc, id desc);

create index if not exists commerce_staff_notifications_unread
  on public.commerce_staff_notifications (recipient_user_id)
  where read_at is null;

-- What a notification says is fixed when it is written; reading it is the one
-- change, and it is not undone.
create or replace function public.guard_commerce_staff_notification() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.recipient_user_id <> old.recipient_user_id
     or new.event_id <> old.event_id or new.kind <> old.kind
     or new.record_type <> old.record_type or new.record_id <> old.record_id
     or new.href <> old.href or new.subject <> old.subject
     or new.actor_name is distinct from old.actor_name
     or new.detail is distinct from old.detail
     or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'STAFF_NOTIFICATION_IMMUTABLE';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception using errcode = 'P0001', message = 'STAFF_NOTIFICATION_ALREADY_READ';
  end if;
  return new;
end $$;

drop trigger if exists guard_commerce_staff_notification on public.commerce_staff_notifications;

create trigger guard_commerce_staff_notification
  before update on public.commerce_staff_notifications
  for each row execute function public.guard_commerce_staff_notification();

create table if not exists public.commerce_staff_notification_deliveries (
  id uuid primary key default uuid_v7(),
  event_id uuid not null references public.audit_events(id),
  channel text not null check (channel in ('email','slack')),
  -- The person an email went to; null for a Slack post, which goes to the
  -- configured channel once per event.
  recipient_user_id uuid references public.commerce_users(id),
  kind text not null check (kind ~ '^[a-z][a-z_]{0,39}\.[a-z][a-z_]{0,59}$'),
  status text not null check (status in ('sending','sent','skipped','failed')),
  -- Why a delivery was skipped or failed, as a code: not_configured,
  -- invalid_configuration, channel_off, kind_off, preference_off, no_access, demo,
  -- provider_rejected, provider_unavailable (retried), gave_up (retries spent).
  reason text check (reason is null or reason ~ '^[a-z_]{1,60}$'),
  attempts integer not null default 1 check (attempts >= 1),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 300),
  -- The provider's own error code, such as SES_MessageRejected or
  -- SLACK_HTTP_404, so the settings page can say why it failed.
  provider_code text check (provider_code is null or provider_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_staff_notification_deliveries_channel_recipient_check
    check ((channel = 'slack') = (recipient_user_id is null)),
  constraint commerce_staff_notification_deliveries_outcome_check
    check ((status in ('sending','sent')) = (reason is null)),
  constraint commerce_staff_notification_deliveries_unique
    unique nulls not distinct (event_id, channel, recipient_user_id)
);

comment on table public.commerce_staff_notification_deliveries is
  'Each email and Slack delivery the staff notification handler decided on: sending (the provider was called), sent, skipped with a reason, or failed. A sent delivery is final.';

create index if not exists commerce_staff_notification_deliveries_recent
  on public.commerce_staff_notification_deliveries (updated_at desc);

create index if not exists commerce_staff_notification_deliveries_retry
  on public.commerce_staff_notification_deliveries (updated_at)
  where status = 'failed' and reason = 'provider_unavailable';

-- A delivery that was sent stays sent.
create or replace function public.guard_commerce_staff_notification_delivery() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.event_id <> old.event_id or new.channel <> old.channel
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.kind <> old.kind or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'STAFF_NOTIFICATION_DELIVERY_IMMUTABLE';
  end if;
  if old.status = 'sent' then
    raise exception using errcode = 'P0001', message = 'STAFF_NOTIFICATION_DELIVERY_SENT';
  end if;
  return new;
end $$;

drop trigger if exists guard_commerce_staff_notification_delivery on public.commerce_staff_notification_deliveries;

create trigger guard_commerce_staff_notification_delivery
  before update on public.commerce_staff_notification_deliveries
  for each row execute function public.guard_commerce_staff_notification_delivery();

create table if not exists public.commerce_staff_notification_settings (
  singleton boolean primary key default true check (singleton),
  email_enabled boolean not null default false,
  slack_enabled boolean not null default false,
  -- Email carries every kind except these, so a kind added later is emailed
  -- unless an administrator turns it off.
  email_disabled_kinds text[] not null default '{}'
    check (cardinality(email_disabled_kinds) <= 100),
  -- Slack carries only these.
  slack_kinds text[] not null default array[
    'mnda.completed', 'contract.executed', 'contract.approval_requested', 'handoff.requested'
  ]::text[] check (cardinality(slack_kinds) <= 100),
  slack_channel_label text not null default ''
    check (length(slack_channel_label) <= 80),
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.commerce_staff_notification_settings (singleton)
values (true)
on conflict (singleton) do nothing;

comment on table public.commerce_staff_notification_settings is
  'Single row. Which notification channels are on and which kinds each carries; changed by commerce administrators and audited as staff_notifications.settings_changed. Secrets live in the deployment environment.';

create table if not exists public.commerce_staff_notification_preferences (
  user_id uuid primary key references public.commerce_users(id),
  email_enabled boolean not null default true,
  email_muted_kinds text[] not null default '{}'
    check (cardinality(email_muted_kinds) <= 100),
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.commerce_staff_notification_preferences is
  'One row per staff member who changed their notification email preferences. No row means email on for every kind.';

alter table public.commerce_staff_notifications enable row level security;
alter table public.commerce_staff_notifications force row level security;
alter table public.commerce_staff_notification_deliveries enable row level security;
alter table public.commerce_staff_notification_deliveries force row level security;
alter table public.commerce_staff_notification_settings enable row level security;
alter table public.commerce_staff_notification_settings force row level security;
alter table public.commerce_staff_notification_preferences enable row level security;
alter table public.commerce_staff_notification_preferences force row level security;

revoke all on
  public.commerce_staff_notifications,
  public.commerce_staff_notification_deliveries,
  public.commerce_staff_notification_settings,
  public.commerce_staff_notification_preferences
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.guard_commerce_staff_notification() from public;
revoke all on function public.guard_commerce_staff_notification_delivery() from public;

-- Notifications are written whole and then only marked read. Nothing here is
-- deleted.
grant select, insert on public.commerce_staff_notifications to clockwork_service;
grant update (read_at) on public.commerce_staff_notifications to clockwork_service;
grant select, insert on public.commerce_staff_notification_deliveries to clockwork_service;
grant update (status, reason, attempts, provider_message_id, provider_code, updated_at)
  on public.commerce_staff_notification_deliveries to clockwork_service;
grant select, update on public.commerce_staff_notification_settings to clockwork_service;
grant select, insert, update on public.commerce_staff_notification_preferences to clockwork_service;

drop policy if exists staff_notifications_service on public.commerce_staff_notifications;
create policy staff_notifications_service on public.commerce_staff_notifications
  for all to clockwork_service using (true) with check (true);

drop policy if exists staff_notification_deliveries_service on public.commerce_staff_notification_deliveries;
create policy staff_notification_deliveries_service on public.commerce_staff_notification_deliveries
  for all to clockwork_service using (true) with check (true);

drop policy if exists staff_notification_settings_service on public.commerce_staff_notification_settings;
create policy staff_notification_settings_service on public.commerce_staff_notification_settings
  for all to clockwork_service using (true) with check (true);

drop policy if exists staff_notification_preferences_service on public.commerce_staff_notification_preferences;
create policy staff_notification_preferences_service on public.commerce_staff_notification_preferences
  for all to clockwork_service using (true) with check (true);

-- The notifying event types had no outbox consumer before this migration, so
-- every message ever written for them is still pending. The dispatcher would
-- drain that history ahead of newer work on other topics and notify people
-- about the last few days at once. These messages predate notifications, so
-- they are consumed here, with no effect, and only new events notify. The
-- list is the topics in packages/workflows/src/staff-notifications/sources.ts.
update public.outbox_messages
set processed_at = now()
where processed_at is null
  and topic in (
    'mnda.awaiting_countersignature', 'mnda.completed', 'mnda.attention',
    'mnda.deleted_in_signwell', 'mnda.signwell_mismatch', 'mnda.declined',
    'mnda.expired',
    'contract.prepared', 'contract.approved', 'contract.rejected',
    'contract.signing_awaiting_countersignature', 'contract.signing_completed',
    'contract.signing_attention', 'contract.deleted_in_signwell',
    'contract.signwell_mismatch', 'contract.signing_declined',
    'contract.signing_expired',
    'handoff.requested', 'handoff.taken', 'handoff.completed', 'handoff.declined',
    'system.capability.activation_proposed',
    'system.capability.activation_approved',
    'system.capability.activation_rejected',
    'core.price_books.request_activation', 'core.price_books.activate',
    'core.price_books.reject_activation'
  );

reset lock_timeout;
