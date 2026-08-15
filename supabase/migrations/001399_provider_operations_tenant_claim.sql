-- `create_signature_envelope` could not execute. Not once, in any environment.
--
-- It is neither a `providerCommand` nor a `staffServiceCommand`
-- (packages/db/src/repositories/lifecycle/command-repository.ts), so it runs
-- under `withAuthorizedTransaction` as `clockwork_runtime`, and its
-- `provider_operations` insert was refused by `provider_operations_internal`
-- -- `app_is_internal()` is literally `current_user = 'clockwork_service'`
-- (000001_foundation.sql) -- with
-- `42501 new row violates row-level security policy for table
-- "provider_operations"`. The only HTTP route that reaches the command,
-- `POST /v1/lifecycle/agreements/envelopes`, requires `agreement:execute`,
-- which is held by `owner`, `admin` and `partner_admin` and by NO internal
-- role (packages/contracts/src/auth.ts), so no caller could ever have arrived
-- as the service connection. The whole counter-signed envelope path was dead.
--
-- The approving half of `decide_poc` was dead for the same reason: on
-- `decision = 'approved'` it claims a `provisioning`/`sandbox` operation
-- (command-repository.ts, `decidePoc`) from a route gated on `poc:manage`,
-- which `owner`, `admin` and `partner_admin` also hold. The rejecting half,
-- which claims nothing, worked -- which is why the command looked alive.
--
-- WHY A POLICY AND NOT A POOL CHANGE. Three fixes were available and two are
-- wrong:
--
--   * Classifying the commands as `staffServiceCommand` does nothing. That
--     branch only diverts to the service pool when the caller
--     `isInternalStaff`, and no internal role holds `agreement:execute` or is
--     the account owner these commands are scoped to, so every real caller
--     would still land on the tenant pool and still be refused. Forcing them
--     onto the service pool unconditionally would work, and would take the
--     draft read, the envelope insert, the document evidence read and the
--     audit append out of row-level security entirely for a write a customer
--     initiates -- the same standing exit from RLS that P0-54 declined.
--   * Gating the routes on internal staff would refuse the only callers the
--     permission model admits. §8 of the spec has counter-signed documents
--     executing "through embedded signing with a redirect fallback": the
--     response to this route is a signing session for the tenant's browser.
--     A control that blocks the legitimate flow is not a fix.
--   * Granting `clockwork_runtime` membership in `clockwork_service` is the
--     trap, and is refused here as it was in P0-54.
--
-- What is actually missing is the append policy this table's sibling already
-- has. `lifecycle_provisioning_attempts` is the same kind of record -- an
-- operational row a tenant action creates and only the platform advances --
-- and 000200 gave it exactly that split: `lifecycle_provisioning_insert`
-- admits `app_has_account(account_id)`, `lifecycle_provisioning_update_internal`
-- admits nobody else, and `update, delete` are revoked from
-- `clockwork_runtime`. `outbox_messages` has the same shape in
-- `outbox_tenant_append`. `provider_operations` never got it.
--
-- So this migration gives `provider_operations` the same treatment, and no
-- more. The tenant connection may append a FRESH, UNSTARTED claim, for the two
-- provider calls a tenant command actually makes, against an aggregate whose
-- account the caller already holds. It may not read one, advance one, retry
-- one, clear an error on one, or delete one: `provider_operations_internal`
-- still owns `select`, `update` and `delete`, and the `update`/`delete`
-- privileges are revoked below so the tenant pool cannot reach those verbs
-- even if a future policy is written carelessly.
set lock_timeout = '5s';

-- Scoped to `clockwork_runtime` rather than to `public` so it cannot widen
-- anything the service connection does; `provider_operations_internal` remains
-- the only policy that connection needs.
--
-- The two arms enumerate the exact claims the two commands write. That is
-- deliberate: a third tenant-reachable provider call should fail loudly here
-- and be reviewed, not inherit an admission nobody looked at. The leading
-- conjuncts pin the row to an unstarted claim, so a tenant cannot use the
-- append to assert that a provider call already ran, already failed, or is
-- already scheduled for a retry.
create policy provider_operations_tenant_claim on provider_operations
  for insert to clockwork_runtime
  with check (
    status = 'pending'
    and attempt_count = 0
    and provider_reference is null
    and last_error is null
    and next_attempt_at is null
    and (
      -- `createSignatureEnvelope`: the counter-signed e-sign envelope claim.
      -- The aggregate is the agreement draft, and the command has already
      -- refused any draft whose `execution_mode` is not `counter_signed`; the
      -- policy says the same thing independently rather than trusting it.
      (
        provider = 'esign'
        and operation = 'create_envelope'
        and aggregate_type = 'agreement'
        and exists (
          select 1
          from public.lifecycle_agreement_drafts draft
          where draft.id = provider_operations.aggregate_id
            and draft.execution_mode = 'counter_signed'
            and app_has_account(draft.account_id)
        )
      )
      -- `decidePoc` on approval: the isolated sandbox provisioning claim.
      -- Only `pocs.account_id` is admitted, not `partner_account_id`: the
      -- command loads the POC by `account_id` and asserts the caller holds it,
      -- so that is the whole reachable shape. A partner-scoped decision would
      -- be a new flow and should be reviewed here before it works.
      or (
        provider = 'provisioning'
        and operation = 'sandbox'
        and aggregate_type = 'poc'
        and exists (
          select 1
          from public.pocs poc_record
          where poc_record.id = provider_operations.aggregate_id
            and app_has_account(poc_record.account_id)
        )
      )
    )
  );

-- Every writer that advances a claim -- `ingestProvisioningEvent`,
-- `recoverProvisioning`, `decideTermination`, the workflow exception claim in
-- packages/db/src/repositories/workflows/core.ts -- opens an internal
-- transaction on the service pool. Nothing on the tenant pool updates or
-- deletes this table, so revoking the privileges removes a reachable verb and
-- no reachable behaviour.
revoke update, delete on provider_operations from clockwork_runtime;
