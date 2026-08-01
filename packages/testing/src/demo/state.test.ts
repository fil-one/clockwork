import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPristineDemoAdapterState,
  DEMO_PRODUCTION_ENVIRONMENT_KEYS,
  FileDemoAdapterStateStore,
  resolveDemoStatePath,
  type DemoAdapterState,
} from "./state";

const workspaceRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function stateFixture(): Promise<{
  directory: string;
  location: string;
  store: FileDemoAdapterStateStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "clockwork-demo-state-"));
  temporaryDirectories.push(directory);
  const location = join(directory, "state.json");
  return {
    directory,
    location,
    store: new FileDemoAdapterStateStore(location),
  };
}

function dirtyState(): DemoAdapterState {
  return {
    ...createPristineDemoAdapterState(),
    revision: 9,
    projectionOverrides: {
      "50000000-0000-4000-8000-000000000004": {
        version: 8,
        updatedAt: "2026-08-01T12:00:00Z",
        data: { status: "pending", title: "Dirty across processes" },
      },
    },
  };
}

function resetEnvironment(location: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS) delete environment[key];
  return {
    ...environment,
    NODE_ENV: "test",
    CLOCKWORK_ENV: "demo",
    CLOCKWORK_DEMO_STATE_PATH: location,
  };
}

describe("durable demo adapter state", () => {
  it("atomically restores dirty state through the reset command in another process", async () => {
    const { directory, location, store } = await stateFixture();
    await store.replace(dirtyState());
    expect((await store.read()).revision).toBe(9);

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: resetEnvironment(location),
        timeout: 30_000,
      },
    );

    if (result.error) throw result.error;
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      target: "demo",
      statePath: location,
    });
    expect(await new FileDemoAdapterStateStore(location).read()).toEqual(
      createPristineDemoAdapterState(),
    );
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("leaves dirty state untouched when the child process sees production", async () => {
    const { location, store } = await stateFixture();
    const dirty = dirtyState();
    await store.replace(dirty);
    const environment = resetEnvironment(location);
    environment.NODE_ENV = "production";

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: environment,
        timeout: 30_000,
      },
    );

    if (result.error) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      "Demo reset refused: NODE_ENV identifies a production environment",
    );
    expect(await new FileDemoAdapterStateStore(location).read()).toEqual(dirty);
  });

  it("makes the reset command fail without changing corrupt non-demo bytes", async () => {
    const { directory, location } = await stateFixture();
    const corrupt = '{"schemaVersion":1,"target":"production"}\n';
    await writeFile(location, corrupt, "utf8");

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: resetEnvironment(location),
        timeout: 30_000,
      },
    );

    if (result.error) throw result.error;
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      `Demo state at ${JSON.stringify(location)} is invalid: target must be demo`,
    );
    expect(await readFile(location, "utf8")).toBe(corrupt);
    expect(await readdir(directory)).toEqual(["state.json"]);
  });

  it("uses an explicit path verbatim and otherwise resolves one ignored workspace artifact", () => {
    expect(
      resolveDemoStatePath(
        { CLOCKWORK_DEMO_STATE_PATH: "isolated/state.json" },
        "/tmp/clockwork-test",
      ),
    ).toBe("/tmp/clockwork-test/isolated/state.json");
    expect(resolveDemoStatePath({}, workspaceRoot)).toBe(
      join(workspaceRoot, ".artifacts", "demo", "state.json"),
    );
  });
});
