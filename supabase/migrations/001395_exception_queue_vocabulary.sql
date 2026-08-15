-- `exception_cases.queue` was free text and `system_exception_roster.queue`
-- constrained shape only (`^[a-z][a-z0-9_]{1,63}$`, 001130:26), so four
-- disagreeing TypeScript declarations of the queue vocabulary had nothing
-- underneath them and any of the four could be wrong without a write failing.
-- The concrete harm is on the roster: a roster created for a queue nothing
-- raises (`provider_recovery` against §16's `provisioning_recovery`) is
-- accepted, and the real queue then has no eligible primary at the moment an
-- exception needs one — which surfaces as EXCEPTION_NO_ELIGIBLE_PRIMARY on the
-- exception, not as an error on the roster row that caused it.
--
-- The admitted set is spec §16's ten queues plus the six this platform actually
-- persists that §16 does not tabulate. It is NOT §16's ten alone: three writers
-- would fail immediately if it were.
--
--   order_acceptance_review  written by core_evaluate_order_acceptance
--                            (001000:996) and matched as a literal by
--                            exception_cases_order_acceptance_open_unique
--                            (001000:718) and by
--                            core_protect_order_acceptance_reservation
--                            (001000:788). Refusing it would break order
--                            acceptance inside the database.
--   billing_operations,      raised by the core workflow engine
--   commissions,             (packages/workflows/src/core/engine.ts:393, 410,
--   reconciliation,          465, 613, 728, 766, 790, 866, 954, 1039, 1107,
--   reporting,               1139, 1160, 1246, 1275). Every one is a live raise
--   workflow_operations      site, so none of them is dead.
--
-- What is already persisted, checked before writing this: exception_cases and
-- system_exception_roster are both empty on a reset database, supabase/seed.sql
-- writes neither table, and the only five writers of exception_cases.queue in
-- the tree (command-repository.ts:4445 via openExceptionPayloadSchema's seven,
-- workflows/core.ts:522 via the engine's six, exception-routing's integration
-- fixture, apps/web/e2e/production-proof.setup.ts:612, and 001000's trigger)
-- produce only values in the list below. So the constraints admit everything
-- that exists and everything that is written today.
--
-- Written for a populated table (ADR-0009): each constraint is added NOT VALID
-- and validated in its own statement under a bounded lock wait, and each DDL
-- statement commits on its own so a timed-out run resumes rather than restarts.
set lock_timeout = '5s';

alter table public.exception_cases
  drop constraint if exists exception_cases_queue_vocabulary_check;
alter table public.exception_cases
  add constraint exception_cases_queue_vocabulary_check
  check (queue in (
    'pricing',
    'legal',
    'credit_collections',
    'restricted_parties',
    'disputes',
    'deal_registration_disputes',
    'poc_qualification',
    'provisioning_recovery',
    'migration_review',
    'offboarding_destructive',
    'order_acceptance_review',
    'billing_operations',
    'commissions',
    'reconciliation',
    'reporting',
    'workflow_operations'
  ))
  not valid;
alter table public.exception_cases
  validate constraint exception_cases_queue_vocabulary_check;

-- Same list on the roster. The shape check from 001130 stays: it is what keeps
-- the column a safe identifier, and this one is about membership. A roster row
-- is the only thing that makes a queue ownable, so a queue name the raise path
-- can never produce is a roster that can never be used.
alter table public.system_exception_roster
  drop constraint if exists system_exception_roster_queue_vocabulary_check;
alter table public.system_exception_roster
  add constraint system_exception_roster_queue_vocabulary_check
  check (queue in (
    'pricing',
    'legal',
    'credit_collections',
    'restricted_parties',
    'disputes',
    'deal_registration_disputes',
    'poc_qualification',
    'provisioning_recovery',
    'migration_review',
    'offboarding_destructive',
    'order_acceptance_review',
    'billing_operations',
    'commissions',
    'reconciliation',
    'reporting',
    'workflow_operations'
  ))
  not valid;
alter table public.system_exception_roster
  validate constraint system_exception_roster_queue_vocabulary_check;

comment on column public.exception_cases.queue is
  'One of the sixteen queues in exceptionQueues (packages/domain/src/exceptions/index.ts): spec §16''s ten plus the six operational queues the platform raises. Enforced by exception_cases_queue_vocabulary_check.';
comment on column public.system_exception_roster.queue is
  'Same vocabulary as exception_cases.queue. A roster row for a queue nothing raises is unreachable, so membership is enforced here rather than only shape.';

reset lock_timeout;
