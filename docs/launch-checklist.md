# Launch checklist

This checklist is the human release record for a staged Clockwork activation. It
does not authorize a production deployment by itself. Every checked item
requires an evidence link or immutable artifact reference, and every required
approval field must contain a real named person before a launch decision. It is
not a prerequisite for the repository-complete consolidated-main handoff.

Repository qualification is complete. Unchecked items below require future live
production/staging inputs, elapsed operation, or named human authority; they are
not hidden repository work and do not make this consolidation an RC.

## Release identity

| Field                            | Value                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Future launch-candidate Git SHA  | **PENDING future launch/RC designation**                                                          |
| Historical RC lane base          | `27fb33bab754b001acf26134d988daa10d177390`                                                        |
| Commercial tip / merge SHA       | `cc23bce784ee60a27ad3e34fd245136f37394a2d` / `1f070aaf0e59a2e289322b02725c2b950e667992`           |
| Runtime tip / merge SHA          | `0c91acfa2666d93d3f4cb563f3fc5b9f27f20ae5` / `07023a40462cb432f595007c1f88365f14e0f5e8`           |
| Experience tip / merge SHA       | `b13a1ec6816b9a547aaa20bf8806cd3996c840be` / `ab0ae079e674feafd4ae86413d168e001416c0e2`           |
| Vercel staging deployment ID/URL | **PENDING external activation**                                                                   |
| Supabase staging project/branch  | **PENDING external activation**                                                                   |
| Trigger.dev environment          | **PENDING external activation**                                                                   |
| Generated OpenAPI hash           | `d1dcb164ab834ae12e065ce934ae665520cbefa1f1b2e7d2406e854477ecff18`                                |
| Canonical migration set/hash     | Drizzle `0004_nosy_valkyrie` / `ae5872e0deff09115d847268c3acb7f97cfd828e9773887cfb99d268330de70c` |
| Dependency lockfile hash         | `6bc939e90cdba4cb8d055c4903bc49d0371d077780b8bfaffed97d952ea3e5fc`                                |
| Checklist opened at (UTC)        | **PENDING user/release owner entry**                                                              |
| Proposed activation window (UTC) | **PENDING external launch decision**                                                              |

## Release gate

- [x] The repository-qualified clean-checkout harness completed
      `pnpm install --frozen-lockfile` on the pinned Node 24 and pnpm 10
      toolchain. Clean isolated browser regression run `smoke-9464bab-ui4`
      qualified commit `9464bab03beb8a5298d57f4181cf7bf3ff5072df`; the future
      launch SHA is checked again after external inputs are bound.
- [x] Formatting, ESLint with zero warnings, dependency boundaries, all package
      typechecks, generated-artifact check, production build, and Storybook
      build passed.
- [x] Supabase reset from zero applied every canonical SQL migration and seed;
      pgTAP, repository, unit, property, provider-contract, integration,
      workflow, Stripe webhook/test-clock,
      WorkOS/e-sign/provisioning/marketplace replay, PDF golden,
      Storybook/axe/visual, and all Playwright persona/critical-path suites
      passed with recorded counts. Reset pgTAP is 16 files / 430 assertions;
      workspace typecheck is 10/10 packages in 45.593 seconds. The replacement
      isolated browser gate passed Storybook 5/5 and Playwright 79/79 with zero
      skipped, flaky, unexpected, or retried tests.
- [x] Direct, assisted, referral, resale, distributor/two-tier, AWS/Azure/GCP
      marketplace, POC conversion, amendment/co-termination, renewal/decline,
      dunning/dispute/refund, offboarding/Novation, white-label, and every
      report and reconciliation path passed against deterministic repository
      providers. Live provider activation remains in the external section.
- [x] Tenant/partner isolation, co-mingled order visibility, IDOR, privilege
      escalation, impersonation, CSRF, raw-body webhook signatures, replay,
      SSRF, injection, upload quarantine, secret/PII logging, and destructive
      separation tests failed closed as designed.
- [x] Migration discovery and repository rehearsal passed; P0-39 was accepted in
      93.813 seconds and proved forward-only rollback and production-target
      denial. The immutable live source snapshot remains `EXT-MIGRATION-01`.
- [x] Demo reset is deterministic in demo and refuses every production marker.
- [x] Dependency audit at the configured threshold, secret scan, and security
      review passed; any accepted advisory has a named owner and expiry.
- [x] `docs/release-candidate-report.md` records test counts, hashes, retained
      failed diagnostics, dependency-boundary fixes, and remaining external
      gates. The exact final SHA, archival tag/bundle, and complete
      command/timing transcript are written post-commit to the non-RC tag and
      ignored archive manifest because they cannot be self-recorded in this
      commit.

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

### Human design approval required for any future RC/launch designation

This approval is distinct from licensed brand activation. It must be entered by
the reviewing user after the final design-affecting SHA and evidence exist. An
assistant or lane handoff must not infer or prefill the decision.

| Field                            | User-entered value                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Approver name                    | **PENDING USER ENTRY**                                                                       |
| Decision (`APPROVE` or `REJECT`) | **PENDING USER ENTRY**                                                                       |
| UTC timestamp                    | **PENDING USER ENTRY**                                                                       |
| Reviewed SHA                     | **PENDING FINAL DESIGN SHA**                                                                 |
| Evidence/reference               | **PENDING FINAL VISUAL, ACCESSIBILITY AND PRODUCTION-PROOF EVIDENCE**                        |
| Conditions and resolution        | **PENDING; every condition must be resolved and reviewed again before RC/launch acceptance** |

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
