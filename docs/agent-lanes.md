# Agent lane ownership

All branches start from the exact `commerce/foundation` commit. No lane edits
`commerce_platform_spec.md`. No lane inspects or depends on another Fil One or
Object Lock repository.

| Lane                               | Branch                        | Exclusive paths                                                                                                                                                                                                                                                                                                           | Migration range   |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Agent 2 — core finance             | `commerce/core-finance`       | `packages/api/src/routes/core/**`, `packages/domain/src/core/**`, `packages/db/src/repositories/core/**`, `packages/db/src/schema/core/**`, `packages/integrations/src/core/**`, `packages/workflows/src/core/**`, `packages/testing/src/core/**`                                                                         | `000100`–`000199` |
| Agent 3 — lifecycle platform       | `commerce/lifecycle-platform` | `packages/api/src/routes/lifecycle/**`, `packages/domain/src/lifecycle/**`, `packages/db/src/repositories/lifecycle/**`, `packages/db/src/schema/lifecycle/**`, `packages/integrations/src/lifecycle/**`, `packages/workflows/src/lifecycle/**`, `packages/testing/src/lifecycle/**`                                      | `000200`–`000299` |
| Agent 4 — experience and documents | `commerce/experience-docs`    | `packages/api/src/routes/system/**`, `packages/domain/src/system/**`, `packages/db/src/repositories/system/**`, `packages/db/src/schema/system/**`, `packages/integrations/src/system/**`, `packages/workflows/src/system/**`, `packages/testing/src/system/**`, `apps/web/**`, `packages/ui/**`, `packages/documents/**` | `000300`–`000399` |
| Agent 5 — integration              | `commerce/integration`        | Merge/conflict resolution, generated artifacts, cross-lane acceptance tests, and integration-only fixes                                                                                                                                                                                                                   | `000900`–`000999` |

Foundation owns root manifests, the lockfile, shared configuration,
`packages/contracts/**`, base schema, migration `000001`, and shared barrels.
Lanes do not edit root dependency versions or `pnpm-lock.yaml`. If a genuinely
missing shared dependency or contract change is unavoidable, record a small
commit for Agent 5 instead of mixing it into lane work.

Each lane has an already-mounted router and exclusive domain, repository,
schema, integration, workflow, and testing directories. Add exports only inside
the lane directory. `packages/db/src/schema/index.ts` already composes the three
lane schema objects, so no shared runtime-schema edit is needed. Never change
`packages/api/src/app.ts` to mount a lane route. SQL migrations are immutable
once merged. Every money-path change includes an integration acceptance test.
Every route under `/v1/webhooks/**` must verify the provider signature against
the untouched raw body before claiming or acknowledging the event; the web proxy
reserves that namespace for verifier-authenticated callbacks.

| Branch                        | Fixed sibling worktree path                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `commerce/core-finance`       | `/Users/jameskurz/Downloads/Fil One/Clockwork-core-finance` |
| `commerce/lifecycle-platform` | `/Users/jameskurz/Downloads/Fil One/Clockwork-lifecycle`    |
| `commerce/experience-docs`    | `/Users/jameskurz/Downloads/Fil One/Clockwork-experience`   |
| `commerce/integration`        | `/Users/jameskurz/Downloads/Fil One/Clockwork-merge`        |
