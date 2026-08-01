# Release-candidate integration report

Date: 2026-07-31

Branch: `main` (historical lane evidence below was produced on
`commerce/integration`)

Decision: **not accepted for launch**

The required lane merges and broad integration implementation are committed as
an integration checkpoint. The launch release-candidate designation is withheld
because internal P0 work and failing database gates remain. Nothing in this
report authorizes production deployment.

## Consolidation baseline

The post-lane consolidation preserves and represents every accepted source delta
without retiring any legacy ref or worktree. The canonical contract is
`commerce_platform_spec.md`; its checked-in traceability ledger maps 312 stable
requirement IDs, including all 10 acceptance rows, without treating unfinished
work as complete.

| Evidence                         | Identifier or location                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Foundation spec preservation     | `6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a`                                                                 |
| Integration backlog preservation | `92d10d3b8a12728804b70215799f9929e880c996`                                                                 |
| Foundation merge to `main`       | `114d144c23294c16520f2d5389955ff2ab7f661b`                                                                 |
| UX integration merge to `main`   | `e95ca99f6a085a4bafa46fb81edee73d56eb0914`                                                                 |
| Pre-consolidation tag object     | `pre-consolidation-20260731` / `94e24071eae6ef6ecb641c1b7ae4e29c2ce7a136`                                  |
| All-refs bundle                  | `/Users/jameskurz/Downloads/Fil One/Clockwork-pre-consolidation-20260731.bundle`                           |
| Bundle SHA-256                   | `78be81aeb4eef96c59545873c062e7415883e8150274128867d6f5a5422e1070`                                         |
| Machine-readable inventories     | `docs/baseline/*.json`                                                                                     |
| Traceability ledger              | `docs/traceability/launch-requirements.json`                                                               |
| Final lane base                  | Annotated tag `rc-lanes-base-20260731`; all three `rc/*` worktrees must resolve to its peeled commit       |
| Exact qualification evidence     | Git note `refs/notes/clockwork-qualification` on the lane-base commit plus the external directory it names |

Qualification is run only after the lane-base commit exists, from a fresh
standalone checkout of that exact SHA. The runner requires Node `24.18.1` and
pnpm `10.34.5`, uses fresh external pnpm/XDG/Playwright caches, disables Turbo
and Vitest caches, performs parallel and single-worker confirmation passes, and
fails on any skipped, blocked, drifting, or nonzero gate. The Git note is a
separate committed evidence ref so attaching exact results does not change the
tested SHA.

The browser suite starts the Next development server and several cases mock
`/api/v1`; it does not prove production-build, WorkOS, database, or
live-provider wiring. The demo reset exercises an in-memory fixture store.
Ongoing CI remains weaker than the one-off qualification because CI retains
browser retries and does not run the Drizzle check, migration dry-run, serial
confirmation, or demo safety gates. These results must not be described as
production-shaped end-to- end acceptance.

## Provenance

| Ref                            | SHA                                        |
| ------------------------------ | ------------------------------------------ |
| Foundation / integration start | `d9fdacce7eb3d66e3ba0aaa698814e3d42660668` |
| Core-finance lane              | `12c590d5d386066fc120f90792b2f3c038c294a8` |
| Lifecycle-platform lane        | `abbddae5d8f7945830e53a9526f47d71f4e43c23` |
| Experience-docs lane           | `de5f761ec82ccce4966b82825a3de9b356e953b7` |
| Core-finance no-ff merge       | `3aa1d89ec221f932945b19d4f6226a8cab58867f` |
| Lifecycle-platform no-ff merge | `549c4167067b99968715ec2988e809df5ab1c5c6` |
| Experience-docs no-ff merge    | `65c740e881c270065fb01e49c6911821177ea78e` |

All three lane branches were committed, clean, and descendants of the foundation
SHA before merge. The integration branch started at the foundation SHA and used
explicit `--no-ff` commits in the required order.

## Exact release-gate evidence

