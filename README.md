# Clockwork

An internal quote-to-cash portal I built for Filecoin Foundation. It is not a
product we sell.

Sales and partners currently chase Fil One deals through email, PDFs, HubSpot,
and Stripe. Clockwork is a web app where a quote becomes an order, the order is
what we provision, and invoices attach to that order.

Engineering has **not** agreed to own this. See
[RFC #25](https://github.com/fil-one/RFC/pull/25). Until that decision, treat
the repo as a prototype with a working demo.

## Look at this first

Hosted demo: https://clockwork-commerce-demo.netlify.app/

Password is in the FF 1Password vault (I will add it if it is not there yet).

The demo has three personas — customer, partner, internal staff — and fake
data. It does not talk to real Stripe, Auth0, or Forge.

If you are an engineer being asked to take this on, the RFC is the decision
document. This README is just how to run it.

## What it does

| Surface | Point |
| --- | --- |
| Quotes | Price a Fil One SKU and send a quote |
| Orders | Accept a quote; that is the thing we would provision |
| Partners | Referral / resale view of the same deals |
| Billing | Invoices and payments (Stripe is the card network; Clockwork is the record) |
| Back office | Search, exceptions, do a customer action on their behalf |

Fil One still owns buckets, usage, and Auth0. Clockwork does not write to
those yet. WorkOS is only how this app logs people in for the demo.

## Run the demo locally (no database)

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

In `.env.local`:

```sh
CLOCKWORK_EXPERIENCE_ADAPTER=demo
CLOCKWORK_DEMO_DEPLOY=1
```

Then `pnpm dev` and open http://localhost:3000/demo.

## Run the full app locally

Needs Docker (local Supabase) and Node 24.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:start
pnpm db:reset
pnpm dev                      # http://localhost:3000
```

Useful: `pnpm storybook`, `pnpm test:unit`, `pnpm verify:static`.

## Layout

```text
apps/web/                 portal, admin, API
packages/api/             HTTP routes
packages/domain/          quote/order/invoice rules
packages/db/              Postgres / Drizzle
packages/integrations/    Stripe, WorkOS, fakes for everything else
supabase/                 migrations and seed
commerce_platform_spec.md long product spec (optional)
```

## Please skip

Most of `docs/` was written as qualification evidence, not as an introduction.
In particular, do not start at `docs/release-candidate-report.md`.

If you need more after the demo: `commerce_platform_spec.md` is the intended
behavior; `docs/adjacent-service-integration.md` is a draft of how this would
talk to Fil One. Neither is implemented against production.

## Status

Built by James, with a lot of AI assistance. Tests in this repo cover the demo
and the domain rules, not a production Stripe/Auth0/Forge integration. GitHub
Actions is currently blocked on the org billing limit.

License is evaluation-only. See [`LICENSE`](LICENSE).
