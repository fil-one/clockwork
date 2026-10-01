# Vendored dependency patches

Every file here is applied by pnpm through `patchedDependencies` in the root
`package.json`. A patch is invisible maintenance debt, so each one is recorded
below with the condition that retires it. **Check this file before bumping any
of these dependencies.**

Patches apply on every install, including `--frozen-lockfile`, which is what CI
runs. A bump that changes the version key silently drops the patch — pnpm does
not warn — so the version in `patchedDependencies` must move with the
dependency, or the patch must be deleted deliberately.

## Retired: Next.js script nonce patch

Next.js 16.3.8 includes the `nonce: ctx.nonce` behavior previously supplied by
`next@16.3.3.patch`. The upgrade verifies both CJS/ESM source builders and all
eight compiled app-page runtime variants (development/production, Turbopack, and
experimental). The patch and its pnpm registration are retired.
`apps/web/src/proxy-nonce-propagation.test.ts` continues to guard the behavior
under the application's strict CSP.

## `minimatch@3.1.5.patch` and `minimatch@5.1.9.patch`

Predate this note and carry no recorded rationale; both are small enough to read
in full. If you touch either, replace this paragraph with the same shape as the
entry above — what, why, upstream, and the condition that retires it.
