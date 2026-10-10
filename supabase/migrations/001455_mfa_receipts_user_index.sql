-- The team page and the owner console's staff section show each member's latest
-- MFA verification (`max(verified_at) where workos_user_id = ...`, once per
-- member). The receipts index leads on the session, so each lookup scanned the
-- table, which gains a row on every staff sign-in. This index reaches one
-- person's receipts directly, newest first.
--
-- Every staff sign-in writes a receipt, so per ADR-0009 the build is a single
-- `create index concurrently` in a file of its own: the runner executes a file's
-- first statement alone, and a concurrent build only works outside a pipeline.
-- `if not exists` lets a failed run be retried. A build that fails part-way
-- leaves an invalid index that the retry would skip, so deploy/docker/migrate.sh
-- fails the deploy when any index is invalid after the push, and
-- deploy/README.md gives the recovery: drop the index and run this statement
-- again.
create index concurrently if not exists experience_mfa_receipt_user_idx
  on public.experience_mfa_receipts (workos_user_id, verified_at desc);
