-- Retained PAYG evidence and invoice plans, with no provider dispatcher enabled.
create table public.core_payg_enrollments (
  id uuid primary key,
  account_id uuid not null references public.accounts(id),
  offer_version_id uuid not null references public.core_payg_offer_versions(id),
  source text not null,
  source_entitlement_id text not null,
  snapshot jsonb not null,
  binding_evidence_id text not null,
  cancellation_evidence_id text,
  created_at timestamptz not null default now()
);
create unique index core_payg_enrollment_source_unique on public.core_payg_enrollments(source, source_entitlement_id);
create table public.core_payg_source_measurements (
  enrollment_id uuid not null references public.core_payg_enrollments(id),
  source text not null,
  source_measurement_id text not null,
  starts_at timestamptz not null,
  payload jsonb not null,
  payload_hash text not null,
  recorded_at timestamptz not null default now(),
  primary key (source, source_measurement_id)
);
create index core_payg_source_period_idx on public.core_payg_source_measurements(enrollment_id, starts_at);
create table public.core_payg_source_receipts (
  receipt_id text primary key,
  enrollment_id uuid not null references public.core_payg_enrollments(id),
  payload_hash text not null,
  verification_evidence_id text not null,
  closed_through timestamptz not null,
  complete_count_meters text[] not null,
  recorded_at timestamptz not null default now()
);
create index core_payg_receipt_period_idx on public.core_payg_source_receipts(enrollment_id, closed_through);
create table public.core_payg_period_revisions (
  enrollment_id uuid not null references public.core_payg_enrollments(id),
  month text not null,
  revision integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (enrollment_id, month, revision),
  constraint core_payg_period_revision_positive check (revision > 0)
);
create table public.core_payg_pending_invoice_effects (
  idempotency_key text primary key,
  enrollment_id uuid not null references public.core_payg_enrollments(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array['core_payg_enrollments','core_payg_source_measurements','core_payg_source_receipts','core_payg_period_revisions','core_payg_pending_invoice_effects'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, clockwork_runtime', table_name);
    execute format('grant select, insert on public.%I to clockwork_service', table_name);
    execute format('create policy %I on public.%I for all to clockwork_service using (public.app_is_internal()) with check (public.app_is_internal())', table_name || '_service', table_name);
  end loop;
end;
$$;
grant update on public.core_payg_enrollments to clockwork_service;

create function public.guard_payg_retained_history() returns trigger language plpgsql as $$
begin raise exception 'PAYG_RETAINED_HISTORY_IMMUTABLE'; end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['core_payg_source_measurements','core_payg_source_receipts','core_payg_period_revisions','core_payg_pending_invoice_effects'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.guard_payg_retained_history()', table_name || '_immutable', table_name);
  end loop;
end;
$$;
create function public.guard_payg_enrollment_snapshot() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'PAYG_ENROLLMENT_IMMUTABLE'; end if;
  if (new.snapshot - 'endsAt') is distinct from (old.snapshot - 'endsAt') or
    new.id <> old.id or new.account_id <> old.account_id or new.offer_version_id <> old.offer_version_id or
    new.source <> old.source or new.source_entitlement_id <> old.source_entitlement_id or
    new.binding_evidence_id <> old.binding_evidence_id or new.created_at <> old.created_at or
    old.snapshot ? 'endsAt' or not (new.snapshot ? 'endsAt') or
    new.cancellation_evidence_id is null or length(trim(new.cancellation_evidence_id)) = 0 then
    raise exception 'PAYG_ENROLLMENT_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger core_payg_enrollment_guard before update or delete on public.core_payg_enrollments
  for each row execute function public.guard_payg_enrollment_snapshot();
