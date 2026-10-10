/* eslint-disable @typescript-eslint/require-await -- in-memory sources model the async repository and workflow contracts. */
import { afterEach, expect, it, vi } from "vitest";
import type { RuntimeDatabase } from "@clockwork/db";

import { getTask, listScheduledTasks } from "../tasks/registry";
import {
  configureESignReconciliation,
  eSignReconciliationActor,
  environmentESignReconciliationSources,
  reconcileESignatures,
  resetESignReconciliationForTests,
  runESignReconciliation,
  type ESignReconciliationSource,
} from "./reconciliation";
import "./tasks";

afterEach(() => resetESignReconciliationForTests());

/** Stale ids in oldest-first order; `sync` behaviour per id. */
function source(
  ids: string[],
  outcome: Record<string, Error> = {},
  kind: ESignReconciliationSource["kind"] = "mnda",
) {
  const synced: string[] = [];
  const queries: { exclude: readonly string[]; limit: number }[] = [];
  const stale = vi.fn<ESignReconciliationSource["stale"]>(
    async ({ exclude, limit }) => {
      queries.push({ exclude: [...exclude], limit });
      return ids.filter((id) => !exclude.includes(id)).slice(0, limit);
    },
  );
  const sync = vi.fn<ESignReconciliationSource["sync"]>(async (id) => {
    const error = outcome[id];
    if (error) throw error;
    synced.push(id);
  });
  const value: ESignReconciliationSource = { kind, stale, sync };
  return { value, stale, sync, synced, queries };
}

const quiet = () => {};

it("syncs every stale request through the workflow as the reconciliation actor", async () => {
  const s = source(["a", "b", "c"]);
  const result = await reconcileESignatures([s.value], {
    pageSize: 2,
    log: quiet,
  });
  expect(s.synced).toEqual(["a", "b", "c"]);
  expect(s.sync).toHaveBeenCalledWith("a", eSignReconciliationActor);
  expect(result.sources).toEqual([
    { kind: "mnda", synced: 3, busy: 0, failed: 0 },
  ]);
  // Pages exclude what this run already visited.
  expect(s.queries.map((q) => q.exclude)).toEqual([[], ["a", "b"]]);
});

it("asks only for requests unchanged for ten minutes", async () => {
  const s = source([]);
  await reconcileESignatures([s.value], { now: () => 3_600_000, log: quiet });
  expect(s.stale).toHaveBeenCalledWith(
    expect.objectContaining({ updatedBefore: new Date(3_000_000) }),
  );
});

it("logs a failing request and carries on with the rest", async () => {
  const log = vi.fn();
  const s = source(["a", "b", "c"], { b: new Error("SIGNWELL_HTTP_500") });
  const result = await reconcileESignatures([s.value], { log });
  expect(s.synced).toEqual(["a", "c"]);
  expect(result.sources[0]).toMatchObject({ synced: 2, failed: 1 });
  expect(log).toHaveBeenCalledWith({
    event: "ESIGN_RECONCILE_FAILED",
    kind: "mnda",
    id: "b",
    error: "SIGNWELL_HTTP_500",
  });
});

it("leaves a request another operation holds for the next tick", async () => {
  const log = vi.fn();
  const mnda = source(["a", "b"], { a: new Error("MNDA_BUSY") });
  const contract = source(["c"], { c: new Error("CONTRACT_BUSY") }, "contract");
  const result = await reconcileESignatures([mnda.value, contract.value], {
    log,
  });
  expect(mnda.synced).toEqual(["b"]);
  expect(result.sources).toEqual([
    { kind: "mnda", synced: 1, busy: 1, failed: 0 },
    { kind: "contract", synced: 0, busy: 1, failed: 0 },
  ]);
  expect(log).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: "ESIGN_RECONCILE_FAILED" }),
  );
});

