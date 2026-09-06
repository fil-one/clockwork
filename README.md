# Clockwork

Clockwork is an internal quote-to-cash portal for Fil One. Customers, partners
and staff work from the same commercial records: a quote becomes an accepted
order with provisioning and payment records. Usage billing also supports a
separate retained PAYG source, so invoices and corrections retain their actual
commercial origin.

The repository has a working guided demo and substantial application, pricing,
billing and approval infrastructure. Production activation still needs approved
commercial/legal/tax policy, live provider mappings and an end-to-end pilot.
This README does not declare a production launch.

Engineering ownership is a separate decision tracked in
[RFC #25](https://github.com/fil-one/RFC/pull/25). The implementation and demo
do not establish an ownership commitment. Clockwork is an internal portal, not a
separately marketed product; its license remains evaluation-only.

## Try the demo

[Open the hosted demo](https://clockwork-commerce-demo.netlify.app/). It uses a
shared access password, then a persona picker for customers, partners and
internal staff. Request the password from the project owner.

Demo transactions use fictional data and deterministic provider adapters. They
do not charge a card, provision a Fil One organization or prove that a live
integration is ready. The hosted demo is deployed separately from GitHub merges;
see [deployment instructions](docs/operations/demo-deploy.md).

To run locally without a database, use the Node version in `.node-version` and
pnpm 10:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Set these values in `.env.local`:

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo
CLOCKWORK_DEMO_DEPLOY=1
```

Run `pnpm dev`, then open [localhost:3000/demo](http://localhost:3000/demo).
Demo mode refuses production-marked environments. Finance personas can review
fictional price books, PAYG/trial policies, and channel controls in resettable
workspaces. Live administration requires an authenticated staff session and the
authoritative database.

## What is here

| Area                      | Behavior                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Quotes and orders         | Versioned pricing, commercial review, acceptance and a shared order record                                               |
| Commercial administration | Multi-rate price books, floors, transfer tiers, discounts, simulations and effective-dated channel controls              |
| PAYG and trials           | Versioned policy administration plus hourly usage rating, monthly minimum/correction and trial enforcement foundations   |
| Billing and partners      | Invoices, payment evidence, referral accruals, commission statements and financial corrections                           |
| Internal operations       | Persisted queues and registries, audited decisions, and two-person capability activation with immediate disable controls |

Approved price versions and new quoted referral commission policies retain
immutable economics. Existing contracts and legacy policy gaps require explicit
handling. See the
[commercial administration guide](docs/operations/commercial-admin.md),
[capability controls](docs/operations/capability-controls.md), and
[commercial readiness register](docs/commercial-readiness-decision-register.md)
for scope and limitations.

## Work on it

[Contributor setup and commands](docs/contributing.md) cover the full local
Supabase app, architecture, tests and conventions. The main code is in
`apps/web` and `packages/{api,domain,db,integrations,workflows}`; canonical
migrations and database tests are in `supabase`.

The [product specification](commerce_platform_spec.md) describes intended
behavior. The [Fil One boundary design](docs/adjacent-service-integration.md)
describes the required identity, provisioning, usage and billing integration. A
design document or passing provider-fake test is not evidence of a completed
production integration.

Before release, review the [launch checklist](docs/launch-checklist.md),
[external gates](docs/external-gates.md), current
[CI runs](https://github.com/fil-one/clockwork/actions), and commit-specific
validation evidence. Repository checks and live-provider qualification are
separate release requirements.

Clockwork is evaluation-only; see [LICENSE](LICENSE).
