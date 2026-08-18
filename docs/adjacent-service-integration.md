# Fil One adjacent-service integration boundary

Status: **required adoption design; the wireup described here is not
implemented**

Clockwork remains a standalone adjacent service. It does not share Fil One's
runtime, source tree, session, database, or deployment. Adoption therefore
requires an explicit boundary between the existing Fil One product and
Clockwork; provider fakes and migration rehearsals do not establish that
boundary.

## Non-negotiable rules

1. One system is authoritative for each fact and external side effect during
   every migration phase. Dual writes to Stripe, usage meters, provisioning, or
   CRM are prohibited.
2. Existing Fil One identifiers are attached, not recreated. Mapping records are
   immutable, unique, audited, and resolved before a command reaches a provider.
3. Cross-service commands and callbacks are signed, versioned, idempotent, and
   replayable from retained source records. Transport success is not business
   success.
4. A per-account cutover record names the authority phase, checkpoint, evidence,
   reconciliation result, and rollback boundary. Until it commits, Fil One
   remains authoritative for that account's existing product and billing state.

## Ownership matrix

| Domain                                              | Authority during coexistence                                                                                               | Clockwork responsibility                                                                                                                      | Stable join                                                                                                  | Direction and failure recovery                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and identity                         | Fil One Auth0 for existing product users and sessions                                                                      | WorkOS may authenticate Clockwork users only after federation or an approved identity-link ceremony; commerce permissions remain in Clockwork | Immutable mapping of Auth0 issuer + `sub` to WorkOS user ID and Clockwork user ID; never email               | Auth0/WorkOS lifecycle events update the mapping through signed, idempotent callbacks. A missing, ambiguous, or revoked mapping denies access and enters an operator queue.                                                                                            |
| Product organization and tenant                     | Fil One organization ID and provisioned tenant IDs                                                                         | Own the legal/commercial Account and its relationship roles                                                                                   | Unique `fil_one_org_id` on the Clockwork account relationship; explicit 1:1 or approved 1:n cardinality      | Fil One publishes organization/tenant state. Mapping conflicts fail closed; neither service silently creates a replacement organization.                                                                                                                               |
| Products and price books                            | Fil One owns provisionable SKU, region, and entitlement capability; Clockwork owns approved commercial price-book versions | Translate an accepted commercial line into a versioned provisionable SKU                                                                      | Immutable mapping of Clockwork SKU/version to Fil One product/SKU/region version                             | Mapping is validated before quote activation and again before order acceptance. Unknown or retired capability blocks the order, not provisioning after sale.                                                                                                           |
| Stripe customer                                     | Fil One mapping is authoritative for existing PAYG billing parties                                                         | Attach the existing customer; create a customer only for a proven-new billing party after uniqueness checks                                   | Stripe account + customer ID, uniquely bound to the billing-party Account                                    | Exactly one service may create/update the customer in a phase. Duplicate detection or ownership uncertainty stops before a Stripe write and enters reconciliation.                                                                                                     |
| Subscriptions, invoices, payments, tax, and dunning | Fil One/Stripe remain authoritative for existing PAYG until an approved per-account cutover; Stripe remains payment truth  | Own annual/partner commercial intent and derive portal projections from the designated Stripe integration owner                               | Stripe customer, subscription, schedule, invoice, and event IDs plus Clockwork order/account IDs in metadata | One webhook consumer is the financial projection writer for a migrated object. The other receives normalized events or read-only projections. Reconciliation compares Stripe, the owning service, and QBO before advancing authority.                                  |
| Raw usage and product entitlements                  | Fil One/orchestrator                                                                                                       | Pull immutable raw measurements, calculate contractual commitment/overage, and display attributed usage                                       | Fil One organization/tenant, entitlement, SKU, measurement ID, and closed interval                           | Fil One publishes or serves source measurements. Exactly one owner submits Stripe meter or invoice effects. Duplicate/out-of-order records dedupe by source measurement ID; corrections are additive and audited.                                                      |
| Provisioning and offboarding                        | Fil One platform and storage providers own actual resource state                                                           | Send approved commercial commands and project confirmed outcomes                                                                              | Clockwork command ID + Fil One organization/tenant + product entitlement ID                                  | Clockwork sends a signed idempotent command; Fil One returns an accepted receipt and later a signed terminal callback. Poll/reconcile by command ID after callback loss. No invoice or active entitlement is inferred from command acceptance alone.                   |
| CRM and HubSpot                                     | Existing Fil One/HubSpot integration owns current product lifecycle fields; named sales fields may remain CRM-authored     | Publish allow-listed commercial events and read the stable CRM object ID                                                                      | CRM portal/object ID plus Clockwork account/order and Fil One organization IDs; never email                  | Field-level ownership and one synchronization direction are configured before activation. Conflicting edits create a reconciliation case; Clockwork does not overwrite provider or product truth.                                                                      |
| Support                                             | Support provider owns tickets; Fil One owns product incident state                                                         | Read safe support signals and correlate them to the commerce account                                                                          | Provider ticket/event ID + Fil One organization + Clockwork account                                          | Signed callbacks carry metadata only. Clockwork does not create or mutate provider tickets unless a separately approved write port and ownership rule are added.                                                                                                       |
| Audit history                                       | Each service owns its domain audit ledger                                                                                  | Preserve actual/effective actor, command, decision, and external-effect evidence for commerce activity                                        | Shared correlation/request ID, event ID, actor subject, organization/account IDs, and provider object ID     | Audit entries are append-only and cross-linked, not copied as a substitute for the source ledger. Reconciliation reports gaps without inventing history.                                                                                                               |
| Migration state                                     | Fil One remains source authority until the entity-specific cutover commits                                                 | Own migration runs, matching decisions, checkpoints, evidence, and Clockwork projections                                                      | Snapshot hash + legacy account + Fil One organization + Stripe customer + Clockwork account                  | Dry run, ambiguity review, rehearsal, and three-way reconciliation precede cutover. Resume uses the retained snapshot and idempotency keys. Rollback stops new Clockwork commands and restores routing authority; it does not delete provider facts already committed. |

