-- THE INVOICE HEADER CAN ONLY SAY FOUR OF THE SIX THINGS A DETERMINATION SAYS.
--
-- `invoices_tax_treatment_check` (001392:36-38) admits
-- ('not_determined','standard','reverse_charge','exempt'). The determination
-- engine's vocabulary — `TaxTreatment` in packages/contracts/src/providers.ts:157
-- and the rows the engine actually emits in
-- packages/domain/src/core/tax/engine.ts — is six values:
--
--   standard, reverse_charge, zero_rated, exempt, out_of_scope, not_registered
--
-- Two of the missing pair are not decoration and neither collapses into
-- `exempt`, which is the value they would otherwise be written as:
--
--   * `zero_rated` is in scope at 0% and the input tax behind it stays
--     recoverable; `exempt` is in scope at nothing and the input tax is lost.
--     Same zero on the bill, a different number in the accounts.
--   * `out_of_scope` must not appear in a VAT return at all, so it cannot share
--     a value with `exempt`, which must.
--   * `not_registered` is the value a registration-threshold breach is counted
--     from (001410 states the rule, 001411 carries the threshold). Written as
--     `exempt` the breach is invisible: the engine's `not_registered` rows are
--     the only evidence that a run of untaxed supplies is approaching a
--     jurisdiction's limit, and 001392's vocabulary had nowhere to put them.
--
-- Refusing a determination the engine legitimately reached is a control that
-- blocks a legitimate operation, which this project has already paid for six
-- times. `not_determined` stays, unchanged in meaning: rows written before any
-- determination existed, refused by the writer, describing history only.
set lock_timeout = '5s';

alter table public.invoices
  drop constraint if exists invoices_tax_treatment_check;
alter table public.invoices
  add constraint invoices_tax_treatment_check
  check (tax_treatment in (
    'not_determined',
    'standard',
    'reverse_charge',
    'zero_rated',
    'exempt',
    'out_of_scope',
    'not_registered'
  ))
  not valid;
alter table public.invoices validate constraint invoices_tax_treatment_check;

-- DOES "ONLY STANDARD ADMITS A NON-ZERO AMOUNT" SURVIVE THE FOUR NEW VALUES?
-- It does, and `reverse_charge` — the one worth checking, because it is the
-- treatment on a supply that IS taxed — is zero here for a reason that is not
-- an accident of the fixture. Taken one at a time:
--
--   reverse_charge  The tax is real and it is assessed by the CUSTOMER under
--                   their own regime. Our document carries the notation and no
--                   figure. A merchant charging on a reverse-charged line
--                   charges tax the buyer will also self-account for, so the
--                   amount is zero on OUR invoice by definition, not by policy.
--   zero_rated      In scope at 0%: the rate is zero, so the amount is.
--   exempt          No tax arises.
--   out_of_scope    No authority has ruled; nothing to charge.
--   not_registered  A real rate in a real jurisdiction that we may not charge
--                   because we hold no registration there. Charging it would be
--                   collecting tax we have no authority to collect.
--
-- So `invoices_tax_amount_check` (001392:49-52) is carried forward EXACTLY as
-- written. It is deliberately not re-stated as a list of zero-only treatments:
-- the invariant is "one treatment admits an amount", and a list would have to
-- be edited every time the vocabulary grows, which is how the vocabulary and
-- the amount rule drift apart.
--
-- THE ONE THING THIS CHECK CANNOT SAY, stated so nobody reads more into it than
-- it holds: `invoices.tax_treatment` is a SCALAR on a document whose lines can
-- disagree. A bill with one standard line and one reverse-charged line carries
-- a non-zero amount and must therefore record `standard` at the header, and the
-- reverse charge — including the notation the document is legally required to
-- print — is invisible at this grain. The header is a summary; the per-line,
-- per-jurisdiction truth needs its own table, and until that table exists a
-- mixed-treatment invoice loses information here. No writer in this tree
-- currently produces a mixed determination, so nothing is silently lost today.
comment on column public.invoices.tax_treatment is
  'How the merchant of record treated this supply, in the determination engine''s six-value vocabulary (contracts TaxTreatment) plus not_determined for rows written before any determination existed. A scalar summary of a document whose lines may disagree; only standard admits a non-zero tax_minor.';

reset lock_timeout;
