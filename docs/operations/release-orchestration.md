# Deterministic release orchestration

Status: implementation complete; measured serial/parallel evidence is produced
only from a clean committed repository candidate

## Shards and budgets

The release contract has seven shards: `static`, `unit`, `integration`, `build`,
`ui`, `demo`, and `proof`. `pnpm release:parallel` runs them concurrently;
`pnpm release:serial` runs the identical commands in order; `pnpm release:debug`
is the one-worker readable reproduction path. The 45-minute local and 30-minute
CI clocks begin before disposable worktrees, dependency installation, database
startup, migration, and seeding.

CI assigns ports 32000–32006 explicitly. Each local shard receives a detached
worktree, unique app port, database schema name, queue namespace, fixture
namespace, fixed clock, storage root, artifact root, and Next.js output
directory. Integration and proof each start a different Supabase project with a
different project identifier and 20-port allocation block, reset that project
from the candidate migrations/seed, use its own database URLs, and stop it in
`finally`. CI shards run in separate machines and publish the same isolation
contract for the join validator.

The UI shard explicitly selects the non-production `demo` adapter. The proof
shard explicitly selects the database adapter, production environment, canonical
localhost origin, production build directory, and release-proof authentication.
Persona headers, account headers, route interception, and first-party page
mocking are forbidden in proof.

## Assertion and artifact equivalence

Every result records the source-manifest hash and an assertion fingerprint over
the exact command list, fixed clock, coverage semantics, and failure semantics.
Coverage files are compared byte-for-byte. Runtime artifacts, retained
screenshots/traces, and semantic build manifests are content hashed.

Only these nondeterministic fields are normalized before comparison:

- disposable absolute workspace and artifact paths;
- Playwright wall-clock durations, start/end timestamps, worker indexes, and ISO
  runtime timestamps.

Binary artifacts are never normalized. Their exact bytes are hashed. The
serial/parallel comparison fails if a shard is missing, a status or retry policy
differs, an assertion/coverage/artifact fingerprint differs, or parallel
execution does not improve wall time by at least 30 seconds or 15 percent.
`pnpm release:benchmark <optional-token>` runs the actual serial candidate, the
actual parallel candidate, and the comparison in one command.

## Retry and cleanup policy

There are no suite or Playwright retries by default. One retry is possible only
when `CLOCKWORK_RELEASE_INFRA_RETRY_CATEGORY` names a narrow diagnosed category
and the output matches its associated signature. Product assertion failures
never qualify. Worktrees, database projects, and authentication state are
cleaned in `finally`; production-proof sessions are explicitly revoked. CI
upload patterns exclude authentication storage state.

## Cross-lane generated output join

Instance 4 does not write the shared OpenAPI or Drizzle outputs. Static
verification runs `drizzle-kit check` and generates OpenAPI files only in a
disposable nested worktree, then compares their hashes to the committed outputs.
Instance 5 owns the final shared generation and joins that evidence to this
release gate.
