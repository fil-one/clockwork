alter table webhook_events
  add column lock_token uuid not null default gen_random_uuid();
