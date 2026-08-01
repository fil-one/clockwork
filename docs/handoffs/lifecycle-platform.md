# Lifecycle platform handoff

Current disposition: historical provenance. This lane and its integration
expectations are represented and repository-qualified on `main`; lane-local
limitations below do not describe current gaps or an RC/launch.

## Branch and foundation

- Branch: `commerce/lifecycle-platform`
- Foundation base: `d9fdacce7eb3d66e3ba0aaa698814e3d42660668`
- `commerce/foundation` is an ancestor of this branch.
- The foundation already contains the lifecycle commerce tables, RLS substrate,
  immutable document columns, audit/outbox tables, webhook claims, provider
  primitives, and the mounted lifecycle router. This lane does not alter the
  canonical foundation migration.
- If an integration-only schema correction is found during merge, use the
  lifecycle-reserved `000200`–`000299` range. Do not amend `000001`.

## Delivered behavior

The lane implements lifecycle policy as pure, deterministic domain functions;
provider behavior behind ports and realistic fakes; durable workflow planners;
and an authorized HTTP boundary. Commerce remains authoritative. CRM, WorkOS,
e-sign, provisioning, support, notification, evidence, and marketplace systems
receive projections or commands only.

Implemented areas:

- Legal-entity registration with relationship-role sets, verified business
  domains, organization/membership/invite policy, WorkOS identifier linking,
  commerce-owned role decisions, privileged MFA, account switching, notification
  routing, assisted-action evidence, restricted-party gates, partner custom
  domains, and safe branding fallback.
- Procurement completion for AP and invoice-delivery contacts, PO policy,
  exemption/resale certificates, supplier documents, buyer supplier-portal
  tasks, named owners, recurring reminders, escalation, and blocking rules.
- Immutable jurisdictional agreement templates, counsel approval, exact text
  hashes, our/their paper, negotiation, KeyTerms, supersession, term/survival
  rules, click authority evidence, cumulative-value execution threshold,
  re-execution policy, and complete counter-sign evidence.
- Isolated POCs with qualification, caps, keys, milestones, alerts, cost and
  engineering tracking, expiry/proposal flow, and conversion that preserves the
  organization, tenant, resources, and stored data.
- Deterministic order-to-entitlement commands, product mapping, sandbox and POC
  upgrade modes, bounded retries, dead letter and operator re-drive, replay and
  reorder-safe confirmations, credential routing, and pass-through terms that
  contain no Fil One or partner commercial fields.
- Amendments, pinned agreement behavior, direct/partner renewal routing,
  pre-populated renewal requests, exact notice/decline evidence, auto-renew
  gates, risk scoring, command-center grouping, and DST-safe alert scheduling.
- Final-billing/retrieval offboarding, maximum Object Lock date, retained-object
  exclusions, two distinct recently authenticated approvers, gated teardown,
  provider confirmation, deletion-certificate data, partner initiation, and
  Novation/step-in continuity without partner-economics disclosure.
- All seven exception queues with owner, distinct backup, SLA, escalation,
  approve/reject evidence, and separation-of-duties enforcement.
- Dry-run migration discovery, Stripe/product/legal-entity matching, ambiguity
  review, re-acceptance flags, fixture rehearsal, resumable batches,
  idempotency, rollback boundaries, feature flagging, and two-person real-run
  approval.

Document rendering is deliberately not in this lane. Agreement, notice, and
certificate functions return evidence/document data for the foundation and
document lane interfaces.

## HTTP routes

All non-safe routes rely on the foundation Origin/CSRF and idempotency
middleware. Account-bound handlers call `requirePermission` with the target
account. Sensitive recovery, migration, termination request, and destructive
approval paths require recent AuthKit authentication. Webhook routes use the
untouched raw request body, verify before claiming, and deduplicate before any
state transition.