| Gate                                                             | Result                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install                                                   | PASS; lockfile current, 11 workspace projects                                                                                   |
| Formatting                                                       | PASS; all files match Prettier                                                                                                  |
| ESLint                                                           | PASS; zero warnings/errors                                                                                                      |
| Typecheck                                                        | PASS; 10/10 packages                                                                                                            |
| Package boundaries                                               | PASS; 509 modules / 1,306 dependencies, zero violations                                                                         |
| Unit/property/contract tests                                     | PASS; 94 files / 382 tests across 10 packages                                                                                   |
| Storybook/axe                                                    | PASS; 2 files / 3 tests                                                                                                         |
| Playwright full run                                              | FAIL initially 19/20; status-contract test fixed; focused smoke rerun PASS 1/1. Full 20-test rerun not performed after the fix. |
| Database reset from zero                                         | PASS through migration `000935` and deterministic seed                                                                          |
| pgTAP                                                            | FAIL; 10 files / 169 assertions, 159 passed and 10 failed                                                                       |
| Collections DB integration                                       | FAIL; 1 file / 2 tests, 1 passed and 1 failed (`core_collection_cases` write privilege)                                         |
| Referral commission DB integration                               | PASS; 1 file / 8 tests                                                                                                          |
| Focused workflow joins                                           | PASS; 23 core tests plus 20 runtime/lifecycle tests and 10 artifact/factory tests                                               |
| Focused integration adapters                                     | PASS; 11 tests                                                                                                                  |
| External-gate domain tests                                       | PASS; 5/5                                                                                                                       |
| Secret scan                                                      | PASS; zero findings after fixture correction                                                                                    |
| Dependency audit threshold                                       | PASS for high/critical; 0 high, 0 critical, 2 moderate advisories remain                                                        |
| Production build                                                 | FAIL during an intermediate renderer-seam edit; affected package subsequently typechecked, but the full build was not rerun     |
| Generated artifacts                                              | OpenAPI/types regenerated; Drizzle consolidated to one `0003` authoring diff/snapshot                                           |
| Storybook production build, migration dry run, demo reset safety | Not rerun in the final frozen state                                                                                             |

The detailed P0/P1/P2 disposition is in `docs/backlog.md`. A failed or unrun
gate is not treated as an external blocker.

## Integration defects fixed

- Added transaction-scoped command idempotency receipts so a crash after commit
  replays the original response and rejects key/payload conflicts.
- Separated partner authorization scope from end-client buyer identity and
  validated persisted screening, agreement type, currency, and active deal
  registration for partner quotes.
- Corrected deal-exclusion status from invalid `open` to `detected`.
- Added immutable quote/order/amendment and deletion-certificate artifact
  request, render, evidence-storage, replay, binding, and audience controls.
- Removed the workflow-to-document package boundary violation through an
  authenticated renderer port with response hash validation.
- Added persisted provisioning-to-invoice/Stripe joins, referral commission
  accrual/clawback/statements, collection correction commands, and authoritative
  outbox/Trigger submission seams.
- Added live provider composition, simulator rejection in production, external
  gate activation probes, and bounded/hash-pinned migration-source access.
- Corrected canonical distributor/marketplace buyer, sourcing, MoR, billing,
  reconciliation, and seed profile data; fixed the resale/distributor database
  chain to preserve the end-client buyer identity.
- Fixed custom-domain CSRF/DNS verification, confidential pricing access,
  payment projection truth, generated client headers, lint/type defects, and a
  Playwright status-contract expectation.

## Unfinished internal work

Launch remains blocked by the P0 list in `docs/backlog.md`, including resale
quote RLS privacy, stale/colliding pgTAP fixtures, partner order submission,
collections privilege/integrity hardening, 24 lifecycle executors, six missing
core schedules, exception-owner resolution, runtime activation proof, two
repository integration regressions, final build/UI/migration/demo gate reruns,
and two moderate transitive dependency upgrades.

Therefore, confirmation that no non-external work remains **cannot be given**.

## External gates

The final authoritative register is `docs/external-gates.md`. It contains 12
gates, each with owner/input, simulator, visible admin state, activation test,
and severity: accounts/credentials, legal, commercial data, selected providers,
provisioning, tax/accounting, domains, brand, approvers, teardown decision,
marketplaces, and production migration. All remain non-active until their live
activation evidence succeeds.