it("stops the run at a SignWell 429, including later registers", async () => {
  const mnda = source(["a", "b"], { a: new Error("SIGNWELL_HTTP_429") });
  const contract = source(["c"], {}, "contract");
  const result = await reconcileESignatures([mnda.value, contract.value], {
    log: quiet,
  });
  expect(result.stopped).toBe("rate_limited");
  expect(mnda.sync).toHaveBeenCalledTimes(1);
  expect(contract.sync).not.toHaveBeenCalled();
});

it("reads at most the per-run limit and reports a backlog", async () => {
  const log = vi.fn();
  const s = source(["a", "b", "c", "d", "e"]);
  await reconcileESignatures([s.value], { maxPerSource: 3, pageSize: 2, log });
  expect(s.synced).toEqual(["a", "b", "c"]);
  expect(s.queries.map((q) => q.limit)).toEqual([2, 1, 1]);
  expect(log).toHaveBeenCalledWith({
    event: "ESIGN_RECONCILE_CAPPED",
    kind: "mnda",
    maxPerSource: 3,
  });
});

it("starts no request once the time budget is spent", async () => {
  let clock = 0;
  const s = source(["a", "b", "c"]);
  s.sync.mockImplementation(async (id) => {
    s.synced.push(id);
    clock += 100;
  });
  const result = await reconcileESignatures([s.value], {
    budgetMs: 200,
    now: () => clock,
    log: quiet,
  });
  expect(s.synced).toEqual(["a", "b"]);
  expect(result.stopped).toBe("budget");
});

it("is a logged no-op when SignWell is not configured for the deployment", async () => {
  const db = {} as RuntimeDatabase;
  expect(environmentESignReconciliationSources(db, {})).toEqual([]);
  expect(
    environmentESignReconciliationSources(db, {
      COMMERCE_MNDA_ENABLED: "true",
      SIGNWELL_API_KEY: "key",
    }),
  ).toEqual([]);
  configureESignReconciliation(environmentESignReconciliationSources(db, {}));
  const log = vi.fn();
  await expect(
    runESignReconciliation("2026-10-09T00:00:00.000Z", { log }),
  ).resolves.toEqual({
    scheduledAt: "2026-10-09T00:00:00.000Z",
    skipped: true,
  });
  expect(log).toHaveBeenCalledWith({
    event: "ESIGN_RECONCILE_SKIPPED",
    reason: "signwell_not_configured",
  });
});

it("is a logged no-op before the runtime is configured", async () => {
  const log = vi.fn();
  await expect(
    runESignReconciliation("2026-10-09T00:00:00.000Z", { log }),
  ).resolves.toMatchObject({ skipped: true });
  expect(log).toHaveBeenCalledWith({
    event: "ESIGN_RECONCILE_SKIPPED",
    reason: "runtime_not_configured",
  });
});

it("reconciles each register the deployment sends from", () => {
  const db = {} as RuntimeDatabase;
  const signWell = { SIGNWELL_API_KEY: "key", SIGNWELL_WEBHOOK_ID: "hook" };
  expect(
    environmentESignReconciliationSources(db, {
      ...signWell,
      COMMERCE_MNDA_ENABLED: "true",
    }).map((s) => s.kind),
  ).toEqual(["mnda"]);
  expect(
    environmentESignReconciliationSources(db, {
      ...signWell,
      COMMERCE_MNDA_ENABLED: "true",
      COMMERCE_CONTRACTS_SIGNING_ENABLED: "true",
    }).map((s) => s.kind),
  ).toEqual(["mnda", "contract"]);
});

it("runs every 15 minutes in staging and production", () => {
  const task = getTask("system.esign.reconcile.v1");
  expect(task).toMatchObject({
    kind: "scheduled",
    cron: "*/15 * * * *",
    stages: ["staging", "production"],
    deliveryTtlMs: 900_000,
  });
  expect(listScheduledTasks().map((t) => t.id)).toContain(
    "system.esign.reconcile.v1",
  );
});
