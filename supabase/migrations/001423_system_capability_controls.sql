-- Repository defaults must never enable production commerce. Preserve an
-- explicit operator decision; only replace the historical migration fixtures.
update public.system_capabilities
set enabled = false, recovery_enabled = false,
    change_reason = 'Production bootstrap: explicit audited activation required',
    changed_by = 'migration:001423'
where changed_by = 'migration:001000';

create table public.system_capability_requests (
  id uuid primary key default public.uuid_v7(),
  capability_key text not null references public.system_capabilities(capability_key),
  base_version integer not null,
  enable_recovery boolean not null,
  requested_by uuid not null references public.commerce_users(id),
  requested_at timestamptz not null,
  reason text not null,
  evidence_reference text not null,
  status text not null default 'pending',
  decided_by uuid references public.commerce_users(id),
  decided_at timestamptz,
  decision_reason text,
  constraint system_capability_requests_status_check check (status in ('pending','approved','rejected','canceled')),
  constraint system_capability_requests_separation_check check (status <> 'approved' or decided_by <> requested_by),
  constraint system_capability_requests_decision_check check (
    (status = 'pending' and decided_by is null and decided_at is null and decision_reason is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null and length(trim(decision_reason)) >= 8)
  ),
  constraint system_capability_requests_reason_check check (length(trim(reason)) >= 8 and length(trim(evidence_reference)) > 0 and base_version > 0)
);
create unique index system_capability_requests_pending_unique
on public.system_capability_requests(capability_key) where status = 'pending';
alter table public.system_capability_requests enable row level security;
alter table public.system_capability_requests force row level security;
create policy system_capability_requests_service on public.system_capability_requests
for all to clockwork_service using (true) with check (true);
revoke all on public.system_capability_requests from public, anon, authenticated, clockwork_runtime;
grant select, insert, update on public.system_capability_requests to clockwork_service;

-- Evidence and the reviewed state are immutable, including for service callers.
create function public.guard_system_capability_request() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception using errcode = '55000', message = 'capability request must start pending';
    end if;
  elsif old.status <> 'pending' or
    (new.id, new.capability_key, new.base_version, new.enable_recovery,
     new.requested_by, new.requested_at, new.reason, new.evidence_reference)
    is distinct from
    (old.id, old.capability_key, old.base_version, old.enable_recovery,
     old.requested_by, old.requested_at, old.reason, old.evidence_reference) then
    raise exception using errcode = '55000', message = 'capability request evidence is immutable';
  end if;
  if new.status = 'approved' and
    (new.decided_at < new.requested_at or new.decided_at > new.requested_at + interval '24 hours') then
    raise exception using errcode = '55000', message = 'capability activation evidence has expired';
  end if;
  return new;
end $$;
create trigger system_capability_request_guard
before insert or update on public.system_capability_requests
for each row execute function public.guard_system_capability_request();
