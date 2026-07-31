# ADR 0001: Standalone Next.js on Vercel

Status: Accepted, 2026-07-31

Clockwork is a greenfield Turborepo. Its only application is a Next.js App
Router service deployed to Vercel; Hono is mounted inside Next route handlers.
It must not import or deploy through the older Fil One SPA, SST, Lambda,
DynamoDB, or Aurora code described in §18 of the preserved product spec. The
user-provided fixed architecture supersedes that stale implementation section
while the product behavior remains controlling.

Vercel previews deploy the web app against a matching Supabase preview branch.
Package boundaries keep the commerce domain portable, but no second runtime is
supported.
