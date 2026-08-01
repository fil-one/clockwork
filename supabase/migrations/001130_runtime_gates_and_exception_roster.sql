alter table system_external_gates
  add column emergency_disabled_at timestamptz,
  add column emergency_disabled_by text,
  add column emergency_disable_reason text,
  add column emergency_disable_evidence_reference text,
  add constraint system_external_gates_emergency_state_check check (
    (
      emergency_disabled_at is null
      and emergency_disabled_by is null
      and emergency_disable_reason is null
      and emergency_disable_evidence_reference is null
    ) or (
      emergency_disabled_at is not null
      and emergency_disabled_by is not null
      and emergency_disable_reason is not null
      and emergency_disable_evidence_reference is not null
      and length(trim(emergency_disabled_by)) > 0
      and length(trim(emergency_disable_reason)) >= 8
      and length(trim(emergency_disable_evidence_reference)) > 0
    )
  );

create table system_exception_roster (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  queue text not null check (queue ~ '^[a-z][a-z0-9_]{1,63}$'),
  user_id uuid not null references commerce_users(id),
  role text not null check (role in ('primary','backup','escalation')),
  active boolean not null default false,
  qualification_evidence_reference text not null
    check (length(trim(qualification_evidence_reference)) > 0),
  qualified_until timestamptz not null,
  absent_from timestamptz,
  absent_until timestamptz,
  target_minutes integer not null check (target_minutes between 1 and 43200),
  priority integer not null default 100 check (priority between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint system_exception_roster_absence_check check (
    (absent_from is null and absent_until is null)
    or (
      absent_from is not null
      and absent_until is not null
      and absent_from < absent_until
    )
  ),
  constraint system_exception_roster_assignment_unique
    unique (account_id, queue, user_id, role)
);

create index system_exception_roster_resolution_idx
  on system_exception_roster(account_id, queue, active, role, priority);
create trigger system_exception_roster_version
before update on system_exception_roster
for each row execute function touch_versioned_row();

create table system_external_gate_activation_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique check (length(trim(task_key)) >= 8),
  gate_key text not null references system_external_gates(gate_key),
  provider text not null check (length(trim(provider)) > 0),
  mode text not null check (mode in ('live','simulator')),
  status text not null default 'pending' check (
    status in (
      'pending','probing','provider_succeeded','succeeded','retrying','dead_letter'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  probe_result jsonb,
  last_error text,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1 check (row_version > 0),
  constraint system_gate_activation_result_check check (
    status not in ('provider_succeeded','succeeded') or probe_result is not null
  ),
  constraint system_gate_activation_completed_check check (
    (status = 'succeeded' and completed_at is not null)
    or (status <> 'succeeded' and completed_at is null)
  ),
  constraint system_gate_activation_lease_check check (
    (
      status in ('probing','provider_succeeded')
      and lease_token is not null
      and lease_until is not null
    ) or (
      status not in ('probing','provider_succeeded')
      and lease_token is null
      and lease_until is null
    )
  )
);

create index system_gate_activation_recovery_idx
  on system_external_gate_activation_tasks(status, next_attempt_at, created_at);
create index system_gate_activation_gate_idx
  on system_external_gate_activation_tasks(gate_key, provider, created_at);
create trigger system_gate_activation_tasks_version
before update on system_external_gate_activation_tasks
for each row execute function touch_versioned_row();

alter table system_exception_roster enable row level security;
alter table system_exception_roster force row level security;
create policy system_exception_roster_internal on system_exception_roster
for all using (app_is_internal()) with check (app_is_internal());

alter table system_external_gate_activation_tasks enable row level security;
alter table system_external_gate_activation_tasks force row level security;
create policy system_external_gate_activation_tasks_internal
on system_external_gate_activation_tasks
for all using (app_is_internal()) with check (app_is_internal());

grant select, insert, update, delete on
  system_exception_roster,
  system_external_gate_activation_tasks
to clockwork_runtime, clockwork_service;
