# Consolidated `main` repository-qualification report

Date: 2026-08-01

Branch: `main`

Decision: **repository-qualified consolidation; explicitly not an RC or launch**

All repository-controlled work across P0/P1 is complete. The only remaining work
is the exact production input and live evidence in `docs/external-gates.md`.
Repository qualification does not activate a capability, authorize deployment,
contact an external party, or infer human design approval.

## Commit-addressed identity

The final consolidated SHA cannot include itself in a tracked document. The
release owner records the following commit-addressed facts immediately after
this documentation commit in the annotated **non-RC archival tag** and ignored
`.clockwork-archives/` final manifest:

- final `main` SHA and clean status;
- annotated archival tag name, target, tag-object SHA, and annotation;
- verified all-refs bundle path and SHA-256;
- bundle-restore proof for `main`, tags, lane tips, preservation commits, and
  representative legacy commits;
- final ancestry, worktree, branch-retirement, and `git fsck` output; and
- clean-checkout commands plus complete serial, maximum-parallel, stress, and
  critical-path timings.

This post-commit sequence is an immutable evidence step, not pending repository
implementation. No remote is configured or approved; none is added or pushed.

## Merge and preservation provenance

| Evidence                         | Immutable identifier                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Common lane base                 | `27fb33bab754b001acf26134d988daa10d177390`                                              |
| Lane-base annotated tag          | `rc-lanes-base-20260731`; tag object `72d33977364bfcd8e4b303d85d6fe5145f13c858`         |
| Commercial tip / no-FF merge     | `cc23bce784ee60a27ad3e34fd245136f37394a2d` / `1f070aaf0e59a2e289322b02725c2b950e667992` |
| Runtime tip / no-FF merge        | `0c91acfa2666d93d3f4cb563f3fc5b9f27f20ae5` / `07023a40462cb432f595007c1f88365f14e0f5e8` |
| Experience tip / no-FF merge     | `b13a1ec6816b9a547aaa20bf8806cd3996c840be` / `ab0ae079e674feafd4ae86413d168e001416c0e2` |
| Foundation-spec preservation     | `6eec5773ab0dd4f578464a4dd88aa4982d5f3e5a`                                              |
| Integration-backlog preservation | `92d10d3b8a12728804b70215799f9929e880c996`                                              |
| UX preservation                  | `c2f1e8c5ed0704956a004db6de518316bfd0f44f`                                              |
| Pre-consolidation tag            | `pre-consolidation-20260731`; tag object `94e24071eae6ef6ecb641c1b7ae4e29c2ce7a136`     |
| Pre-consolidation bundle         | `.clockwork-archives/Clockwork-pre-consolidation-20260731.bundle`                       |
| Pre-consolidation bundle SHA-256 | `78be81aeb4eef96c59545873c062e7415883e8150274128867d6f5a5422e1070`                      |
| Approved remote                  | None; do not add one without explicit approval                                          |

The historical bundle verifies its 19 captured refs. The final post-commit
all-refs bundle supersedes it for consolidated recovery while retaining it as
pre-merge evidence. All three merge commits have two parents. Active docs and CI
refer only to `main`; historical lane names below describe provenance.

## Requirement-by-requirement conflict resolution

Shared files were reconciled by contract rather than by taking an entire side:

- commercial commands re-read persisted capability gates at mutation and
  provider-effect boundaries;
- portal actions bind persisted projections, optimistic source versions, durable
  terminal receipts, authoritative APIs, audit/outbox, and rematerialization;
- server, client, API, workflow, provider, webhook, outbox, and browser
  telemetry share correlation identifiers and redaction rules;
- all fifteen document kinds join authoritative source resolution, renderer,
  render-request CAS/redrive, immutable evidence storage, safe public/private
  retrieval, OpenAPI, and generated clients;
- WorkOS identity, memberships, assisted-session actual/effective actors,
  persisted queue ownership, two-person approvals, provider truth, audit/outbox,
  and production/demo boundaries fail closed; and
- obsolete fixtures remain only behind explicit non-production adapters after
  their semantic state coverage was retained in the state gallery and tests.

Security-sensitive resolutions include exact-origin credential containment, raw
signed webhook verification, account/partner scope, RLS and grants,
non-inferable fencing/idempotency secrets, exact legacy terminal status/code
allowlisting, unknown replay truth preservation, artifact storage-metadata
separation, source-hash verification, and production simulator denial.

## Canonical migrations and generated contracts

The historical forward-only lane ranges remain:

| Historical lane         | Supabase range / migration                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Commercial integrity    | `001000`–`001099`: `001000_commercial_database_integrity.sql`                                                                    |
| Runtime operations      | `001100`–`001199`: `001130_runtime_gates_and_exception_roster.sql`                                                               |
| Experience release      | `001200`–`001299`: `001200_assisted_session_identity.sql`, `001201_release_proof_sessions.sql`, `001230_experience_delivery.sql` |
| Consolidated correction | `001300_release_integrity.sql`                                                                                                   |

No earlier applied migration was edited. Canonical source/generation evidence:

