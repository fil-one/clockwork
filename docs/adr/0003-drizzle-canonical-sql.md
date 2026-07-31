# ADR 0003: Drizzle schema and canonical SQL migrations

Status: Accepted, 2026-07-31

Drizzle defines the typed application schema. Reviewed Supabase SQL files are
the canonical migration history because RLS, triggers, pgTAP, and extension
behavior exceed generated DDL. `drizzle-kit generate` is an authoring/diff aid;
generated SQL is reconciled into a reserved migration and reviewed before
execution.

Foundation owns `000001`–`000099`; core-finance owns `000100`–`000199`;
lifecycle owns `000200`–`000299`; experience/system owns `000300`–`000399`;
integration fixes own `000900`–`000999`. Applied migrations never change. CI
starts Supabase from an empty volume, applies every migration, seeds, and runs
pgTAP. Runtime uses Supavisor transaction mode with SSL and prepared statements
disabled. Only CI/deployment migration tooling may read `DIRECT_DATABASE_URL`.
