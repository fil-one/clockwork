-- Account-level control over the advisory alerts the platform sends.
--
-- `notification_deliveries` (001330) records what was sent; this records what an
-- account has asked not to be sent. Absence of a row means enabled, so an
-- account that has never touched the setting keeps every alert it gets today.
--
-- The vocabulary here is deliberately NARROWER than
-- `notification_delivery_alert_kind_check`. Two of the five kinds are missing on
-- purpose and the check constraint is what keeps them missing:
--
--   * `renewal_notice_window` is the contractual notice deadline. An account
--     that could switch it off could switch off the warning the agreement
--     requires the platform to give before the window closes.
--   * `collections_dunning` is a demand for payment on an issued invoice. A
--     debtor cannot opt out of being told it owes money.
--
-- Everything the constraint refuses is one of those two. The three it accepts --
-- term-window reminders, POC milestone updates and quote expiry warnings -- are
-- advisory: no contract and no invoice depends on them arriving.

create table notification_preferences (
  id uuid primary key default public.uuid_v7(),
  account_id uuid not null references accounts(id),
  alert_kind text not null check (alert_kind in (
    'renewal_term_window',
    'poc_milestone',
    'quote_expiry'
  )),
  channel text not null check (channel in ('email')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  constraint notification_preference_unique unique (account_id, alert_kind, channel)
);

create index notification_preference_account_idx
  on notification_preferences (account_id, alert_kind);

create trigger notification_preferences_version
  before update on notification_preferences
  for each row execute function touch_versioned_row();

alter table notification_preferences enable row level security;
alter table notification_preferences force row level security;

-- An account manages its own preferences; nothing else may read or write them.
create policy notification_preference_scope on notification_preferences
  for all using (app_has_account(account_id))
  with check (app_has_account(account_id));

grant select, insert, update on notification_preferences to clockwork_runtime;
grant select, insert, update on notification_preferences to clockwork_service;
