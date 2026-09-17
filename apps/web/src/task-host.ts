/**
 * Hosts the workflow tasks inside the web process when the queue runtime is
 * selected, and owns the process's shutdown either way.
 *
 * On Trigger.dev the tasks run in Trigger's own worker and this starts no
 * poller; on SQS there is no separate worker, so this process activates the
 * workflow runtime, registers the task modules and drains the queue.
 *
 * The container runs with `NEXT_MANUAL_SIG_HANDLE=true`, which means Next no
 * longer closes the server and calls `process.exit(143)` on SIGTERM. That is
 * deliberate: Next's handler exits in milliseconds, which would kill a run that
 * had charged a customer and not yet recorded it. The signal is handled here
 * instead — stop receiving, let the runs in flight land, then exit — and
 * because Next's handler is off, a process that hosts no poller has to exit
 * here too or the container would sit until ECS killed it.
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 100_000;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
const MAX_MESSAGE_CHARS = 200;

export interface TaskPollerLike {
  start(): void;
  stop(): Promise<void>;
}

export interface TaskHostOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (entry: Record<string, unknown>) => void;
  /** Builds a poller that is ready to receive; the host starts it. */
  readonly createPoller?: () => Promise<TaskPollerLike>;
  readonly onSignal?: (signal: string, handler: () => void) => void;
  readonly exit?: (code: number) => void;
  readonly delay?: (ms: number) => Promise<void>;
  /** How long the runs in flight get once the process has been signalled. */
  readonly drainTimeoutMs?: number;
}

export interface TaskHost {
  /** Resolves once the poller is receiving, or at once when this process hosts none. */
  readonly running: Promise<void>;
  readonly poller: () => TaskPollerLike | undefined;
  /** Stops receiving and waits, to the deadline, for the runs in flight. */
  shutdown(): Promise<void>;
}

/** The queue runtime, however the deployment spelled the value. */
function wantsQueueRuntime(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "sqs";
}

/**
 * What a log line may say about a failure: a name, a string code when there is
 * one, and a bounded prefix of the message. An unbounded message is how a
 * rejected value reaches a log.
 */
function summarize(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error))
    return {
      name: typeof error,
      message: String(error).slice(0, MAX_MESSAGE_CHARS),
    };
  const summary: Record<string, unknown> = { name: error.name };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") summary.code = code;
  summary.message = error.message.slice(0, MAX_MESSAGE_CHARS);
  return summary;
}

/**
 * The poller the deployment gets: the workflow runtime is activated before the
 * task modules load, because a module's registration is an eval side effect and
 * the first delivery can arrive as soon as the poller starts.
 */
async function createProductionPoller(): Promise<TaskPollerLike> {
  const {
    activateWorkflowRuntime,
    createEnvironmentSqsTaskPoller,
    createWorkflowRuntime,
  } = await import("@clockwork/workflows");
  const { loadAllTaskModules } = await import("@clockwork/workflows/tasks");
  const { getServiceDatabase } = await import("@/src/db/service");

  await activateWorkflowRuntime(() =>
    createWorkflowRuntime({ db: getServiceDatabase() }),
  );
  await loadAllTaskModules();
  return createEnvironmentSqsTaskPoller(process.env, {
    log: (entry) => console.log(JSON.stringify(entry)),
  });
}

export function startTaskHost(options: TaskHostOptions = {}): TaskHost {
  const {
    env = process.env,
    log = (entry) => console.log(JSON.stringify(entry)),
    createPoller = createProductionPoller,
    onSignal = (signal, handler) => void process.once(signal, handler),
    exit = (code) => process.exit(code),
    delay = (ms) =>
      new Promise<void>((resolve) => void setTimeout(resolve, ms)),
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  } = options;

  let poller: TaskPollerLike | undefined;
  let stopping = false;
  let shutdown: Promise<void> | undefined;

  async function drain(): Promise<void> {
    stopping = true;
    const current = poller;
    poller = undefined;
    if (!current) return;
    const finished = current
      .stop()
      .then(() => true)
      .catch((error: unknown) => {
        log({ event: "TASK_DRAIN_FAILED", ...summarize(error) });
        return true;
      });
    const landed = await Promise.race([
      finished,
      delay(drainTimeoutMs).then(() => false),
    ]);
    log({
      event: landed ? "TASK_DRAIN_COMPLETE" : "TASK_DRAIN_TIMEOUT",
    });
  }

  function requestShutdown(): Promise<void> {
    shutdown ??= drain();
    return shutdown;
  }

  async function startWithRetry(): Promise<void> {
    let backoff = FIRST_RETRY_MS;
    for (let attempt = 1; !stopping; attempt += 1) {
      try {
        const started = await createPoller();
        if (stopping) {
          await started.stop();
          return;
        }
        started.start();
        poller = started;
        log({ event: "TASK_POLLER_STARTED" });
        return;
      } catch (error) {
        // A poller that never starts drains nothing, and the web tier stays
        // healthy while it does: the queue's age-of-oldest-message alarm is
        // what reports it, and this keeps trying until an operator fixes the
        // cause or the deployment is rolled back.
        log({
          event: "TASK_POLLER_START_FAILED",
          attempt,
          ...summarize(error),
        });
        if (stopping) return;
        await delay(backoff);
        backoff = Math.min(backoff * 2, MAX_RETRY_MS);
      }
    }
  }

  // Only the Edge runtime is excluded, and it is excluded by name. Next sets
  // `NEXT_RUNTIME` for code it bundles for Edge, but in the Node standalone
  // server the variable reaches this module unset: it is read through `env`
  // rather than written as a literal `process.env.NEXT_RUNTIME`, so the
  // bundler's static substitution does not apply. Requiring it to equal
  // "nodejs" therefore matched nothing in the container — no poller ever
  // started, and, with Next's own handler disabled by NEXT_MANUAL_SIG_HANDLE,
  // no SIGTERM handler was installed either, so the task was SIGKILLed.
  if (env.NEXT_RUNTIME === "edge")
    return {
      running: Promise.resolve(),
      poller: () => undefined,
      shutdown: () => Promise.resolve(),
    };

  for (const signal of ["SIGTERM", "SIGINT"])
    onSignal(signal, () => {
      void requestShutdown().then(() => exit(0));
    });

  const running = wantsQueueRuntime(env.CLOCKWORK_TASK_RUNTIME)
    ? startWithRetry()
    : Promise.resolve();

  return {
    running,
    poller: () => poller,
    shutdown: requestShutdown,
  };
}
