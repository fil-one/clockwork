# Production capability controls

Production migrations leave new business, legal, billing, partner, marketplace,
and teardown disabled, including recovery work. The demo seed explicitly turns
on its fictional development paths; **never apply `supabase/seed.sql` to staging
or production**. Migration 001423 changes only the old migration-owned defaults,
so an existing explicit operator decision is preserved.

Use `/internal/capabilities` with an authenticated, MFA-verified staff identity.
An internal operator requests activation of either new work or recovery work,
with a reason and an evidence reference. The request freezes the capability
version, scope, requester, and evidence. A different finance approver approves
commercial capabilities; legal and teardown require a legal approver and a
destructive-action approver respectively. Requests expire after 24 hours.
Rejected or canceled requests remain persisted; the audit/outbox ledger records
proposals, decisions, and shutdowns. Refresh after a version conflict.

An operator can immediately disable new work or recovery work with a reason. The
other scope remains unchanged. Disabling cancels pending requests for that
capability, preventing a delayed approval from undoing the shutdown. A restore
always requires a new proposal and a distinct approver. Recently authenticated,
unassisted sessions are required for all control actions. Staff membership and
MFA enrollment are rechecked in the database at mutation time.

Enabling a software capability does not activate an external gate. Provider
execution still checks the external gate register and activation-test evidence.
Review `/internal/gates` before activation. Capability administration displays
no simulated production records when its service database is unavailable.

Before initial staff onboarding, provision real WorkOS users, organizations,
verified MFA, and the necessary staff memberships through the approved identity
process. Keep provider secrets in the environment/secret manager. The capability
migration is safe initialization of the switches; it does not invent staff,
commercial catalog, legal evidence, provider references, or Fil One mappings.
Use the safe bootstrap manifest described in `production-bootstrap.md` for a
fresh database. The worker derives its required provider set from persisted
new-work and recovery switches. Disabled providers require no credentials and
return an explicit denial if called. Restart the worker after activating a
capability whose providers were omitted at boot. Outbound CRM is separately
opted in with `CLOCKWORK_CRM_ENABLED=true`; its credentials remain required when
it is enabled.
