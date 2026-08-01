# Foundation handoff

Current disposition (2026-08-01): repository-qualified historical foundation
provenance. All integration expectations are satisfied on `main`; this document
does not identify an active lane or declare an RC/launch.

## Toolchain and commands

Use Node `24.18.1` and pnpm `10.34.5` (`corepack pnpm`). Copy `.env.example`
only for real sandbox work; local tests use deterministic fakes.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm boundaries
pnpm typecheck
pnpm scan:secrets
pnpm run audit:dependencies
pnpm db:start
pnpm db:reset
pnpm db:test
pnpm test:unit
pnpm test:integration
pnpm test:storybook
pnpm build:storybook
pnpm build
pnpm playwright:install
pnpm test:e2e:smoke
pnpm db:stop
```

`db:reset` recreates Postgres from zero, applies canonical Supabase SQL, and
loads `supabase/seed.sql`. Runtime `DATABASE_URL` and
`CLOCKWORK_SERVICE_DATABASE_URL` are separate SSL Supavisor transaction-mode
URLs whose tenant-qualified usernames begin with `clockwork_runtime` and
`clockwork_service`. `DIRECT_DATABASE_URL` is accepted only by migration
tooling.

For a managed project, migrate first, then run
`psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/production-roles.sql`
with the role passwords, authorization secret, and secret ID populated. The
roles are `NOBYPASSRLS`; production never uses `postgres` or `service_role`. For
overlap-safe rotation, insert a second active secret ID, deploy its matching
application secret, prove a signed tenant query succeeds and tampering returns
zero rows, then mark the former database secret inactive.

## Contracts and ownership

Shared Zod types, roles, permissions, RFC 9457 errors, event envelopes,
pagination, IDs, idempotency keys, and provider ports are in
`@clockwork/contracts`. Domain money, clocks, authorization, and transitions are
in `@clockwork/domain`. All writes use an authorized database transaction,
repository operation, and atomic audit/outbox append.

The API composed core, lifecycle, and system routers before the historical lane
work began. Integrations and workflows had equivalent lane-owned registries.
`docs/agent-lanes.md` and `docs/implementation-lanes.md` preserve those
historical paths. After the three historically named RC-lane merges, `main` owns
all source, shared contracts, generated artifacts, release evidence, and future
forward-only migrations.

## Generated artifacts

`pnpm generate` writes `packages/api/src/generated/openapi.json` and
`schema.d.ts`; `client.ts` is the typed `openapi-fetch` entry. Commit changed
generated artifacts with the route change. Drizzle metadata under
`packages/db/drizzle/meta` is an aid; reviewed SQL in `supabase/migrations` is
canonical. The repository-qualified authoring output is `0004_nosy_valkyrie` for
116 tables. Drizzle configuration never writes into the Supabase migration
directory.

## Demo and testing

The fixed clock is `2026-07-31T16:00:00Z`. Demo IDs and `.test` domains are
stable. The seed includes direct, referral, resale, distributor/two-tier,
white-label, marketplace, POC, overdue, renewal/non-renewal, amendment, dispute,
and retention-locked states. Provider fakes and test helpers cover error/replay
timing before credentials exist.

## Known gates

No external gate prevents Agents 2–4 from implementing against ports and fakes.
`docs/external-gates.md` is the complete activation register; real transactions
remain blocked until the relevant credentials, counsel/commercial/tax inputs,
provisioning API, domains, brand, approvers, and teardown authority arrive.
