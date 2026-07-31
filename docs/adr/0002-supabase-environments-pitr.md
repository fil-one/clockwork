# ADR 0002: Supabase projects, previews, and recovery

Status: Accepted, 2026-07-31

Production and staging are separate managed Supabase projects. Every pull
request uses a Supabase database branch linked to the Vercel preview; it is
migrated from zero and never shares a schema with another preview. Local and CI
use the pinned Supabase CLI. Production enables the highest available PITR tier
appropriate to the contract-retention and RPO decision, daily recovery checks,
network restrictions, and connection-pool monitoring.

Branch data is fictional. Production restores are rehearsed into an isolated
project before promotion. The precise project IDs, region/residency, RPO, RTO,
and retention window are deployment inputs and do not alter the schema.
