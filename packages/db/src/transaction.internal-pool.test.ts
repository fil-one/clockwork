import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { RuntimeDatabase } from "./client";
import {
  InternalTransactionPoolError,
  internalTransactionConnectionRole,
  withInternalTransaction,
} from "./transaction";

/**
 * A pool handle that reports the role its connection authenticates as, exactly
 * as a postgres-js backed drizzle handle does. `opened` records whether the
 * helper got as far as starting a transaction, which is what distinguishes a
 * refusal from a failure inside the statement.
 */
function pool(user: string | undefined) {
  const opened: string[] = [];
  const handle = {
    ...(user === undefined ? {} : { $client: { options: { user } } }),
    transaction: async <T>(
      callback: (transaction: unknown) => Promise<T>,
    ): Promise<T> => {
      opened.push("begin");
      return callback({
        execute: async () => Promise.resolve([]),
      });
    },
  };
  return { db: handle as unknown as RuntimeDatabase, opened };
}

describe("internal transactions refuse any pool that is not the service pool", () => {
  it("reads the connection role, stripping the Supavisor tenant suffix", () => {
    expect(
      internalTransactionConnectionRole(pool("clockwork_service").db),
    ).toBe("clockwork_service");
    expect(
      internalTransactionConnectionRole(pool("clockwork_runtime.abc123").db),
    ).toBe("clockwork_runtime");
    expect(
      internalTransactionConnectionRole(pool(undefined).db),
    ).toBeUndefined();
  });

  it("refuses the tenant runtime pool without opening a transaction", async () => {
    const runtime = pool("clockwork_runtime");

    await expect(
      withInternalTransaction(runtime.db, "req-runtime", () =>
        Promise.resolve("ran"),
      ),
    ).rejects.toBeInstanceOf(InternalTransactionPoolError);
    expect(runtime.opened).toEqual([]);
  });

  it("refuses a Supavisor tenant username for the runtime role", async () => {
    const runtime = pool("clockwork_runtime.projectref");

    const error = await withInternalTransaction(
      runtime.db,
      "req-supavisor",
      () => Promise.resolve("ran"),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(InternalTransactionPoolError);
    expect((error as InternalTransactionPoolError).connectionRole).toBe(
      "clockwork_runtime",
    );
    expect(runtime.opened).toEqual([]);
  });

  it("fails closed in production when the handle reports no connection role", async () => {
    const unknown = pool(undefined);
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        withInternalTransaction(unknown.db, "req-unknown", () =>
          Promise.resolve("ran"),
        ),
      ).rejects.toBeInstanceOf(InternalTransactionPoolError);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(unknown.opened).toEqual([]);
  });

  /**
   * Outside production the unclassifiable branch is reached only by unit-test
   * doubles, which hold no connection to escalate on. The runtime-role refusal
   * above is unconditional, so this concession never admits the tenant pool.
   */
  it("admits an unclassifiable handle outside production", async () => {
    const unknown = pool(undefined);

    await expect(
      withInternalTransaction(unknown.db, "req-unknown-dev", () =>
        Promise.resolve("ran"),
      ),
    ).resolves.toBe("ran");
    expect(unknown.opened).toEqual(["begin"]);
  });

  it("refuses the tenant pool in production too", async () => {
    const runtime = pool("clockwork_runtime");
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        withInternalTransaction(runtime.db, "req-runtime-prod", () =>
          Promise.resolve("ran"),
        ),
      ).rejects.toBeInstanceOf(InternalTransactionPoolError);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(runtime.opened).toEqual([]);
  });

  it("admits the service pool and the local superuser both roles are granted to", async () => {
    const service = pool("clockwork_service.projectref");
    const local = pool("postgres");

    await expect(
      withInternalTransaction(service.db, "req-service", () =>
        Promise.resolve("ran"),
      ),
    ).resolves.toBe("ran");
    await expect(
      withInternalTransaction(local.db, "req-local", () =>
        Promise.resolve("ran"),
      ),
    ).resolves.toBe("ran");
    expect(service.opened).toEqual(["begin"]);
    expect(local.opened).toEqual(["begin"]);
  });
});

const repositoryRoot = (() => {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!directory.endsWith(`${join("packages", "db")}`)) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Could not locate the @clockwork/db package root");
    directory = parent;
  }
  return dirname(dirname(directory));
})();

function typescriptFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith("."))
        continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
    }
  };
  walk(root);
  return found;
}

/**
 * Static companion to the runtime guard above. The guard cannot be evaded, but
 * it only reports at run time and only where the two pools authenticate as
 * different roles; this fails the build the moment a call site names the
 * tenant-facing handle, on every machine.
 */
describe("no internal transaction is opened on the tenant runtime pool", () => {
  const sources = [
    join(repositoryRoot, "packages", "db", "src"),
    join(repositoryRoot, "packages", "api", "src"),
    join(repositoryRoot, "apps", "web", "src"),
  ].flatMap((root) => typescriptFiles(root));

  it("scans a non-trivial number of sources", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it("never passes options.database to withInternalTransaction", () => {
    const offenders: string[] = [];
    for (const path of sources) {
      const contents = readFileSync(path, "utf8");
      if (!contents.includes("withInternalTransaction(")) continue;
      // The first argument is the pool. Whitespace between the paren and the
      // argument is whatever the formatter chose, so match across newlines.
      const calls = contents.matchAll(/withInternalTransaction\(\s*([^,\n]*)/g);
      for (const call of calls) {
        const argument = (call[1] ?? "").trim();
        if (
          argument === "this.options.database" ||
          argument === "options.database"
        )
          offenders.push(`${relative(repositoryRoot, path)}: ${argument}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
