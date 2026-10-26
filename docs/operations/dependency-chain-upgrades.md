# Dependency-chain upgrade evidence

Status: manifests and lockfile updated; final audit/build/provider replay
evidence pending the coordinated release gate

## Drizzle/esbuild chain

`drizzle-kit` remains on the repository’s compatible 0.31.10 release. Its
`@esbuild-kit/core-utils@3.3.2` edge is version-scoped to `esbuild@0.25.12`; the
lockfile contains no `esbuild@0.18.20` packages. The selector is deliberately
limited to that exact parent edge. It does not replace unrelated esbuild
versions or hide a package-wide incompatibility.

The web application now declares its direct runtime use of `drizzle-orm` through
the catalog instead of relying on workspace hoisting. Node 24 type-checks and
the disposable OpenAPI dry-run are release assertions.

## Trigger/OpenTelemetry chain

Trigger SDK/core is 4.6.4, which supports Zod 4 and includes the 4.6.x Zod
import fix. Its Zod dependency is pinned to 4.6.6 to remove the vulnerable Zod 3
dependency without forcing Zod 4 into an incompatible consumer. The application
catalog also uses Zod 4.6.6. Dependencies below `@trigger.dev/core@4.6.4` remain
aligned: stable OpenTelemetry packages use 2.10.0 and the matching experimental
log/exporter/instrumentation packages use 0.221.0. The lockfile contains neither
`@opentelemetry/core@2.7.1` nor the prior experimental 0.218.0 family.

Each override names both the Trigger parent and the individual OpenTelemetry
package. There is no blanket `@opentelemetry/*` override, so an incompatible
consumer cannot silently inherit this alignment. Trigger’s dynamic import smoke
test, workflow type-check, production build, provider replay, and dependency
audit must all pass before the change is accepted.

## Compatibility envelope

- Node: 24.x, as declared by the root engine and CI setup.
- pnpm: 10.34.5, as declared by `packageManager` and CI.
- Lockfile changes were generated coherently with Node 24 and pnpm 10.
- No peer-dependency warning is waived by `--force`, `--legacy-peer-deps`,
  package-wide override, or audit suppression.

Final command output and wall-clock evidence belong in the release shard
artifacts rather than this narrative file.
