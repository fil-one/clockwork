import type { Actor } from "@clockwork/contracts";
import {
  ContractDocumentStores,
  ContractSigningRepository,
  ESignReconciliationRepository,
  MndaRepository,
  PostgresContractDocumentStore,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  SignWellClient,
  SignWellContractClient,
} from "@clockwork/integrations";

import { ContractSigningWorkflow } from "../contracts";
import { MndaWorkflow } from "../mnda";

/**
 * The backstop for SignWell webhooks. A callback that never arrives (a wrong
 * callback URL, an outage on either side, a 503 SignWell gave up retrying)
 * leaves a request showing an old state with nothing to correct it but a
 * person pressing refresh. Every tick this re-reads, through each workflow's
 * own `sync`, the requests that are still open in SignWell and that nothing
 * has changed recently. `sync` takes the request's lease, so it cannot race a
 * webhook or a person acting on the same request: a held lease is skipped and
 * picked up on the next tick.
 */
export interface ESignReconciliationSource {
  /** Which register the ids belong to; used in logs and the run summary. */
  readonly kind: "mnda" | "contract";
  stale(query: {
    updatedBefore: Date;
    exclude: readonly string[];
    limit: number;
  }): Promise<readonly string[]>;
  sync(id: string, actor: Actor): Promise<unknown>;
}

export interface ESignReconciliationOptions {
  /** A request changed more recently than this is left alone. */
  readonly freshForMs?: number;
  readonly pageSize?: number;
  /** Requests read per source per run. */
  readonly maxPerSource?: number;
  /** No request is started after this much of the run has passed. */
  readonly budgetMs?: number;
  readonly now?: () => number;
  readonly log?: (entry: Record<string, unknown>) => void;
}

export interface ESignReconciliationSummary {
  kind: ESignReconciliationSource["kind"];
  synced: number;
  busy: number;
  failed: number;
}

/** Recorded as the actor on any state change the sweep applies. */
export const eSignReconciliationActor: Actor = {
  kind: "system",
  id: "esign-reconciliation",
};

const FRESH_FOR_MS = 10 * 60_000;
const PAGE_SIZE = 10;
const MAX_PER_SOURCE = 50;
// The SQS lease on a delivery is 300 seconds and one sync can spend up to
// three 20-second SignWell requests; stopping new work at 150 seconds keeps the
// run inside its lease.
const BUDGET_MS = 150_000;
const MAX_MESSAGE_CHARS = 200;
const busyErrors = new Set(["MNDA_BUSY", "CONTRACT_BUSY"]);

function errorCode(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, MAX_MESSAGE_CHARS)
    : typeof error;
}

const jsonLog = (entry: Record<string, unknown>) =>
  // i18n-exempt: operator log; identifiers and error codes only
  console.log(JSON.stringify(entry));

/**
 * Syncs stale requests one at a time, oldest change first. One request's
 * failure is logged and the sweep moves on; a SignWell 429 ends the run, so
 * the next tick starts afresh rather than adding to the pressure.
 */
