-- The scheduled SignWell check (`system.esign.reconcile.v1`) reads a bounded
-- number of open requests per run. A check that finds nothing new writes
-- nothing, so ordering by `updated_at` alone read the same oldest requests every
-- run and newer ones could wait indefinitely. `reconciled_at` records when the
-- check last picked a request, so runs rotate through every open request.
--
-- It is bookkeeping, like the lease columns: written alone, never audited, and
-- it leaves `updated_at`, `version` and every visible field unchanged. Neither
-- table's update trigger reads it. No index: the check filters a few hundred
-- open rows at most, which the existing state and primary-key indexes cover.
alter table public.commerce_mnda_requests
  add column reconciled_at timestamptz;

alter table public.commerce_contract_signing
  add column reconciled_at timestamptz;

comment on column public.commerce_mnda_requests.reconciled_at is
  'When the scheduled SignWell check last picked this request; orders the next checks. Not a change to the request.';
comment on column public.commerce_contract_signing.reconciled_at is
  'When the scheduled SignWell check last picked this signing request; orders the next checks. Not a change to the request.';
