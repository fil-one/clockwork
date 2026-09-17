import { startTaskHost } from "@/src/task-host";

/**
 * Next calls `register()` once per server start.
 *
 * Everything the hook does lives in `src/task-host.ts`, under test. The hook
 * itself only starts it and returns: a poller that cannot reach its database
 * yet must not hold up the server, and a throw from here is fatal to the
 * process, so the host swallows its own failures and retries.
 */
export function register(): void {
  startTaskHost();
}
