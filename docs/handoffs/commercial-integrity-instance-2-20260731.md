# Commercial integrity Instance 2 handoff — 2026-07-31

Current disposition: historical provenance. This lane and its cross-lane joins
were considered integrated and repository-qualified when this handoff was
written; the current backlog controls present status, and this handoff does not
declare an RC/launch.

Branch: `rc/commercial-integrity`

Worktree: `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-commercial`

Base: `27fb33bab754b001acf26134d988daa10d177390`

Commits:

- `9ae768cb138940efaf1034d463aef1e43d0294e1` — isolated shared-contract addition
  of the `collection_case` audit aggregate (one insertion).
- `ecf5574c5f496475f57ff190f79a2e03df323892` — commercial integrity
  implementation (83 files, 12,982 insertions, 631 deletions).
- This handoff is committed separately after the implementation evidence.

No main or parallel lane was merged. No generated API artifact, root manifest,
lockfile, CI file, backlog, canonical specification, release report, shared
traceability ledger, `apps/web/**`, `packages/ui/**`, or `packages/documents/**`
was changed.

## Migration

The only added migration is
`supabase/migrations/001000_commercial_database_integrity.sql`. It is a
forward-only addition inside the assigned `001000–001099` range; no applied
migration was edited.

Migration `001000` adds or strengthens:

- persisted system capabilities and fail-closed capability checks;
- confidential quote, commercial audit, partner MoR, renewal, provisioning, and
  offboarding RLS;
- authoritative buyer/partner identity, agreement pinning, and relationship
  validation;
- transaction-locked order-acceptance reservations, collection holds, partner
  credit exposure, review ownership, and provisioning-outbox guards;
- narrow `clockwork_runtime` collection-case/action writes and acting-user or
  applicable-adjustment audit visibility;
- source-currency, source-order, ceiling, immutability, and optimistic-version
  constraints for adjustments;
- verified partner-to-QBO vendor mappings and settlement/provider convergence;
- persisted Stripe adjustment operations with exact provider binding,
  idempotency, state convergence, and per-object webhook watermarks;
- recoverable offboarding and two-distinct-approval teardown invariants.

`pnpm db:reset` applied the complete schema from zero through `001000`.
`pnpm db:diff` then reported `No schema changes found`.

## Delivered behavior

### Partner orders, holds, and legal parties

- Referral, resale, and distributor acceptance now loads the issued quote, buyer
  and partner accounts, active governing agreements, and relationship or
  deal-registration provenance from authoritative database state.
- Accepted orders persist the exact quote/agreement versions, commercial party
  identities, invoice account, command idempotency, optimistic version, audit,
  and outbox evidence. Resale/distributor invoice routing follows the persisted
  partner MoR; end clients cannot read confidential partner fields.
- Acceptance locks `new_service_blocked`, collection state, and partner
  exposure/payment policy in one transaction. A denial creates an owned review
  and no provisioning outbox. Existing service is unchanged. Direct, referral,
  and resale paths fail closed until authoritative release, and concurrent
  reservations cannot overspend partner credit.
- Tests cover valid commands, forged or cross-tenant counterparties, stale and
  concurrent acceptance, hold release, MoR identity, and legal-party routing.

### Order lifecycle and POC relationships

- Ordinary account/partner callers can no longer issue generic lifecycle
  commands to force provisioning, active, completed, cancelled, or terminated
  states. Activation requires a verified provider event.
- Cancellation and non-renewal create recoverable offboarding/final-billing
  work. Destructive teardown remains behind two distinct durable approvals;
  self-approval, replay, stale version, and unsettled billing are rejected.
- Provider/local convergence and crash recovery are enforced and tested across
  every source state.
- POC partner identity is derived only from a current approved relationship or
  converted deal registration for the exact workload. Repository, API, and pgTAP
  tests reject forged relationships and prevent evidence visibility before
  tenant authorization succeeds.

### Credits, refunds, Stripe, and commissions

- Stripe adjustment commands derive customer, invoice, payment, provider object,
  amount, currency, and available ceiling from persisted state. Caller input
  cannot assert Stripe truth or provider success.
- The submitter durably leases operations, uses persisted idempotency, records
  provider acceptance before local pending projection, and safely resumes
  timeout or crash-after-provider-success cases.
- Signed event projection uses independent credit-note/refund watermarks,
  rejects identifier/currency/amount mismatches and reordered state regression,
  and derives terminal refund state from the applicable signed update rather
  than `refund.created`. Aggregate and individual adjustment ceilings are
  transactionally enforced; failure/cancellation creates commission
  compensation.
- Commission settlement carries persisted partner identity through a verified
  QBO vendor mapping, binds a replay-safe external bill/posting, settles exactly
  the included eligible accruals, and atomically appends settlement, audit, and
  outbox state. Cross-partner/mixed-state lines, stale drafts, replays, crashes,
  and concurrent double-pay attempts are rejected.

### Scheduling, capabilities, and external gates

- The core workflow dispatch plan now has real Trigger schedules plus durable
  submitter/outbox occurrence records for overage, dunning, partner-credit
  review, usage reconciliation, monthly platform/Stripe/QBO tie-out, and report
  export. Tests cover duplicate delivery, crash, retry, replay, and recovery.
