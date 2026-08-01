# Consolidation baseline manifests

These JSON files are the checked-in, machine-readable inventory for the final
three-lane consolidated `main` boundary. The earlier Instance 1 inventory
remains recoverable from Git history and the verified pre-consolidation bundle,
so every final delta can be compared without keeping obsolete worktrees or
branches active.

Before branch retirement, the final capture can be reproduced with exact Node
`24.18.1` while all recorded refs still exist:

```sh
BASELINE_CAPTURED_AT=<UTC timestamp> node scripts/generate-baseline-manifests.mjs
```

The manifests intentionally separate discoverable implementation from release
status. A route, schema, fake, task ID, renderer, or test file does not prove
the corresponding launch requirement complete. Status is controlled by
`docs/traceability/launch-requirements.json`, `docs/backlog.md`, and executed
qualification evidence.

Generated disposition metadata targets `consolidated-main-quality`; it does not
declare a release candidate or approve a production launch. Human design
approval is an external launch-only review recorded in
`docs/launch-checklist.md` and does not block repository consolidation.

| Manifest                              | Scope                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `git-provenance.json`                 | Refs, commits, trees, worktrees, preservation decisions, tag, bundle, and bundle checksum           |
| `routes-api-auth.json`                | App routes, audiences, roles, permissions, and OpenAPI operations                                   |
| `database.json`                       | Canonical migrations, tables, RLS policies, grants, Drizzle snapshots, seeds, and application roles |
| `schema.json`                         | Detailed Drizzle snapshot plus canonical-SQL table, policy, view, role, and coverage deltas         |
| `openapi-clients.json`                | OpenAPI and generated-client counts, hashes, and regeneration commands                              |
| `workflows.json`                      | Permanent task IDs, Trigger discovery, schedules, outbox mappings, and known execution gaps         |
| `artifacts-documents.json`            | Document/artifact kinds, goldens, retrieval sources, and delivery gaps                              |
| `environment-gates-capabilities.json` | Environment registry, external gates, switches, and capability-key gaps                             |
| `tests-baseline-artifacts.json`       | Suite files, pgTAP plan, browser scenarios, visual hashes, and qualification policy                 |
| `artifact-hashes.json`                | SHA-256 and byte size for contract, release, generated, migration, seed, and visual baselines       |

`captureCommit` identifies the source commit visible when the manifests were
generated. The manifest commit necessarily changes the Git tree, so final
qualification and archive evidence is also recorded in the consolidated-main
report, archival annotated tag, restored all-refs bundle, and their checksums.
The `historicalRcLaneBase` and `historicalRcInputLanes` fields retain the exact
`rc-lanes-base-20260731` and `rc/*` ancestry names solely as provenance. Those
historical names and archival tags do not declare consolidated `main` to be an
RC. No pass is inferred from ignored `.turbo`, `.next`, or `test-results`
output.