export async function reconcileESignatures(
  sources: readonly ESignReconciliationSource[],
  options: ESignReconciliationOptions = {},
) {
  const {
    freshForMs = FRESH_FOR_MS,
    pageSize = PAGE_SIZE,
    maxPerSource = MAX_PER_SOURCE,
    budgetMs = BUDGET_MS,
    now = Date.now,
    log = jsonLog,
  } = options;
  const started = now();
  const updatedBefore = new Date(started - freshForMs);
  const summaries: ESignReconciliationSummary[] = [];
  let stopped: "rate_limited" | "budget" | undefined;
  for (const source of sources) {
    const summary = { kind: source.kind, synced: 0, busy: 0, failed: 0 };
    summaries.push(summary);
    const visited: string[] = [];
    let more = true;
    while (more && !stopped && visited.length < maxPerSource) {
      const limit = Math.min(pageSize, maxPerSource - visited.length);
      const ids = await source.stale({
        updatedBefore,
        exclude: visited,
        limit,
      });
      more = ids.length === limit;
      for (const id of ids) {
        if (now() - started >= budgetMs) {
          stopped = "budget";
          break;
        }
        visited.push(id);
        try {
          await source.sync(id, eSignReconciliationActor);
          summary.synced += 1;
        } catch (error) {
          const code = errorCode(error);
          if (busyErrors.has(code)) {
            summary.busy += 1;
            continue;
          }
          summary.failed += 1;
          log({
            event: "ESIGN_RECONCILE_FAILED",
            kind: source.kind,
            id,
            error: code,
          });
          if (code === "SIGNWELL_HTTP_429") {
            stopped = "rate_limited";
            break;
          }
        }
      }
    }
    // More stale requests than one run reads. The oldest are read first, so
    // the newer ones are not read until the backlog shrinks; logged so an
    // operator sees it and can raise the limit.
    if (
      !stopped &&
      visited.length >= maxPerSource &&
      (await source.stale({ updatedBefore, exclude: visited, limit: 1 })).length
    )
      log({ event: "ESIGN_RECONCILE_CAPPED", kind: source.kind, maxPerSource });
  }
  log({
    event: "ESIGN_RECONCILE_COMPLETE",
    ...(stopped ? { stopped } : {}),
    sources: summaries,
  });
  return { sources: summaries, ...(stopped ? { stopped } : {}) };
}

/**
 * The sources this deployment can reconcile, decided by the same settings the
 * web process uses to send (`mndaConfiguration` and
 * `contractSigningConfiguration` in apps/web): the register's feature flag,
 * the SignWell API key and the webhook id. Clients are built per call, as the
 * web process builds them, so a malformed key fails one request in the log
 * rather than the bootstrap of every task.
 */
export function environmentESignReconciliationSources(
  db: RuntimeDatabase,
  env: Readonly<Record<string, string | undefined>>,
): ESignReconciliationSource[] {
  const apiKey = env.SIGNWELL_API_KEY;
  if (!apiKey || !env.SIGNWELL_WEBHOOK_ID) return [];
  const stale = new ESignReconciliationRepository(db);
  const sources: ESignReconciliationSource[] = [];
  if (env.COMMERCE_MNDA_ENABLED === "true")
    sources.push({
      kind: "mnda",
      stale: (query) => stale.staleMndaRequests(query),
      sync: (id, actor) =>
        new MndaWorkflow(
          new MndaRepository(db),
          new SignWellClient(apiKey),
        ).sync(id, actor),
    });
  if (env.COMMERCE_CONTRACTS_SIGNING_ENABLED === "true")
    sources.push({
      kind: "contract",
      stale: (query) => stale.staleContractSignings(query),
      sync: (id, actor) =>
        new ContractSigningWorkflow(
          new ContractSigningRepository(db, () => {
            // The web process's `documentStores()`: only the database store exists.
            if ((env.COMMERCE_DOCUMENT_STORE ?? "postgres") !== "postgres")
              throw new Error("DOCUMENT_BACKEND_UNAVAILABLE");
            return new ContractDocumentStores(
              new PostgresContractDocumentStore(db),
            );
          }),
          new SignWellContractClient(apiKey),
        ).sync(id, actor),
    });
  return sources;
}

let configured: readonly ESignReconciliationSource[] | undefined;

/** Called by the workflow runtime bootstrap. */
export function configureESignReconciliation(
  sources: readonly ESignReconciliationSource[],
): void {
  configured = sources;
}

/** Test-only lifecycle helper; production bootstraps exactly once. */
export function resetESignReconciliationForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("ESIGN_RECONCILE_RESET_FORBIDDEN");
  configured = undefined;
}

/**
 * One scheduled run. With SignWell not configured for this deployment there
 * is nothing to reconcile: the run says so and succeeds, so the schedule never
 * retries or alarms on a deployment that does not send.
 */
export async function runESignReconciliation(
  scheduledAt: string,
  options: ESignReconciliationOptions = {},
) {
  const log = options.log ?? jsonLog;
  if (!configured?.length) {
    log({
      event: "ESIGN_RECONCILE_SKIPPED",
      reason: configured ? "signwell_not_configured" : "runtime_not_configured",
    });
    return { scheduledAt, skipped: true as const };
  }
  return { scheduledAt, ...(await reconcileESignatures(configured, options)) };
}
