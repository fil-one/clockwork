# Release-candidate implementation lanes

All three release-candidate branches are created from the same verified `main`
commit. The annotated `rc-lanes-base-20260731` tag is the authoritative exact
identifier; the Git provenance baseline records the preservation and topology
evidence without claiming a self-referential commit hash. Legacy `commerce/*`
and `ux/*` refs and worktrees remain preserved for the release auditor and are
not active lane instructions.

| Lane                 | Branch                    | Worktree                                                     | Migration range   | Exclusive paths and concerns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------- | ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commercial integrity | `rc/commercial-integrity` | `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-commercial` | `001000`–`001099` | `packages/domain/src/core/**`, `packages/api/src/routes/core/**`, `packages/db/src/{schema,repositories}/core/**`, `packages/integrations/src/core/**`, `packages/testing/src/{core,stripe}/**`; authoritative order composition, money, billing, adjustments, commissions, commercial RLS, accounting, and reconciliation                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Runtime operations   | `rc/runtime-operations`   | `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-runtime`    | `001100`–`001199` | `packages/domain/src/{agreements,compliance,exceptions,identity,lifecycle,migrations,pocs,provisioning,renewals,system,terminations}/**`, `packages/api/src/routes/{lifecycle,system}/**`, `packages/db/src/{schema,repositories}/{lifecycle,system,workflows}/**`, `packages/integrations/src/{crm,domain-ownership,esign,evidence-storage,fakes,lifecycle,marketplaces-platform,migration,notifications,provisioning,screening,support,system,workos}/**`, `packages/workflows/src/**`, `packages/testing/src/{database,migration,providers,trigger,workos}/**`, `apps/web/app/{api,auth,sign-in}/**`, `apps/web/src/{auth,db,providers}/**`, and `apps/web/proxy.ts`; durable execution, identity, schedules, outbox/provider joins, gates, recovery, telemetry, and operational authorization |
| Experience release   | `rc/experience-release`   | `/Users/jameskurz/Downloads/Fil One/Clockwork-rc-experience` | `001200`–`001299` | `apps/web/app/(experience)/**`, `apps/web/app/{access,choose-organization,register,signing}/**`, `apps/web/app/{globals.css,layout.tsx,page.tsx}`, `apps/web/src/{features,i18n,storybook}/**`, `apps/web/e2e/**`, `packages/ui/src/**`, `packages/documents/src/**`, `packages/testing/src/{demo,personas,playwright,visual}/**`; authoritative portal projections/actions, document delivery, design/accessibility, browser proof, and demo safety                                                                                                                                                                                                                                                                                                                                              |

## Shared-file rule

The following remain integration-owned and no parallel lane edits them: root
manifests and lockfile, `.github/**`, shared package barrels and
`packages/contracts/**`, generated OpenAPI/client artifacts, canonical
specification, traceability and baseline manifests, and cross-lane CI/test
composition. Top-level package composition, `packages/api/src/app.ts`,
`packages/db/src/schema.ts`, `packages/testing/src/release/**`, web/package
manifests and build/test configuration are shared even when they compose
lane-owned modules. A lane that needs a shared change records the exact
requested patch and contract impact in its handoff. Integration owns every path
not explicitly assigned above, so an omitted path never becomes implicitly
shared or available to two lanes.

Lanes do not merge or cherry-pick one another. Each lane commits only its owned
source and migration range, keeps its worktree clean, and reports test evidence
plus generated/shared-file requests. Applied migrations are immutable. Any
ownership ambiguity is resolved on `main` before work continues; it is not
settled by having both lanes edit the same file.