| Method | Route                                                                 | Purpose / authorization                                                                                |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`  | `/v1/lifecycle/status`                                                | Lane health                                                                                            |
| `POST` | `/v1/lifecycle/registrations`                                         | Trusted WorkOS/domain bootstrap; creates the first legal entity, account, organization, and membership |
| `POST` | `/v1/lifecycle/organizations/{organizationId}/invites`                | Commerce-approved WorkOS invite; scoped `account:write`                                                |
| `POST` | `/v1/lifecycle/account-selection`                                     | Membership-scoped organization switch; scoped `account:read`                                           |
| `POST` | `/v1/lifecycle/partners/{accountId}/domains`                          | Partner domain and branding verification; scoped `account:write`                                       |
| `PUT`  | `/v1/lifecycle/accounts/{accountId}/procurement-profile`              | Procurement profile and buyer tasks; scoped `account:write`                                            |
| `POST` | `/v1/lifecycle/agreement-templates`                                   | Counsel-approved immutable jurisdiction/version template publication; `agreement:approve`              |
| `POST` | `/v1/lifecycle/agreements/customer-paper`                             | Customer-paper evidence upload and negotiation opening; `agreement:approve`                            |
| `POST` | `/v1/lifecycle/agreements/click-through`                              | Exact-text click execution evidence; scoped `agreement:execute`                                        |
| `POST` | `/v1/lifecycle/agreements/envelopes`                                  | Redirect/embedded-capable e-sign envelope; scoped `agreement:execute`                                  |
| `POST` | `/v1/webhooks/esign`                                                  | Verified, replay-safe envelope events                                                                  |
| `POST` | `/v1/webhooks/provisioning`                                           | Verified, replay-safe provisioning confirmations                                                       |
| `POST` | `/v1/webhooks/marketplaces-platform`                                  | Verified, replay-safe marketplace entitlement events                                                   |
| `POST` | `/v1/lifecycle/pocs`                                                  | Qualified isolated POC request; scoped `poc:manage`                                                    |
| `POST` | `/v1/lifecycle/pocs/{pocId}/decisions`                                | Evidence-backed POC approval or rejection; scoped `poc:manage`                                         |
| `POST` | `/v1/lifecycle/pocs/{pocId}/conversion`                               | Data-preserving POC conversion; scoped `poc:manage`                                                    |
| `POST` | `/v1/lifecycle/provisioning/{commandId}/recover`                      | Operator re-drive; `system:operate` plus recent authentication                                         |
| `POST` | `/v1/lifecycle/end-user-terms/acceptances`                            | Resale first-login pass-through terms; scoped `agreement:read`                                         |
| `POST` | `/v1/lifecycle/notices`                                               | Immutable InboundNotice evidence; scoped `order:write`                                                 |
| `GET`  | `/v1/lifecycle/renewals`                                              | Scoped renewal command center; `report:read`                                                           |
| `POST` | `/v1/lifecycle/renewals/{orderId}/requests`                           | Pre-populated renewal request and routing; scoped `order:write`                                        |
| `POST` | `/v1/lifecycle/renewals/{orderId}/declines`                           | Evidence-backed decline/notice state; scoped `order:write`                                             |
| `POST` | `/v1/lifecycle/terminations`                                          | Offboarding request; scoped `destructive:request` plus recent authentication                           |
| `POST` | `/v1/lifecycle/terminations/{terminationId}/approvals`                | Two-person decision; `destructive:approve` plus recent authentication                                  |
| `POST` | `/v1/lifecycle/novations`                                             | Partner step-in/Novation continuity without economics disclosure; `agreement:approve`                  |
| `POST` | `/v1/lifecycle/exceptions`                                            | Open an owned, backed-up, SLA-bound exception case; scoped account write                               |
| `POST` | `/v1/lifecycle/exceptions/{caseId}/decisions`                         | Queue-specific approver permission and evidence                                                        |
| `GET`  | `/v1/lifecycle/accounts/{accountId}/support-signals`                  | Read-only, tenant-scoped support feed; `account:read`                                                  |
| `POST` | `/v1/lifecycle/migrations`                                            | Discovery, fixture rehearsal, or authorized execution; recent-authenticated `destructive:request`      |
| `POST` | `/v1/lifecycle/migrations/{runId}/matches/{legacyAccountId}/decision` | Resolve an ambiguous match with separate approval evidence                                             |

`TransactionalLifecycleService` is the concrete application-service boundary;
its `LifecycleCommandRepository` must execute the matching domain state machine
and append audit/outbox evidence in one authorized database transaction.
`LifecycleRouteDependencies` carries that service, the registration bootstrap
verifier, and the three verified webhook adapters. The route layer never touches
tables directly. It does not trust request-supplied cumulative value, POC
success, migration feature flags, or migration approval assertions.

## Audit and outbox events

`packages/api/src/routes/lifecycle/events.ts` is the stable topic catalog. Every
state-changing application-service transaction must append the corresponding
audit event and outbox message atomically with the foundation
`appendAuditAndOutbox` repository. Topics are grouped as follows:

- Identity/onboarding: `account.registered`, `organization.created`,
  `membership.invited`, `membership.changed`, `account.selected`,
  `account.partner_domain_verified`, `account.screening_completed`,
  `procurement_profile.updated`, `procurement_profile.completed`.
- Agreements: `agreement.template_approved`, `agreement.executed`,
  `agreement.envelope_created`, `agreement.envelope_completed`,
  `agreement.pass_through_terms_accepted`.
- POC/provisioning: `poc.approved`, `poc.activated`, `poc.converted`,
  `order.provisioning_requested`, `order.provisioning_confirmed`,
  `order.provisioning_dead_lettered`, `entitlement.marketplace_event_received`.
- Renewal/offboarding: `inbound_notice.recorded`, `renewal.requested`,
  `renewal.declined`, `termination.requested`, `termination.approved`,
  `termination.teardown_confirmed`, `termination.deletion_certificate_issued`,
  `novation.completed`.
- Human/migration: `exception_case.opened`, `exception_case.decided`,
  `migration.started`, `migration.review_required`, `migration.completed`.

Event envelopes must retain request ID, actual and effective actors, aggregate
version, before/after projection, occurrence time, and event schema version. CRM
consumes the allow-listed projection only and never acceptance evidence,
secrets, or commercial source-of-truth fields.

## Durable workflows

Every effect key hashes aggregate type, ID, version, operation, and effect
discriminator. Retry payloads and attempt counts never alter the downstream key.
Transient failures use bounded exponential retry (eight attempts, 1 second–5
minutes); permanent/exhausted failures dead-letter with an operator recovery
key. Human decisions are durable waits with explicit resume events and expiry,
not polling loops.

Permanent versioned task IDs:

- Onboarding: `lifecycle-onboarding-screening-refresh-v1`,
  `lifecycle-onboarding-procurement-reminders-v1`
- Agreements: `lifecycle-agreements-envelope-dispatch-v1`,
  `lifecycle-agreements-signature-reminder-v1`,
  `lifecycle-agreements-evidence-ingestion-v1`
- Provisioning: `lifecycle-provisioning-command-dispatch-v1`,
  `lifecycle-provisioning-confirmation-ingestion-v1`,
  `lifecycle-provisioning-stuck-recovery-v1`
- POCs: `lifecycle-pocs-milestones-v1`, `lifecycle-pocs-expiry-v1`,
  `lifecycle-pocs-proposal-v1`, `lifecycle-pocs-conversion-v1`
- Renewals: `lifecycle-renewals-term-alerts-v1`,
  `lifecycle-renewals-notice-windows-v1`,
  `lifecycle-renewals-auto-renew-evaluation-v1`
- Offboarding: `lifecycle-offboarding-retrieval-window-v1`,
  `lifecycle-offboarding-retention-release-v1`,
  `lifecycle-offboarding-teardown-v1`, `lifecycle-offboarding-confirmation-v1`
- Exceptions: `lifecycle-exceptions-escalation-v1`,
  `lifecycle-exceptions-human-decision-v1`
- Migration: `lifecycle-migrations-discovery-v1`,
  `lifecycle-migrations-scheduled-batch-v1`,
  `lifecycle-migrations-review-wait-v1`

The listed IDs are implemented as discoverable Trigger.dev `task` or
`schedules.task` definitions under the lane directories. Handlers cover
procurement and screening refresh, e-sign dispatch/reminders and evidence
ingestion, provisioning confirmation/stuck recovery, POC milestones and
conversion, renewal/notice windows, retention-aware offboarding, exception
escalation, and scheduled resumable migration. Runtime injection claims the
effect key durably before each external effect and records completion/failure.

## Provider contracts

| Directory                            | Contract and fake behavior                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integrations/workos`                | Organization/domain creation, invitations, memberships, commerce role mapping, MFA/SSO policy, account selection; role slugs never self-authorize                                                           |
| `integrations/esign`                 | Provider-neutral redirect with embedded capability/fallback, durable envelope binding, signed PDF/certificate hashes, timestamped raw-body HMAC verification; API owns durable replay claiming              |
| `integrations/evidence-storage`      | S3 versioning/Object Lock COMPLIANCE, SHA-256 addressing, expected owner/SSE, immutable metadata, quarantine-first malware scanning, presigned finalize/download, authorize-before-GET, least-privilege IAM |
| `integrations/provisioning`          | Entitlement mapping, normal/POC/sandbox modes, credentials, durable order/organization binding, verified callbacks, teardown exclusions, retries, dead letters, recovery, realistic confirmation ordering   |
| `integrations/crm`                   | One-way allow-listed event projection with idempotent upsert; commerce identifiers/version retained                                                                                                         |
| `integrations/screening`             | Registration, pre-signature, partner-activation, and refresh denied-party decisions                                                                                                                         |
| `integrations/notifications`         | Direct/partner/product routing, partner communication ownership, verified custom branding, safe fallback, and template-specific end-client payload allow-lists                                              |
| `integrations/support`               | Strictly read-only, tenant-scoped ticket signals                                                                                                                                                            |
| `integrations/marketplaces-platform` | Idempotent provisioning/entitlement deliveries plus raw-body signature/replay verification                                                                                                                  |

