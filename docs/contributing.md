# Contributing to Clockwork

This guide preserves the engineering setup, commands and conventions formerly in
the root README. Start with [the README](../README.md) for product context and
the demo.

## Architecture

| Layer           | Choice                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node.js 24, pnpm 10 workspaces, Turborepo, strict TypeScript                                                                                      |
| Web             | Next.js App Router (React Server Components, Server Functions, Suspense), Tailwind CSS v4                                                         |
| API             | Hono mounted inside Next.js at `/api/v1`; Zod schemas generate OpenAPI 3.1 and a typed `openapi-fetch` client                                     |
| Data            | Supabase managed Postgres as the single commerce system of record; Drizzle for typed schema and repositories                                      |
| Migrations      | Reviewed SQL under `supabase/migrations` is canonical and append-only; pgTAP tests run against a from-zero rebuild                                |
| Identity        | WorkOS AuthKit; authorization enforced in the API and domain layers, with row-level security as defense in depth                                  |
| Payments        | Stripe as the billing and payments engine                                                                                                         |
| Workflows       | Durable jobs, schedules, waits, bounded retries and idempotency, on Trigger.dev or on SQS (`CLOCKWORK_TASK_RUNTIME`)                              |
| Documents       | React PDF, deterministic output, immutable S3-style evidence storage                                                                              |
| Everything else | E-signature, CRM, provisioning, accounting, screening, support, and marketplaces cross **typed provider ports** with behaviorally realistic fakes |

Two rules shape most of the code: **every write goes through an authorized
database transaction, a repository operation, and an atomic audit/outbox
append**; and **no external provider is called except through a typed port that
has a deterministic fake**. That is why the whole test suite runs before any
real credential exists.

## Repository layout

```text
clockwork/
├── apps/web/                  # Next.js portal, admin, API and webhook entrypoints
├── packages/api/              # Hono route groups and the authorization boundary
├── packages/contracts/        # Zod schemas, OpenAPI, events, provider contracts
├── packages/domain/           # Pure state machines and commerce rules
├── packages/db/               # Drizzle schema, repositories, transactions, outbox
├── packages/integrations/     # Stripe, WorkOS, e-sign, CRM, accounting adapters
├── packages/workflows/        # Background tasks, workflows and schedules
├── packages/documents/        # Quotes, order forms, statements, certificates
├── packages/ui/               # Design system and Storybook
├── packages/testing/          # Fakes, fixtures, personas, builders, demo reset
├── supabase/                  # Config, canonical migrations, seed, pgTAP tests
├── scripts/                   # Release orchestration, baselines, traceability
├── docs/                      # ADRs, runbooks, gate register, handoffs
└── commerce_platform_spec.md  # The controlling product specification
```

Module boundaries are enforced, not just documented — `pnpm boundaries` runs
dependency-cruiser over `packages` and `apps/web` in CI.

## Quick start

**Prerequisites:** Node 24 (`.nvmrc` / `.node-version` pin the exact version),
pnpm 10 via `corepack`, Docker (for the local Supabase stack), and the Supabase
CLI, which is installed as a dev dependency.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local        # annotated defaults; no real secrets needed

pnpm db:start                     # local Supabase (Postgres + services)
pnpm db:reset                     # rebuild from zero, apply migrations, seed

pnpm dev                          # http://localhost:3000
```

`pnpm db:reset` recreates Postgres from nothing, applies the canonical SQL under
`supabase/migrations`, and loads `supabase/seed.sql`. The seed covers direct,
referral, resale, distributor/two-tier, white-label, marketplace, POC, overdue,
renewal and non-renewal, amendment, dispute, and retention-locked states — so
every surface has something real to show on first run.

Other useful entry points:

```sh
pnpm storybook                    # design system at :6006
pnpm db:stop                      # stop the local stack
```

### Environment

`.env.example` is the complete, annotated list of variables and is safe to copy
verbatim for local work — the placeholders are unset, and local tests use
deterministic fakes rather than live providers. A few worth knowing:

| Variable                                          | Purpose                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL` / `CLOCKWORK_SERVICE_DATABASE_URL` | Separate SSL Supavisor transaction-mode URLs for the two restricted application roles |
| `DIRECT_DATABASE_URL`                             | Accepted by migration tooling only, never by the runtime                              |
| `AUTHORIZATION_CONTEXT_SECRET` / `..._SECRET_ID`  | Signs the tenant authorization context; supports overlap-safe rotation                |
| `CLOCKWORK_EXPERIENCE_ADAPTER`                    | `database` for real data, `demo` for deterministic fixtures                           |
| `CLOCKWORK_TASK_RUNTIME`                          | `trigger` for Trigger.dev Cloud, `sqs` for the queue and in-process poller            |
| `WORKFLOWS_QUEUE_ID`                              | The task queue URL, injected by the deployment; read by the `sqs` runtime only        |

Production never uses `postgres` or `service_role`; runtime roles are
`NOBYPASSRLS`, and browser bundles receive no database credentials. See
[`docs/foundation-handoff.md`](foundation-handoff.md) for the managed-project
role setup and secret-rotation procedure.

## Guided demo (no credentials required)

