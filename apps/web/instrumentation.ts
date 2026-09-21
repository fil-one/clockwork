/**
 * Next calls `register()` once per server start, once for every runtime it
 * builds, and it builds this module for the edge runtime as well as the node
 * one. The host belongs to the node process: it signs on for SIGTERM and owns
 * the poller, neither of which the edge runtime has. So the edge build reached
 * `process.exit` and `process.once` in `src/task-host.ts`, failed to compile,
 * and was retried on the next request, and the one after that: about seventy
 * failed compiles per page in `next dev`, each one printing its stack. On the
 * macos CI runner that noise is charged to whichever expectation is waiting
 * for a route to finish compiling, and it is how `ux-shell.spec.ts` spent 95
 * seconds waiting for `/quotes` and then its whole 120-second budget.
 *
 * The import is dynamic and inside the guard because a top-level import puts
 * the module in the edge bundle whatever the guard decides at runtime.
 *
 * Edge is excluded by name rather than node required by name, for the reason
 * `src/task-host.ts` records at its own guard: the standalone server can reach
 * a runtime check with `NEXT_RUNTIME` unset, and a host that starts nowhere is
 * a container that neither drains its queue nor handles SIGTERM. Unset starts
 * the host. Only the literal "edge" declines.
 *
 * Everything the hook does lives in `src/task-host.ts`, under test. The hook
 * itself only starts it and returns: a poller that cannot reach its database
 * yet must not hold up the server, and a throw from here is fatal to the
 * process, so the host swallows its own failures and retries.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startTaskHost } = await import("@/src/task-host");
  startTaskHost();
}
