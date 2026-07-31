# Launch checklist

This checklist is the human release record for a staged Clockwork activation. It
does not authorize a production deployment by itself. Every checked item
requires an evidence link or immutable artifact reference, and every required
approval field must contain a real named person before a launch decision.

## Release identity

| Field                            | Value |
| -------------------------------- | ----- |
| Release-candidate Git SHA        |       |
| Foundation SHA                   |       |
| Core-finance merge SHA           |       |
| Lifecycle-platform merge SHA     |       |
| Experience-docs merge SHA        |       |
| Vercel staging deployment ID/URL |       |
| Supabase staging project/branch  |       |
| Trigger.dev environment          |       |
| Generated OpenAPI hash           |       |
| Canonical migration set/hash     |       |
| Dependency lockfile hash         |       |
| Checklist opened at (UTC)        |       |
| Proposed activation window (UTC) |       |

## Release gate

- [ ] A clean checkout at the release-candidate SHA completed
      `pnpm install --frozen-lockfile` on the pinned Node 24 and pnpm 10
      toolchain.
- [ ] Formatting, ESLint with zero warnings, dependency boundaries, all package
      typechecks, generated-artifact check, production build, and Storybook
      build passed.
- [ ] Supabase reset from zero applied every canonical SQL migration and seed;
      pgTAP, repository, unit, property, provider-contract, integration,
      workflow, Stripe webhook/test-clock,
      WorkOS/e-sign/provisioning/marketplace replay, PDF golden,
      Storybook/axe/visual, and all Playwright persona/critical-path suites
      passed with recorded counts.
- [ ] Direct, assisted, referral, resale, distributor/two-tier, AWS/Azure/GCP
      marketplace, POC conversion, amendment/co-termination, renewal/decline,
      dunning/dispute/refund, offboarding/Novation, white-label, and every
      report and reconciliation path passed against the release candidate.
- [ ] Tenant/partner isolation, co-mingled order visibility, IDOR, privilege
      escalation, impersonation, CSRF, raw-body webhook signatures, replay,
      SSRF, injection, upload quarantine, secret/PII logging, and destructive
      separation tests failed closed as designed.
- [ ] Migration discovery and rehearsal passed against an isolated snapshot;
      forward-only boundary and production-target denial were demonstrated.
- [ ] Demo reset is deterministic in demo and refuses every production marker.
- [ ] Dependency audit at the configured threshold, secret scan, and security
      review passed; any accepted advisory has a named owner and expiry.
- [ ] `docs/release-candidate-report.md` records exact commands, test counts,
      defects fixed, and remaining external gates without labeling internal work
      as external.

## External activation

- [ ] Every row in [external-gates.md](./external-gates.md) is visible in
      `/internal/gates` with owner, state, last test, evidence, and review date.
- [ ] Every production path being activated has an `active` gate and a passing
      activation test. Paths with `blocked` gates are technically prevented from
      activation.
- [ ] Counsel-approved agreement bytes and exact hashes, signed commercial
      inputs, tax/account mappings, claims wording, credit policy, and named
      queue owners are attached.
- [ ] Live projects, scoped credentials, payment rails, callbacks, sender
      domains, provider contracts, provisioning mappings, and selected
      marketplace enrollments passed sandbox/staging tests without exposing
      secrets.

## Staging soak

| Field                                                | Value |
| ---------------------------------------------------- | ----- |
| Soak owner (name)                                    |       |
| Start / end (UTC)                                    |       |
| Required duration                                    |       |
| Staging build/database revision                      |       |
| Synthetic direct/partner/marketplace traffic profile |       |
| Incident/variance log                                |       |
| Soak evidence                                        |       |

- [ ] The soak covered at least one billing boundary or accelerated Stripe test
      clock, delayed/duplicate/reordered callbacks, a provider transient
      failure, workflow crash recovery, POC upgrade in place, and
      partner-isolated reads.
- [ ] No unexplained reconciliation variance, serious axe violation, cross-scope
      access, duplicate financial/provider effect, permanent workflow failure,
      or unowned alert remains.
- [ ] Connection-pool, database, workflow, webhook, provisioning, billing,
      latency/error, and notification signals remained within the approved
      launch thresholds recorded here: ________________________________.

## Backup restore drill

- [ ] A production-shaped managed backup/PITR point was restored into a new
      isolated Supabase project; nothing was restored over production.