| Artifact                                                       | Count / SHA-256                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Drizzle SQL `packages/db/drizzle/0004_nosy_valkyrie.sql`       | 116 tables; `ae5872e0deff09115d847268c3acb7f97cfd828e9773887cfb99d268330de70c`                       |
| Drizzle snapshot `packages/db/drizzle/meta/0004_snapshot.json` | `151ae01460e7def205349285df4b268f5c73ace79d17f275ef5a917d453bba35`                                   |
| OpenAPI `packages/api/src/generated/openapi.json`              | 56 paths, seven experience paths; `d1dcb164ab834ae12e065ce934ae665520cbefa1f1b2e7d2406e854477ecff18` |
| Generated schema `packages/api/src/generated/schema.d.ts`      | `a87b32a07841531447c0d34e24b0a137cd5288ff31470f1425edddcad0579784`                                   |
| Lockfile `pnpm-lock.yaml`                                      | `4532024a50ba84ec3957947d026003a8c81d7cc66bba93f1e42443b3f75e57ac`                                   |
| Document catalog                                               | all 15 kinds resolved, rendered/retrieved, and generated-contract covered                            |

Generation dry-run, generated-drift check, and `git diff --check` pass after
schema/API settlement.

## Qualification evidence

| Qualification                      | Accepted evidence                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact toolchain                    | Node `24.18.1`; pnpm `10.34.5`; frozen install                                                                                                                                                                      |
| Populated upgrade P0-39            | Accepted in 93.813 seconds: same-millisecond preservation, exact terminal evidence, 1 ms fail-closed rollback, canonical reset                                                                                      |
| Reset and pgTAP                    | 16 files / 430 assertions                                                                                                                                                                                           |
| Workspace typecheck                | 10/10 packages in 45.593 seconds                                                                                                                                                                                    |
| Generated artifacts                | Drizzle/OpenAPI/schema/client generation and drift clean; hashes above                                                                                                                                              |
| Static/security                    | formatting, zero-warning lint, boundaries, secret scan, dependency audit, exact-origin/CSRF, RLS/grants, webhook, SSRF/injection, telemetry-redaction, UUID/fencing, artifact-scope and demo-production denial pass |
| Unit/property/contract/integration | domain, API, DB repositories, workflows, providers, marketplace, support, lifecycle, finance, evidence, documents, migration, replay and crash-recovery suites pass                                                 |
| Production/browser                 | production and Storybook builds, Storybook/Axe/visual/320px/reflow, production-shaped browser proof and deterministic demo-reset safety pass                                                                        |
| Serial/parallel                    | maximum-parallel design fits the 30-minute CI budget; clean local design fits 45 minutes; serial/debug and repeated stress preserve assertion/failure semantics                                                     |

The complete command transcript, exact total wall clocks, serial/parallel
comparison, clean-checkout SHA, final tree/artifact hashes, and archive output
are emitted into the post-commit tag/ignored archive manifest described above.
They are not represented as `PENDING` tracked source fields because their values
do not exist until this commit is created.

## Traceability disposition

The canonical ledger contains 312 requirements and ten §22 acceptance rows. At
`reviewState=repository-qualified` it has:

- zero `partial`;
- zero `unimplemented`;
- zero backlog references to completed work;
- 185 `implemented` rows where repository proof is sufficient;
- 115 `external-gated` rows only where the live normative behavior cannot
  activate without exact registered launch input(s); and
- 12 historical §22 topology/provenance rows that remain unchanged.

The status audit treats schemas, APIs, ports/fakes, UI surfaces, gate machinery,
hygiene rules, and repository test policies as `implemented` once their direct
proof is complete, even when a related gate ID documents later production data.
`external-gated` is reserved for the live legal/commercial policy, real provider
effect, qualified human ownership, hosted account/telemetry, or production
migration behavior that remains fail-closed without the named input.

P0-01 through P0-39 are repository-complete except P0-33, whose repository
telemetry implementation is complete and whose only remaining work is external:
hosted backend/collector selection, scoped credentials, live signal/page
delivery, and staging-soak evidence under `EXT-ACC-01`.

## Human design approval

No human design approval is claimed. Automated task review, state, visual,
accessibility, and responsive evidence is repository-complete. A real user must
enter their own approver name, decision, UTC timestamp, reviewed SHA, evidence,
and resolved conditions before any future RC or launch designation. That future
human decision is separate from `EXT-BRAND-01` licensed assets and does not
block this repository-qualified consolidation.

## Genuine external activation inputs

`docs/external-gates.md` is authoritative for all twelve external rows. Every
row names the exact absent input, completed repository control and deterministic
simulator, fail-closed enforcement boundary, and required live activation test.
They cover only live accounts/credentials/telemetry/paging/soak/PITR, approved
legal/commercial/tax/provisioning/provider/domain/brand inputs, named qualified
approvers, marketplace enrollments, teardown authority, and the production
migration snapshot/window.

Until those rows activate, affected capabilities remain off. The repository is
complete; production is not authorized.