Real adapters convert provider exceptions into explicit transient/permanent
results. Deterministic fakes cover success, failure, delay, duplicates, and the
reordering/replay cases relevant to each provider.

## External activation gates

No missing repository implementation is classified as an external gate. The only
production activation gates remain those in `docs/external-gates.md`:

- `EXT-ACC-01`: scoped hosted credentials and WorkOS policy/subscription IDs
- `EXT-LEGAL-01`: final legal text, click threshold, KeyTerms and
  notice/retention/screening/step-in decisions
- `EXT-COMMERCIAL-01`: signed-off SKU, price, margin, tier, and claims data
- `EXT-PROVIDER-01`: provider selections and production contract activation
- `EXT-PROVISION-01`: authenticated product provisioning/usage/confirmation
  contract
- `EXT-TAX-01`: country tax, exemption, entity, accounting, and credit policy
- `EXT-DOMAIN-01`: production DNS, callback, webhook, and mail-sender records
- `EXT-BRAND-01`: approved public brand assets and legal footer content
- `EXT-APPROVERS-01`: real named queue owners/backups/approvers and targets
- `EXT-TEARDOWN-01`: explicit authority to activate automated teardown

Fakes keep behavior and CI unblocked. Real-customer migration execution is a
controlled post-launch operation behind a feature flag and two-person approval;
the rehearsal and execution tooling itself is implemented.