- [ ] Actual recovery-point loss, restore time, and full validation time met the
      approved RPO/RTO: RPO ________; RTO ________.
- [ ] RLS/domain isolation, canonical migration history, audit/outbox/webhook
      durability, immutable S3 hashes/versions, critical paths, and the
      platform/Stripe/QBO tie-out passed on the restore.
- [ ] Drill evidence and cleanup record are attached according to
      [disaster-recovery.md](./operations/disaster-recovery.md).

## Alerts and runbooks

- [ ] Synthetic alert tests reached the named primary and distinct backup for
      provisioning failure/dead letter, webhook signature/replay conflict,
      durable workflow exhaustion, outbox backlog, dunning/credit exposure,
      reconciliation variance, database pool/PITR failure, authentication
      anomaly, secret scan, and destructive-action attempt.
- [ ] On-call responders used the provisioning, webhook, reconciliation,
      workflow, offboarding, migration, and disaster-recovery runbooks and
      recorded acknowledgement/escalation time.
- [ ] Dashboard links, alert thresholds, paging route, primary, backup, and
      response target are attached: ________________________________.

## Feature-flag activation

Record the real configured key; do not invent an environment variable during
launch. Every change requires an owner, approver, timestamp, evidence, and a
tested disable path.

| Capability                    | Flag/config key | Pre-launch state | Activation owner (name) | Approver (name) | Activation test/evidence | Rollback state |
| ----------------------------- | --------------- | ---------------- | ----------------------- | --------------- | ------------------------ | -------------- |
| New-business commerce entry   |                 | off              |                         |                 |                          | off            |
| External agreement execution  |                 | off              |                         |                 |                          | off            |
| Paid provisioning/invoicing   |                 | off              |                         |                 |                          | off            |
| Referral/resale partner paths |                 | off              |                         |                 |                          | off            |
| White-label/custom domains    |                 | off              |                         |                 |                          | off            |
| Marketplace: AWS              |                 | off              |                         |                 |                          | off            |
| Marketplace: Azure            |                 | off              |                         |                 |                          | off            |
| Marketplace: Google Cloud     |                 | off              |                         |                 |                          | off            |
| Automated teardown            |                 | off              |                         |                 |                          | off            |
| Existing-customer migration   |                 | off; post-launch |                         |                 |                          | off            |

- [ ] Automated teardown remains off unless `EXT-TEARDOWN-01` is active and its
      separate two-person activation record is complete.
- [ ] Existing-customer migration remains off during new-business launch and is
      activated only for the separately approved post-launch window.

## Rollback readiness

- [ ] The last known-good Vercel deployment, database compatibility boundary,
      provider configuration, and flag states are recorded.
- [ ] Rollback disables new mutations and external effects first, preserves
      evidence, and leaves issued artifacts/audit events immutable.
- [ ] Database rollback uses the rehearsed managed recovery plan. Applied SQL
      migrations are never edited or reversed by deleting commercial records; a
      forward-only correction is prepared when the migration boundary requires
      it.
- [ ] Provider effects that may have succeeded are reconciled by their stable
      idempotency keys before retry. DNS/AuthKit/webhook rollback and customer
      communication owners are named.
- [ ] Rollback decision threshold: ________________________________.
- [ ] Incident commander and rollback operator performed a tabletop or staging
      exercise and attached evidence.

## Named approvals

Blank names are a failed gate. An approver must enter their own decision and UTC
timestamp; destructive and migration approvals must be distinct people.

| Approval                        | Name | Decision | UTC timestamp | Evidence/reference |
| ------------------------------- | ---- | -------- | ------------- | ------------------ |
| Product launch owner            |      |          |               |                    |
| Platform/release owner          |      |          |               |                    |
| Security owner                  |      |          |               |                    |
| Operations/on-call owner        |      |          |               |                    |
| Finance owner                   |      |          |               |                    |
| Accountant/QBO mapping approver |      |          |               |                    |
| Counsel/legal approver          |      |          |               |                    |
| Brand/accessibility approver    |      |          |               |                    |
| Backup-restore drill approver   |      |          |               |                    |
| Incident commander              |      |          |               |                    |
| Rollback operator               |      |          |               |                    |

Final launch decision: `GO` / `NO-GO` (circle one)  
Decision owner: ____________________  
Decision time (UTC): ____________________  
Change/incident reference: ____________________