- Persisted capability checks protect new-business, legal, billing, partner,
  marketplace, and teardown command boundaries against direct APIs, stale
  clients, and replay. Independently authorized recovery remains available.
- `EXT-COMMERCIAL-01` and `EXT-TAX-01` repository simulators, controls,
  enforcement, and activation tests are complete. Neither gate is marked active.
  No real credential, production effect, or fabricated signed input was used;
  production composition continues to fail closed without authoritative gate
  evidence.

## Interfaces and integration surface

- Contracts: `EntityName` now admits `collection_case` so an owned collection
  review can carry exact audit/version evidence.
- Database: `DatabaseSystemCapabilityGuard`, persisted Stripe adjustment
  repository/store, order-acceptance reservation and release functions,
  commission settlement convergence, and durable core schedule occurrence and
  dispatch stores.
- API/repository: partner-order authorization derives scope through
  `LifecycleAuthorizationScopeResolver.resolveOrderScope`; POC and order paths
  take identifiers as lookup keys, not proof of relationship or payment truth.
- Integrations/workflows: `PersistedStripeAdjustmentSubmitter`, signed Stripe
  projection, `CommissionSettlementAccountingPort`, verified QBO vendor mapping,
  scheduled outbox handler/runtime, and Trigger schedule registration.
- Runtime composition must supply the database-backed capability, schedule,
  Stripe operation, and partner-vendor mapping stores. In-memory/fake ports stay
  limited to deterministic tests and cannot activate either external gate.

## Verification evidence

All commands used Node `24` from `/opt/homebrew/opt/node@24/bin`.

| Verification                     | Result                                  | Timing/evidence                               |
| -------------------------------- | --------------------------------------- | --------------------------------------------- |
| Reset from zero                  | passed                                  | schema through `001000`                       |
| Full pgTAP                       | 13 files, 322 tests                     | 1.75 s real                                   |
| Schema diff                      | passed                                  | no schema changes found                       |
| DB integrations, isolated        | 10 files, 51 tests, twice consecutively | 7.58 s / 6.88 s real                          |
| Forced full workspace test run 1 | 20/20 tasks, 621 tests, no cache        | Turbo 39.457 s; 39.96 s real                  |
| Forced full workspace test run 2 | 20/20 tasks, 621 tests, no cache        | Turbo 34.928 s; 35.98 s real                  |
| Forced workspace typecheck       | 10/10 tasks, no cache                   | 1m11.442s                                     |
| Forced workspace build           | 10/10 tasks, no cache                   | 1m35.772s; Next produced 55 pages             |
| Lint, formatting, secret scan    | passed                                  | also passed implementation pre-commit hook    |
| Dependency boundaries            | passed                                  | 667 modules, 1,787 dependencies, 0 violations |
| Contracts unit                   | 1 file, 2 tests                         | 313 ms                                        |
| Final DB repository integration  | 10 files, 51 tests                      | 13.42 s                                       |

The two forced full runs exercised unit and integration suites in parallel at
the workspace level. Database integration files are intentionally serialized to
prevent shared-reset/fixture interference; concurrency assertions within the
files still run concurrently. Their relevant counts were: DB 54, domain 128,
integrations 80, workflows 106, API 58, and testing utilities 42. Unchanged web,
UI, and document suites also passed in both runs.

Database lint reports one pre-existing warning: `public.app_context_is_valid` is
marked `STABLE` while calling a volatile function. Exact `public` schema lint
produced no new migration warning. Full lint additionally reports pgTAP
extension diagnostics. Assertions and lint policy were not weakened.

## Personal review

Every security, financial, concurrency, and migration change from the three
exclusive work areas was personally reviewed after integration. The review
specifically traced RLS/grants and security-definer search paths, authoritative
agreement and legal-party derivation, lock ordering and optimistic versions,
money/currency ceilings, provider idempotency and signed-event convergence,
commission settlement atomicity, teardown approvals, durable scheduling, and
forward-only migration behavior.

## Cross-lane joins

1. Apply `001000` after the existing migrations and before starting commercial
   workers. Do not reproduce or renumber its objects in another lane.
2. Preserve the isolated `collection_case` contract value when reconciling
   shared contract work. No generated API file needs to be carried from this
   lane; regenerate once after all lanes join.
3. Compose the database-backed capability guard and schedule occurrence/outbox
   stores into API/worker bootstrap. A missing persisted dependency must remain
   fail closed.
4. Bind the Stripe submitter/projector to the existing signed raw-webhook path
   and the QBO settlement port to verified partner vendor mappings. Never map
   from caller-supplied provider identifiers.
5. Retain database integration file serialization in the final test config;
   repository concurrency coverage remains inside the tests. Re-run reset,
   pgTAP, the 51 DB integrations, and two forced full workspace executions after
   cross-lane composition.
6. External-gate owners must provide real signed commercial/tax evidence through
   the canonical activation process. This lane supplies controls and tests only;
   `EXT-COMMERCIAL-01` and `EXT-TAX-01` remain inactive.
