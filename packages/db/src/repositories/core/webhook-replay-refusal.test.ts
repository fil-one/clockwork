import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { RuntimeDatabase } from "../../client";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  WebhookReplayTaskNotRegisteredError,
  webhookReplayTaskIdentifier,
} from "./database-finance";

const authorizationSecret = "webhook-replay-secret-at-least-32-bytes-long";

/** Records whether the command reached the database at all. */
function pool(user: string) {
  const opened: string[] = [];
  const handle = {
    $client: { options: { user } },
    transaction: (): Promise<never> => {
      opened.push("begin");
      return Promise.reject(new Error("the replay command touched the inbox"));
    },
  };
  return { db: handle as unknown as RuntimeDatabase, opened };
}

describe("operator webhook replay refuses while no task is registered", () => {
  it("rejects with a typed error naming the missing task identifier", async () => {
    const runtime = pool("clockwork_runtime");
    const pricing = pool("clockwork_service");
    const repository = new DatabaseCoreFinanceRepository({
      database: runtime.db,
      pricingDatabase: pricing.db,
      authorizationSecret,
    });

    const error: unknown = await repository
      .replay({
        provider: "stripe",
        eventId: "evt_1",
        actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
        requestId: "webhook-replay-refusal-0001",
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(WebhookReplayTaskNotRegisteredError);
    expect(error).toBeInstanceOf(DatabaseCoreError);
    const refusal = error as WebhookReplayTaskNotRegisteredError;
    // INVALID_STATE is what the API surface renders as a non-retryable 422 and
    // what the operator server action reports as ok: false. A replay must never
    // come back as a success the operator then stops watching.
    expect(refusal.code).toBe("INVALID_STATE");
    expect(refusal.taskIdentifier).toBe(webhookReplayTaskIdentifier("stripe"));
    expect(refusal.message).toContain("webhook-replay:stripe");
  });

  it("does not open a transaction, so the inbox dedupe marker survives", async () => {
    const runtime = pool("clockwork_runtime");
    const pricing = pool("clockwork_service");
    const repository = new DatabaseCoreFinanceRepository({
      database: runtime.db,
      pricingDatabase: pricing.db,
      authorizationSecret,
    });

    await expect(
      repository.replay({
        provider: "workos",
        eventId: "evt_2",
        actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
        requestId: "webhook-replay-refusal-0002",
      }),
    ).rejects.toBeInstanceOf(WebhookReplayTaskNotRegisteredError);

    expect(pricing.opened).toEqual([]);
    expect(runtime.opened).toEqual([]);
  });
});

const repositoryRoot = (() => {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!directory.endsWith(join("packages", "db"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate the @clockwork/db package root");
    directory = parent;
  }
  return dirname(dirname(directory));
})();

function productionWorkflowSources(): string[] {
  const root = join(repositoryRoot, "packages", "workflows", "src");
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith("."))
        continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.includes(".test."))
        found.push(path);
    }
  };
  walk(root);
  return found;
}

/**
 * The refusal above is a stub, and a stub that nothing watches becomes
 * permanent. This fails the moment a replay task is registered, which is the
 * signal to delete WebhookReplayTaskNotRegisteredError and restore the enqueue
 * in DatabaseCoreFinanceRepository.replay.
 */
describe("no replay task is registered in the production workflow tree", () => {
  const sources = productionWorkflowSources();

  it("reads the production task tree", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(
      sources.some((path) => path.endsWith(join("trigger", "discovery.ts"))),
    ).toBe(true);
  });

  it("declares no task id under the webhook-replay namespace", () => {
    const declared: string[] = [];
    for (const path of sources) {
      const contents = readFileSync(path, "utf8");
      for (const match of contents.matchAll(/\bid:\s*"([^"]+)"/g)) {
        const identifier = match[1] ?? "";
        if (identifier.startsWith("webhook-replay"))
          declared.push(`${relative(repositoryRoot, path)}: ${identifier}`);
      }
    }
    expect(
      declared,
      "A webhook replay task now exists. Remove the refusal in packages/db/src/repositories/core/database-finance.ts (WebhookReplayTaskNotRegisteredError) and restore the enqueue, then delete this assertion.",
    ).toEqual([]);
  });

  it("never references the identifier the refusal names", () => {
    const referencing = sources.filter((path) =>
      readFileSync(path, "utf8").includes("webhook-replay"),
    );
    expect(referencing.map((path) => relative(repositoryRoot, path))).toEqual(
      [],
    );
  });
});
