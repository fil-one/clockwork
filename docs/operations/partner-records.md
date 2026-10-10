# Partner records and the partner-portal engine

Commerce has two places that know about partners. They do not share data.

## Staff partner records (in use)

`/internal/partners` is the revenue team's record of each partner: models,
status, owner, contacts, next step, the terms agreed (commission or revenue
share, step-down schedule, margin, territory, exclusivity, currency, NFR
allowance, trial) and the deals the partner registered with us. Staff enter
everything; the partner never sees it.

- Tables: `commerce_partners` and `commerce_partner_deals` (migration 001466).
  Service role only, with forced row security; customer identities have no
  grants. Rows are never deleted.
- Access: `sales:read` reads, `contract:write` changes. The web layer checks
  both on every page, action and export, as it does for contracts.
- Audit: every create and edit writes a `partner.*` event to `audit_events` in
  the same transaction (`partner.created`, `partner.updated`,
  `partner.deal_registered`, `partner.deal_updated`, `partner.deal_expired`,
  `partner.list_exported`). Edits record each changed field with its value
  before and after; the partner page shows them under History.
- Sanity bounds only: rates from 0 to 100 with up to four decimals, sizes above
  zero, protection that does not end before registration. No commission ceiling
  and no approval step.
- Overlaps: an end client is matched across partners with
  `commerce_mnda_normalize_company`, the same normalizer the MNDA and contract
  duplicate warnings use. Another partner's open registration (registered,
  accepted or disputed, still protected) is shown as a warning and never blocks
  a save.
- Protection: a registration with no end date takes `defaultProtectionDays` from
  `core_current_channel_policy()`, which is 90 days when no channel policy is
  approved. Reads mark registered or accepted deals past their protection as
  expired, each as an audited system change.
- Next steps: `PartnerRepository.nextStepsDue({ through, today, ownerId? })`
  returns every partner whose next step is due on or before `through`, with
  `overdue` set, excluding ended partners. A reminder or notification reads
  this; the home page counts the same rows with `countPartnerNextSteps`.

## Partner-portal engine (switched off)

The partner portal (`/partner/*`), its deal-registration engine
(`deal_registrations`, `packages/domain` partners) and the referral commission
model (one flat rate per partner account, set through the API, snapshotted per
quote by migration 001426) serve partners who have a Commerce account and sign
in themselves. They sit behind the `partner` capability switch and are not used
for early partner work. The engine also treats an end client that staff created
as a house account, which does not fit deals the revenue team logs.

Nothing in the staff records feeds the engine: no commission accrues, no
registration is created and no partner user is invited from a staff record. When
a partner later gets a Commerce organization, link it on the record; the terms
stay a staff record until someone decides how they map onto the engine's
commission model.
