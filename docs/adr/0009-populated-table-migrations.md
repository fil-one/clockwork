# ADR 0009: Migrations written for a populated table

Status: Accepted, 2026-08-14

Every migration before `001380` was written for an empty database. Across 137
index creations and 87 check constraints none uses `concurrently`, `not valid`,
or `lock_timeout`, and `001340` adds a stored generated column that rewrites
`invoices` under ACCESS EXCLUSIVE. On a seeded volume that costs nothing; on a
populated one each of those takes a lock of unbounded duration and every
statement waiting behind it blocks the statements behind that. The convention
from `001380` forward is that a migration states what it will wait for.

The runner constrains the shape. The Supabase CLI executes the first statement
of a file alone and pipelines the rest, and PostgreSQL 17 rejects a concurrent
index build inside a pipeline with SQLSTATE 25001, so
`create index concurrently` succeeds only in a migration file containing exactly
one statement; `--> statement-breakpoint` does not change this. There is also no
surrounding transaction: `set local` warns that it is outside a transaction
block, and each statement commits on its own. So a multi-statement migration
sets `lock_timeout` once at the top, resets it at the end, keeps one DDL
statement per statement so a run that times out has already committed everything
before it, and writes `if not exists` or `not valid` so the retry resumes rather
than restarts. `lock_timeout` bounds the wait to acquire the lock, not the time
the build holds it; a table large enough that the hold itself is unacceptable
gets its single `create index concurrently` in a migration file of its own.

None of this is applied retroactively. ADR-0003 already fixes applied migrations
as immutable and shared corrections as forward-only on `main`, and rewriting a
migration that has already run everywhere replaces a known lock with an unknown
divergence. The historical files stay exactly as they are.