## Tests

The lane includes tests for:

- account scope, WorkOS role non-authority, privileged MFA, account switching,
  assisted actor evidence, and white-label fallback;
- authority/title/text/UI/network click evidence, exact template hashes,
  template immutability, customer paper, KeyTerms/survival, supersession, value
  threshold and re-execution;
- e-sign signature verification, webhook replay/reorder, immutable PDF and
  certificate evidence;
- S3 hash/version/retention/lock behavior, quarantine, presigned operations,
  immutable collisions and IAM policy;
- POC qualification/caps/milestones/cost and data-preserving conversion;
- provisioning mapping/idempotency/retries/dead-letter/operator recovery,
  duplicate confirmations, credential routing and POC upgrade in place;
- resale commercial privacy, pass-through terms, branded notifications, CRM
  allow-listing and tenant-scoped support;
- notice timing, partner/direct routing, agreement pinning, risk gates, calendar
  time zones and US/EU DST boundaries;
- two-person destructive approval, recent-authentication evidence, maximum
  retention, retained-object exclusions, confirmation, certificate data and
  Novation;
- all exception queues, backups, SLA/escalation, evidence, and self-approval
  denial;
- migration ambiguous matching, re-acceptance, flag/two-person gate,
  resumability, dedupe, rehearsal, and rollback boundary.

Verification completed on Node `24.18.1` and pnpm `10.34.5`:

- Lifecycle-focused: domain `87`, integration/provider `29`, workflow `37`, API
  unit `7`, and API integration `16` tests passed.
- Repository: Prettier, ESLint (`--max-warnings=0`), dependency boundaries (226
  modules/374 dependencies), all 10 package typechecks, and secret scanning
  passed.
- Database: local Supabase reset succeeded; 61 pgTAP assertions and the six
  durable idempotency/webhook integration tests passed.
- Full Turbo unit and integration runs passed (17/17 tasks each); production and
  Storybook builds passed; the Storybook test and Playwright smoke test passed.
- `pnpm audit --audit-level=high` passed. The foundation lockfile retains two
  moderate development/transitive advisories (`esbuild` through Drizzle Kit and
  OpenTelemetry through Trigger.dev); dependency manifests are outside this
  lane.
- Generated OpenAPI was not changed: generated artifacts are explicitly owned by
  the integration lane and regeneration is merge expectation 4 below.

## Merge expectations

These are internal integration steps, not external gates:

1. Export the nine domain directories, nine integration directories, and eight
   workflow directories from the existing lifecycle lane registries, then expose
   the domain lifecycle registry from the shared domain barrel. This lane did
   not edit shared composition.
2. Implement the `LifecycleCommandRepository` over the foundation tables and
   inject it into `TransactionalLifecycleService`. Each command must run its
   domain state machine and append its audit/outbox pair atomically. Supply the
   service, trusted registration bootstrap, durable webhook deduplicators, and
   verified provider adapters from shared API composition.
3. Configure `LifecycleTaskRuntime` with the workflow-run/effect repository. The
   permanent Trigger.dev tasks and schedules are already implemented and
   discoverable by the foundation Trigger configuration.
4. Regenerate OpenAPI artifacts with `pnpm generate`; generated output belongs
   to the integration lane and was not changed by hand here.
5. Run the cross-lane critical-path acceptance suite after core-finance is
   merged: registration → agreement → quote/order → provisioning confirmation →
   invoice, plus resale/end-client privacy, POC conversion, renewal, and
   offboarding.
6. Preserve route/webhook raw-body semantics and do not replace the commerce
   database with provider state during conflict resolution.
