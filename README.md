# Clockwork Commerce

**A self-service commerce platform for infrastructure: registration, agreements,
quotes, POCs, orders, provisioning, invoicing, payment, renewals, and
offboarding — for direct customers, channel partners, and the back office that
oversees both.**

[![CI](https://github.com/jameskurz-filecoin/clockwork/actions/workflows/ci.yml/badge.svg)](https://github.com/jameskurz-filecoin/clockwork/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)

Clockwork replaces the email–PDF–redline chain that business deals usually run
on. A prospect can register, accept or negotiate paper, receive a priced quote,
run a proof of concept, convert it to an order, get provisioned, be invoiced,
pay, amend, renew, and offboard — without a human touching the happy path.
Humans appear as owned exception queues, not as steps.

Two audiences transact on the same objects: **direct customers** and **channel
partners** (referral, resale, distributor/two-tier, white-label, and
cloud-marketplace paths). A third, the **internal back office**, sees everything
and can perform any customer or partner action on their behalf, always
identified as the internal actor.

The full product behavior is specified in
[`commerce_platform_spec.md`](commerce_platform_spec.md) — that document is
controlling, and this repository implements it.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [What's in the box](#whats-in-the-box)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Guided demo (no credentials required)](#guided-demo-no-credentials-required)
- [Commands](#commands)
- [Verification and CI](#verification-and-ci)
- [Conventions that matter](#conventions-that-matter)
- [Documentation map](#documentation-map)
- [Project status](#project-status)

---

## Why this exists

Selling infrastructure against hyperscalers means competing on how easy you are
to buy from. Clockwork treats the buying experience as product surface:

- **Self-service is the default path.** Human involvement is triggered by policy
  — non-standard terms, pricing below guardrails, credit exposure, restricted
  parties — never by process.
- **One artifact chain, no re-keying.** Registration → agreement → quote → order
  → entitlement → invoice → payment. Each object is created from the one before
  it and carries its identifiers forward, so CRM, billing, usage, and partner
  attribution reconcile because they share one source.
- **Partners transact without a partner-ops team.** Deal registration, partner
  pricing, attribution, merchant-of-record split, and price-floor enforcement
  are enforced by the system, not by a spreadsheet.
- **International by design.** Currency, tax, agreement variants, and residency
  are configuration dimensions. A new country is new rows in existing tables,
  not a new project.
- **The portal is a sales asset.** It is demoed in every enterprise meeting and
  partner briefing, so it is built to read as a finished product from a mature
  vendor.

## What's in the box

| Surface                  | What it does                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard**            | Open quotes, orders awaiting action, POCs with days remaining, live services, invoices due — where every deal stands, in one glance.                                                                                                                         |
| **Agreements**           | Executed contracts with version, signatory, effective and renewal dates, including deals on the customer's own paper. Execute new ones here.                                                                                                                 |
| **Quote builder**        | Configure, price, and issue a quote in a few fields. Revise, duplicate, or expire versions; download as PDF (partners get partner-priced).                                                                                                                   |
| **Orders & services**    | POs, provisioning status, live entitlements and usage, per-service term status, amendments. Partners see it per end client.                                                                                                                                  |
| **POCs**                 | Isolated accounts with caps, usage against caps, success tests, expiry countdown, and one-click conversion to a paid quote.                                                                                                                                  |
| **Billing**              | Invoices with PO numbers, credit notes, payment methods, receipts, aging. Pay in place or download for the finance team.                                                                                                                                     |
| **Account & users**      | Legal entity, validated tax IDs, AP and remit-to details, exemption certificates, roles and approval limits, offboarding and deletion certificates.                                                                                                          |
| **Partner portfolio**    | Every end client with term status and upcoming renewals by expiry, deal registration, commissions and statements, consolidated billing, white-label and marketplace controls.                                                                                |
| **Internal back office** | Global search, full account timeline, assisted execution of any customer or partner action, every exception and approval queue, price-book and agreement admin, provisioning recovery, collections, the renewal command center, reports, and reconciliation. |

Underneath: a pricing engine with guardrails, an outbox-backed audit trail,
durable workflows with bounded retries, immutable evidence storage, and
deterministic PDF generation for quotes, order forms, statements, and
certificates.

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
| Workflows       | Trigger.dev for durable jobs, schedules, waits, bounded retries, and idempotency                                                                  |
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
├── packages/workflows/        # Trigger.dev workflows and schedules
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

Production never uses `postgres` or `service_role`; runtime roles are
`NOBYPASSRLS`, and browser bundles receive no database credentials. See
[`docs/foundation-handoff.md`](docs/foundation-handoff.md) for the
managed-project role setup and secret-rotation procedure.

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

## Commands

Everything is a workspace-root `pnpm` script; Turborepo fans them out.

| Command                   | What it does                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`                | Run every workspace dev task in parallel                                                       |
| `pnpm build`              | Production build of all workspaces                                                             |
| `pnpm typecheck`          | Strict TypeScript across the monorepo                                                          |
| `pnpm lint`               | ESLint with `--max-warnings=0` (runs Next.js typegen first)                                    |
| `pnpm format` / `:check`  | Prettier write / verify                                                                        |
| `pnpm boundaries`         | dependency-cruiser module-boundary enforcement                                                 |
| `pnpm generate`           | Regenerate `openapi.json`, `schema.d.ts`, and the typed API client                             |
| `pnpm check:generated`    | Fail if generated artifacts drift from the routes                                              |
| `pnpm check:traceability` | Validate `docs/traceability/launch-requirements.json` against its schema                       |
| `pnpm scan:secrets`       | secretlint over the whole tree                                                                 |
| `pnpm audit:dependencies` | `pnpm audit --audit-level=high`                                                                |
| `pnpm test:unit`          | Unit suites plus the release-script tests                                                      |
| `pnpm test:integration`   | Integration suites (need the local database)                                                   |
| `pnpm db:test`            | pgTAP tests against the rebuilt database                                                       |
| `pnpm test:storybook`     | Storybook component tests                                                                      |
| `pnpm test:e2e`           | Playwright end-to-end, after `pnpm playwright:install` (`test:e2e:smoke` for the smoke subset) |
| `pnpm release:parallel`   | The full release suite orchestrator (`:serial`, `:plan`, `:debug`)                             |

## Verification and CI

Four gates compose the full check, and each one is runnable on its own:

```sh
pnpm verify:static     # typecheck, format, lint, boundaries, secrets, audit,
                       # generated-artifact drift, traceability
pnpm verify:database   # db reset, pgTAP, unit + integration tests
pnpm verify:build      # application and Storybook builds
pnpm verify:ui         # Storybook component tests and Playwright e2e
pnpm verify            # all four, in order
```

CI runs the same work as five parallel shards — `static`, `unit`, `integration`,
`build`, and `ui` (the UI shard on macOS) — on every pull request and every push
to `main`.

Testing is deterministic by construction: the clock is fixed at
`2026-07-31T16:00:00Z`, demo identifiers and `.test` domains are stable, and
provider fakes reproduce error and replay timing. The tree carries 244 test
files among its 785 TypeScript sources, plus 22 pgTAP suites and 14 Playwright
specs.

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

## Documentation map

| Path                                                       | What you'll find                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`commerce_platform_spec.md`](commerce_platform_spec.md)   | The controlling specification: lifecycle, domain model, pricing, billing, partner layer, architecture                                               |
| [`docs/foundation-handoff.md`](docs/foundation-handoff.md) | **Start here as a contributor** — toolchain, commands, ownership, generated artifacts                                                               |
| [`docs/adr/`](docs/adr/)                                   | Eight ADRs recording the fixed architecture decisions                                                                                               |
| [`docs/operations/`](docs/operations/)                     | Runbooks: disaster recovery, webhook replay, dead-letter recovery, billing reconciliation, migration, offboarding, release orchestration, telemetry |
| [`docs/external-gates.md`](docs/external-gates.md)         | The complete register of external inputs gating production activation                                                                               |
| [`docs/launch-checklist.md`](docs/launch-checklist.md)     | What must be true before launch                                                                                                                     |
| [`docs/design/`](docs/design/)                             | The experience system, task briefs, and the accessibility report                                                                                    |
| [`docs/baseline/`](docs/baseline/)                         | Machine-readable baseline manifests used by release qualification                                                                                   |

## Project status

The implementation is **repository-qualified on `main`**: the product behavior
in the specification is built, not deferred. What remains gated is external —
provider credentials, counsel/commercial/tax inputs, the provisioning API,
domains, brand, approvers, and teardown authority. Those are tracked
individually in [`docs/external-gates.md`](docs/external-gates.md), and features
activate as their exact registered inputs arrive.

This is not a release candidate or a launch declaration. `main` is the only
active branch.

## License

No license file is present in this repository, so default copyright applies and
no rights are granted for external use.
