# ADR 0001: Standalone Next.js on Vercel

Status: Accepted, 2026-07-31

Clockwork is a greenfield Turborepo. Its only application is a Next.js App
Router service deployed to Vercel; Hono is mounted inside Next route handlers.
It must not import or deploy through the older Fil One SPA, SST, Lambda,
DynamoDB, or Aurora stack. The July 31 production-spec rewrite incorporates this
decision in its canonical §18; earlier versions of that section are historical
product context only.

Vercel previews deploy the web app against a matching Supabase preview branch.
Package boundaries keep the commerce domain portable, but no second runtime is
supported.
