-- The expiry sweep is the first writer `core_procurement_certificates` has ever
-- had. It upserts the same account, jurisdiction and document on every run, and
-- the table had no unique key to conflict on.
create unique index if not exists core_procurement_cert_identity_unique
  on public.core_procurement_certificates (account_id, kind, jurisdiction, document_id);

-- `status` has been constrained since 000100_core_finance.sql:62 to
-- (pending, valid, expired, revoked). Only the Drizzle model was missing it, so
-- that is corrected in packages/db/src/schema/core/finance.ts rather than here:
-- a second constraint on the same column would AND with the first and narrow the
-- shipped vocabulary, which is what an earlier draft of this migration did.
--
-- The sweep therefore records whether a certificate has lapsed and leaves how
-- close it is to lapsing to be recomputed on read. That is also the only correct
-- thing to persist: a stored "expiring" would be wrong the following morning
-- with no writer having touched the row.
alter table public.core_procurement_certificates
  drop constraint if exists core_procurement_cert_status_check;

comment on column public.core_procurement_certificates.status is
  'Lifecycle of the certificate record: pending until first assessed, valid, expired once past expires_on, or revoked by hand.';

comment on column public.core_procurement_certificates.kind is
  'Certificate class. The procurement profile exemption entries the sweep reads carry no kind, so every row it writes is tax_exemption.';
