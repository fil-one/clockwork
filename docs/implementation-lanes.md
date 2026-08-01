# Historical release-candidate implementation lanes

This file is an audit record, not an active work instruction. `main` is now the
only active development and release branch. All three release-candidate lanes
started from the verified commit peeled by `rc-lanes-base-20260731`,
`27fb33bab754b001acf26134d988daa10d177390`, and were integrated in the required
order with explicit non-fast-forward commits.

| Order | Historical lane      | Tip                                        | Merge into `main`                          | Migration range   |
| ----- | -------------------- | ------------------------------------------ | ------------------------------------------ | ----------------- |
| 1     | Commercial integrity | `cc23bce784ee60a27ad3e34fd245136f37394a2d` | `1f070aaf0e59a2e289322b02725c2b950e667992` | `001000`–`001099` |
| 2     | Runtime operations   | `0c91acfa2666d93d3f4cb563f3fc5b9f27f20ae5` | `07023a40462cb432f595007c1f88365f14e0f5e8` | `001100`–`001199` |
| 3     | Experience release   | `b13a1ec6816b9a547aaa20bf8806cd3996c840be` | `ab0ae079e674feafd4ae86413d168e001416c0e2` | `001200`–`001299` |

The historical tips, merge commits, migration numbers, and original ownership
are retained here so the release archive can prove ancestry after local lane
branches and linked worktrees are retired. Applied migrations remain immutable.

## Reviewed ownership exceptions

The intended shared-file rule reserved root manifests, the lockfile, CI, shared
contracts/barrels, base schema composition, generated outputs, the canonical
specification, and release evidence for serial integration. Two lanes delivered
isolated exceptions that the integrator reviewed instead of accepting an entire
side:

- Commercial integrity added `collection_case` to
  `packages/contracts/src/primitives.ts` and composed its schema through
  `packages/db/src/schema.ts`.
- Experience release changed root/web manifests, `pnpm-lock.yaml`, CI and
  release orchestration scripts required by its clean-checkout proof.

These exceptions do not revise the ownership rule retroactively. Their retained
semantics and final conflict resolutions belong in the release report and final
qualification evidence. Generated OpenAPI, clients, and Drizzle artifacts remain
serial integration outputs.