The repository ships a guided demo mode that runs the full portal against
deterministic fixtures — no Supabase, WorkOS, or Stripe credentials, and no
database. Set these in `.env.local` and run `pnpm dev`, then open
`http://localhost:3000/demo`:

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo
CLOCKWORK_DEMO_DEPLOY=1
```

You get a persona picker — customer, partner, and internal-staff journeys — each
landing in the surfaces that persona is entitled to see.

Demo mode is deliberately hard to switch on by accident: it requires the
explicit opt-in **and** the demo adapter, and it refuses to activate if any
production marker is present in the environment, flag or no flag. A demo deploy
can additionally be password-gated with `CLOCKWORK_DEMO_ACCESS_PASSWORD`.

The hosted demo at https://clockwork-commerce-demo.netlify.app deploys directly
from a local checkout, not from GitHub. Commit, push, and merge to `main` first,
then deploy from `main` with the Netlify CLI: merging alone changes nothing on
the live site, and deploying from anything other than `main` puts code in front
of prospects that exists in no commit. The route and command are in
[the demo deployment runbook](operations/demo-deploy.md).

## Commands

Everything is a workspace-root `pnpm` script; Turborepo fans them out.

| Command                        | What it does                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | Run every workspace dev task in parallel                                                          |
| `pnpm build`                   | Production build of all workspaces                                                                |
| `pnpm typecheck`               | Strict TypeScript across the monorepo                                                             |
| `pnpm lint`                    | ESLint with `--max-warnings=0` (runs Next.js typegen first)                                       |
| `pnpm format` / `:check`       | Prettier write / verify                                                                           |
| `pnpm boundaries`              | dependency-cruiser module-boundary enforcement                                                    |
| `pnpm generate`                | Regenerate `openapi.json`, `schema.d.ts`, and the typed API client                                |
| `pnpm check:generated`         | Fail if generated artifacts drift from the routes                                                 |
| `pnpm check:traceability`      | Validate `docs/traceability/launch-requirements.json` against its schema                          |
| `pnpm check:citation-liveness` | Require every `path#symbol` ledger citation to have a syntax-resolved non-test implementation use |
| `pnpm scan:secrets`            | secretlint over the whole tree                                                                    |
| `pnpm audit:dependencies`      | `pnpm audit --audit-level=high`                                                                   |
| `pnpm test:unit`               | Unit suites plus the release-script tests                                                         |
| `pnpm test:integration`        | Integration suites (need the local database)                                                      |
| `pnpm db:test`                 | pgTAP tests against the rebuilt database                                                          |
| `pnpm test:storybook`          | Storybook component tests                                                                         |
| `pnpm test:e2e`                | Playwright end-to-end, after `pnpm playwright:install` (`test:e2e:smoke` for the smoke subset)    |
| `pnpm release:parallel`        | The full release suite orchestrator (`:serial`, `:plan`, `:debug`)                                |

## Verification and CI

Four gates compose the full check, and each one is runnable on its own:

```sh
pnpm verify:static     # typecheck, format, lint, boundaries, secrets, audit,
                       # generated drift, traceability grammar + citation liveness
pnpm verify:database   # db reset, pgTAP, unit + integration tests
pnpm verify:build      # application and Storybook builds
pnpm verify:ui         # Storybook component tests and Playwright e2e
pnpm verify            # all four, in order
```

CI runs the same work as seven parallel shards — `static`, `unit`,
`integration`, `build`, `ui`, `demo`, and `proof` — on every pull request and
every push to `main`. The `ui` and `demo` shards run on macOS, because both
compare against the reviewed screenshot baselines. The shard list is the same
list the orchestrator uses, `RELEASE_SUITE_NAMES`, and a test in
`scripts/release-artifacts.test.mjs` fails if the workflow drifts from it.

Testing uses fixed clocks, stable demo identifiers and `.test` domains, with
provider fakes for replay and failure scenarios.

## Conventions that matter

- **Shared types live in `@clockwork/contracts`** — Zod schemas, roles,
  permissions, RFC 9457 problem details, event envelopes, pagination, IDs,
  idempotency keys, and provider ports. Money, clocks, authorization, and state
  transitions live in `@clockwork/domain` and stay pure.
- **Generated artifacts are committed with the change that caused them.** Run
  `pnpm generate` alongside any route change; `pnpm check:generated` enforces
  it.
- **`supabase/migrations` is the source of truth for schema.** Drizzle metadata
  under `packages/db/drizzle/meta` is an aid, never authoritative, and no schema
  change is authored in the Supabase dashboard.
- **Errors are RFC 9457 `application/problem+json`** with a request ID, a stable
  machine code, and a safe user message. Every list endpoint takes a stable
  cursor and an explicit account scope; mutations return the aggregate version
  and any workflow handle.
- **Git hooks** are installed by lefthook on `pnpm install` (`prepare`).

## Release evidence

Use
[the commercial readiness register](commercial-readiness-decision-register.md),
[launch checklist](launch-checklist.md), [external gates](external-gates.md),
and current CI results to assess readiness. Passing local tests does not
demonstrate a live Fil One, payment, tax or accounting cutover. Historical
reports describe only their recorded commits.
