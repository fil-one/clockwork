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
- Editable on purpose: a deal's registration date and status can be changed
  freely, in any direction, by anyone who may edit partners (an expired deal can
  be set back to registered, a registration can be back-dated). There is no
  transition rule; every change is recorded in History with its before and after
  values.
- Retries: a first save sent again with the same id returns the stored record
  only when nothing differs; an edit made after a save whose answer was lost is
  refused with a reload message, never dropped silently.
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

## Bringing a partner in from HubSpot

**Partners → From HubSpot** creates or updates a staff partner record from a
HubSpot company or deal through a reviewed handoff: selected contacts keep their
HubSpot identity, the originating deal is kept as reference, and selected PDFs
become partner attachments. It writes the same `partner.*` events, with the
HubSpot source. See [the HubSpot handoff](hubspot-handoff.md).

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

## Documents attached outside Commerce

Open a saved partner and use **Documents → Choose PDF → Attach document**.
Record a title, choose **MNDA / NDA**, **Agreement** or **Other document**, and
optionally enter the signing date. PDFs may be up to 25 MB. Staff can view or
download each file with its original filename, uploader and upload time.

The same section appears on organization and account detail pages. Those two
pages use the account's ID and show the same attachments. A standalone partner's
files stay on that partner record; linking an organization does not move files
or expand their audience. Attachments are staff-only and do not send signature
requests, mark an agreement executed, or satisfy onboarding approval gates.

Reads require the record's existing permission (`sales:read` for partners,
`operations:read` for accounts); uploads also require `contract:write`. Every
request checks an actual staff session, MFA, and absence of impersonation or an
assisted session. Demo identities never read or write real attachments.

Migration 001482 adds `commerce_account_documents`, with exactly one partner or
account foreign key per row. The existing document-store interface retains the
PDF using the `account_attachment` purpose. Rows and original details are
append-only for the service role; attached bytes are protected from cleanup.
Uploads and downloads append `account.document_attached` and
`account.document_downloaded` audit/outbox events. Retry IDs reuse the original
result only for identical content, metadata, target and uploader; an identical
PDF already on the same record is reported as a duplicate.