## Identity and organization mapping

The current migration model matches legacy accounts by Stripe customer, product
organization, legal entity, and domain/country. It has no Auth0 subject,
membership, or Auth0-to-WorkOS federation record. Before existing users can use
Clockwork, the integration must add:

- a verified mapping for Auth0 issuer + subject to WorkOS and Clockwork user
  IDs;
- a verified mapping for each Fil One organization to its Clockwork Account and
  WorkOS organization, including approved cardinality;
- membership and revocation synchronization with monotonic event versions; and
- a recovery ceremony for ambiguous, merged, split, or deleted identities that
  never falls back to email or domain matching for authorization.

WorkOS must not independently create a second authoritative organization for an
existing Fil One tenant. If federation cannot preserve the existing Auth0
session, users may perform an explicit, recently authenticated account-link
ceremony; the resulting mapping, not coincident email, grants access.

## Command and event contract

Every cross-service message must carry:

- `eventId` or `commandId`, schema name/version, occurrence time, producer, and
  correlation/request ID;
- Clockwork account/order/entitlement identifiers and the stable Fil One
  organization/tenant identifiers relevant to the effect;
- the provider object identifiers needed to reconcile the effect;
- an idempotency key stable across retries; and
- a signature over the raw bytes, with key ID, timestamp tolerance, rotation,
  and retained verification evidence.

Consumers claim an event ID atomically, preserve unknown or out-of-order events,
and acknowledge only after the durable local record exists. A duplicate with
different bytes is an incident. Error responses use RFC 9457 problem details
with a stable code, request ID, retryability, and no sensitive provider payload.

The generated OpenAPI document does not yet provide an external machine
credential or fully declare these authentication mechanisms per operation.
Implementation must add the narrow integration endpoints and explicit security
schemes to the generated contract rather than exposing browser-session routes as
a service API.

## Cutover, reconciliation, and rollback

Adoption progresses per account, not as a global flag:

1. **Observe:** import a hash-pinned snapshot and compare identities,
   organizations, Stripe objects, subscriptions, entitlements, and usage without
   effects.
2. **Shadow:** consume signed events and calculate projections, but Fil One is
   the only writer to Stripe, metering, provisioning, and HubSpot.
3. **Cut over one authority:** record approvals and a checkpoint, drain
   in-flight work, reconcile, then transfer exactly one domain writer. Other
   domains stay in their prior phase.
4. **Stabilize:** reconcile counts, money, usage, entitlement, and provider
   objects over an approved soak. Duplicate, missing, or unexplained variance
   blocks the next transfer.
5. **Rollback:** disable new Clockwork effects, restore the previous routing
   owner, replay retained events from the checkpoint, and reconcile. Provider
   effects already committed are compensated through domain commands, never
   erased from history.

Minimum reconciliation keys are account/organization, Stripe customer and
subscription, order/entitlement, usage interval and source measurement, invoice
and payment, provisioning command/resource, CRM object, and terminal status.
Every variance has an owner and disposition; zero unexplained financial,
entitlement, or tenant variance is required before qualification.

## Adoption gates

Clockwork is not ready for Fil One handoff until all of the following are true:

- the identity and organization mappings above exist and deny ambiguity;
- one writer is configured and tested for every external effect;
- the integration API has explicit machine authentication in OpenAPI;
- duplicate, reordered, delayed, conflicting, and lost callbacks pass across the
  real Fil One boundary;
- PAYG, annual/enterprise, partner, POC conversion, amendment, collection,
  renewal, support, migration, and offboarding scenarios reconcile end to end;
- account-scoped cutover and rollback are rehearsed from retained evidence; and
- the named owners of Fil One, Clockwork, Stripe/billing, provisioning, CRM,
  support, security, finance, and migration approve the boundary.
