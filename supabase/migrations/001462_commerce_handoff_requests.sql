-- Handoff requests: a seller hands a signed contract to operations so the
-- counterparty becomes a customer or partner organization in Commerce.
--
-- A request names one or more signed contracts from the register (status
-- `executed`, or a template contract whose signing completed), and may name
-- the completed MNDA and a saved pricing scenario that go with them. Operations
-- staff take it, then complete or decline it; a completed request may record
-- the organization operations created.
--
-- Staff reach the table through server code on the service role: sellers with
-- `contract:write` raise requests and read their own, `operations:read` reads
-- the queue, and `operations:write` (internal operators and commerce
-- administrators) takes, completes and declines. Every change writes a
-- `handoff.*` audit event in the same transaction. Customer identities have no
-- grants.
set lock_timeout = '5s';

create table if not exists public.commerce_handoff_requests (
  id uuid primary key,
  requested_by_id uuid not null,
  requested_by_name text not null
    check (length(btrim(requested_by_name)) between 1 and 200),
  counterparty_legal_name text not null
    check (length(btrim(counterparty_legal_name)) between 1 and 200),
  signer_name text not null check (length(btrim(signer_name)) between 1 and 200),
  signer_email text not null
    check (length(signer_email) <= 320 and signer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  signer_title text not null default '' check (length(signer_title) <= 200),
  contract_ids uuid[] not null check (cardinality(contract_ids) between 1 and 10),
  mnda_id uuid references public.commerce_mnda_requests(id),
  -- Scenarios can be deleted by their owner, so this is a reference checked
  -- when the request is raised, not a foreign key.
  pricing_scenario_id uuid,
  requested_side text not null check (requested_side in ('customer','partner')),
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'open'
    check (status in ('open','in_progress','done','declined')),
  assignee_id uuid,
  assignee_name text
    check (assignee_name is null or length(btrim(assignee_name)) between 1 and 200),
  decision_note text
    check (decision_note is null or length(btrim(decision_note)) between 1 and 2000),
  decided_by_id uuid,
  decided_at timestamptz,
  organization_id uuid references public.organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint commerce_handoff_requests_assignee_check
    check ((assignee_id is null) = (assignee_name is null)),
  constraint commerce_handoff_requests_in_progress_check
    check (status <> 'in_progress' or assignee_id is not null),
  constraint commerce_handoff_requests_decided_check
    check ((status in ('done','declined')) = (decided_at is not null and decided_by_id is not null)),
  constraint commerce_handoff_requests_declined_note_check
    check (status <> 'declined' or decision_note is not null)
);

comment on table public.commerce_handoff_requests is
  'Signed contracts handed from sales to operations to become a customer or partner organization. Service role only; every change is audited as handoff.*.';

create index if not exists commerce_handoff_requests_requester
  on public.commerce_handoff_requests (requested_by_id, created_at desc, id desc);

create index if not exists commerce_handoff_requests_queue
  on public.commerce_handoff_requests (status, created_at, id);

create index if not exists commerce_handoff_requests_contracts
  on public.commerce_handoff_requests using gin (contract_ids);

-- What a request names is checked when it is raised: every contract is
-- signed, a contract is in at most one request that was not declined, the
-- MNDA completed and the scenario exists. After that only the status, the
-- assignee, the decision and the organization move, along the transitions
-- below, and the version advances by one with each change.
create or replace function public.guard_commerce_handoff_request() returns trigger
language plpgsql set search_path = public as $$
declare
  contract uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.assignee_id is not null or new.decision_note is not null
       or new.decided_at is not null or new.organization_id is not null or new.version <> 1 then
      raise exception using errcode = 'P0001', message = 'HANDOFF_REQUEST_MUST_START_OPEN';
    end if;
    if cardinality(new.contract_ids) <> (select count(distinct id) from unnest(new.contract_ids) id) then
      raise exception using errcode = 'P0001', message = 'HANDOFF_CONTRACT_REPEATED';
    end if;
    -- Lock each contract in a fixed order so two requests for the same
    -- contract raised at once run one after the other.
    for contract in select id from unnest(new.contract_ids) id order by id loop
      perform pg_advisory_xact_lock(hashtextextended('commerce_handoff:' || contract::text, 0));
      if not exists (
        select 1 from public.commerce_contracts c
        where c.id = contract
          and (c.status = 'executed' or exists (
            select 1 from public.commerce_contract_signing s
            where s.contract_id = c.id and s.state = 'completed'))
      ) then
        raise exception using errcode = 'P0001', message = 'HANDOFF_CONTRACT_NOT_SIGNED';
      end if;
    end loop;
    if exists (
      select 1 from public.commerce_handoff_requests other
      where other.contract_ids && new.contract_ids and other.status <> 'declined'
    ) then
      raise exception using errcode = 'P0001', message = 'HANDOFF_ALREADY_REQUESTED';
    end if;
    if new.mnda_id is not null and not exists (
      select 1 from public.commerce_mnda_requests m
      where m.id = new.mnda_id and m.state = 'completed'
    ) then
      raise exception using errcode = 'P0001', message = 'HANDOFF_MNDA_NOT_COMPLETED';
    end if;
    if new.pricing_scenario_id is not null and not exists (
      select 1 from public.commerce_pricing_scenarios p where p.id = new.pricing_scenario_id
    ) then
      raise exception using errcode = 'P0001', message = 'HANDOFF_PRICING_SCENARIO_NOT_FOUND';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.requested_by_id <> old.requested_by_id
     or new.requested_by_name <> old.requested_by_name
     or new.counterparty_legal_name <> old.counterparty_legal_name
     or new.signer_name <> old.signer_name or new.signer_email <> old.signer_email
     or new.signer_title <> old.signer_title or new.contract_ids <> old.contract_ids
     or new.mnda_id is distinct from old.mnda_id
     or new.pricing_scenario_id is distinct from old.pricing_scenario_id
     or new.requested_side <> old.requested_side or new.notes <> old.notes
     or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'HANDOFF_REQUEST_IMMUTABLE';
  end if;
  if new.version <> old.version + 1 then
    raise exception using errcode = 'P0001', message = 'HANDOFF_VERSION_MUST_ADVANCE';
  end if;
  if old.status in ('done','declined') then
    raise exception using errcode = 'P0001', message = 'HANDOFF_REQUEST_CLOSED';
  end if;
  if not (
    (old.status = 'open' and new.status in ('in_progress','declined'))
    or (old.status = 'in_progress' and new.status in ('in_progress','done','declined'))
  ) then
    raise exception using errcode = 'P0001', message = 'HANDOFF_TRANSITION_INVALID';
  end if;
  if old.organization_id is not null and new.organization_id is distinct from old.organization_id then
    raise exception using errcode = 'P0001', message = 'HANDOFF_ORGANIZATION_IMMUTABLE';
  end if;
  return new;
end $$;

drop trigger if exists guard_commerce_handoff_request on public.commerce_handoff_requests;

create trigger guard_commerce_handoff_request
  before insert or update on public.commerce_handoff_requests
  for each row execute function public.guard_commerce_handoff_request();

alter table public.commerce_handoff_requests enable row level security;

alter table public.commerce_handoff_requests force row level security;

revoke all on public.commerce_handoff_requests
  from public, anon, authenticated, clockwork_runtime, clockwork_service;

revoke all on function public.guard_commerce_handoff_request() from public;

-- Requests are never deleted: a mistaken one is declined with a note.
grant select, insert, update on public.commerce_handoff_requests to clockwork_service;

drop policy if exists handoff_requests_service on public.commerce_handoff_requests;

create policy handoff_requests_service on public.commerce_handoff_requests
  for all to clockwork_service using (true) with check (true);

reset lock_timeout;
