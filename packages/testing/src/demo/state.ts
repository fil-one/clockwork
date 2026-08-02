import { randomUUID } from "node:crypto";
import { existsSync, type PathLike } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { DEMO_NOW, DEMO_SEED_VERSION } from "./seed";

export const DEMO_STATE_SCHEMA_VERSION = 1 as const;
export const DEMO_STATE_PATH_ENVIRONMENT_KEY =
  "CLOCKWORK_DEMO_STATE_PATH" as const;
export const DEMO_DEPLOY_ENVIRONMENT_KEY = "CLOCKWORK_DEMO_DEPLOY" as const;
export const DEMO_PRODUCTION_ENVIRONMENT_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "CLOCKWORK_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "ENVIRONMENT",
] as const;

export type DemoStateEnvironment = Readonly<Record<string, string | undefined>>;

export interface DemoProjectionOverride {
  readonly version: number;
  readonly updatedAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface DemoActionReceiptState {
  readonly id: string;
  readonly projectionId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly action: string;
  readonly expectedVersion: number;
  readonly status: "queued" | "applied" | "rejected" | "failed";
  readonly resultReference: string | null;
  readonly resultCode: string | null;
  readonly authoritativeVersion: number | null;
  readonly commandReplayed: boolean | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly auditEventId: string;
  readonly outboxMessageId: string;
}

export interface DemoAdapterState {
  readonly schemaVersion: typeof DEMO_STATE_SCHEMA_VERSION;
  readonly target: "demo";
  readonly seedVersion: typeof DEMO_SEED_VERSION;
  readonly resetAt: typeof DEMO_NOW;
  readonly revision: number;
  readonly projectionOverrides: Readonly<
    Record<string, DemoProjectionOverride>
  >;
  readonly actionReceipts: Readonly<Record<string, DemoActionReceiptState>>;
}

export interface DemoAdapterStateStore {
  readonly location: string;
  read(): Promise<DemoAdapterState>;
  replace(next: DemoAdapterState): Promise<void>;
  update(
    updater: (current: DemoAdapterState) => DemoAdapterState,
  ): Promise<DemoAdapterState>;
}

export class DemoStateCorruptError extends Error {
  override readonly name = "DemoStateCorruptError";

  public constructor(location: string, reason: string) {
    super(`Demo state at ${JSON.stringify(location)} is invalid: ${reason}`);
  }
}

export function createPristineDemoAdapterState(): DemoAdapterState {
  return {
    schemaVersion: DEMO_STATE_SCHEMA_VERSION,
    target: "demo",
    seedVersion: DEMO_SEED_VERSION,
    resetAt: DEMO_NOW,
    revision: 0,
    projectionOverrides: {},
    actionReceipts: {},
  };
}

/**
 * A fixture-only demo site is built and served by `next build`/`next start`,
 * which always set NODE_ENV=production. Setting this key to exactly "1" is the
 * one way to say that production NODE_ENV describes the build, not the
 * environment. Nothing else counts: "true", "yes", " 1 " and every other value
 * leave the guard as it was, so no ambient truthy setting can reach demo mode.
 */
export function demoDeployOptIn(environment: DemoStateEnvironment): boolean {
  return environment[DEMO_DEPLOY_ENVIRONMENT_KEY] === "1";
}

export function findDemoProductionMarker(
  environment: DemoStateEnvironment,
): (typeof DEMO_PRODUCTION_ENVIRONMENT_KEYS)[number] | undefined {
  // The opt-in suppresses the NODE_ENV signal alone. A deployment platform that
  // reports production through any of its own markers still refuses, flag or no
  // flag, so a real production environment can never be flipped into demo mode.
  const deployOptIn = demoDeployOptIn(environment);
  return DEMO_PRODUCTION_ENVIRONMENT_KEYS.find(
    (key) =>
      !(deployOptIn && key === "NODE_ENV") &&
      environment[key]?.trim().toLowerCase() === "production",
  );
}

function workspaceRoot(start: string): string {
  let candidate = resolve(start);
  while (true) {
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return resolve(start);
    candidate = parent;
  }
}

export function resolveDemoStatePath(
  environment: DemoStateEnvironment = process.env,
  cwd = process.cwd(),
): string {
  const configured = environment[DEMO_STATE_PATH_ENVIRONMENT_KEY]?.trim();
  if (configured)
    return isAbsolute(configured) ? configured : resolve(cwd, configured);
  return join(workspaceRoot(cwd), ".artifacts", "demo", "state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && Number(value) > 0);
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function validOverride(value: unknown): value is DemoProjectionOverride {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) > 0 &&
    typeof value.updatedAt === "string" &&
    !Number.isNaN(Date.parse(value.updatedAt)) &&
    isRecord(value.data)
  );
}

function validReceipt(value: unknown): value is DemoActionReceiptState {
  if (!isRecord(value)) return false;
  return (
    [
      "id",
      "projectionId",
      "aggregateType",
      "aggregateId",
      "action",
      "createdAt",
      "auditEventId",
      "outboxMessageId",
    ].every((key) => typeof value[key] === "string" && value[key].length > 0) &&
    Number.isSafeInteger(value.expectedVersion) &&
    Number(value.expectedVersion) > 0 &&
    ["queued", "applied", "rejected", "failed"].includes(
      String(value.status),
    ) &&
    nullableString(value.resultReference) &&
    nullableString(value.resultCode) &&
    nullableInteger(value.authoritativeVersion) &&
    nullableBoolean(value.commandReplayed) &&
    nullableString(value.completedAt)
  );
}

export function parseDemoAdapterState(
  value: unknown,
  location = "memory",
): DemoAdapterState {
  if (!isRecord(value))
    throw new DemoStateCorruptError(location, "root must be an object");
  if (value.schemaVersion !== DEMO_STATE_SCHEMA_VERSION)
    throw new DemoStateCorruptError(location, "schema version is unsupported");
  if (value.target !== "demo")
    throw new DemoStateCorruptError(location, "target must be demo");
  if (value.seedVersion !== DEMO_SEED_VERSION)
    throw new DemoStateCorruptError(location, "seed version is unsupported");
  if (value.resetAt !== DEMO_NOW)
    throw new DemoStateCorruptError(location, "reset clock is not canonical");
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
    throw new DemoStateCorruptError(location, "revision must be non-negative");
  if (!isRecord(value.projectionOverrides))
    throw new DemoStateCorruptError(
      location,
      "projectionOverrides must be an object",
    );
  if (!Object.values(value.projectionOverrides).every(validOverride))
    throw new DemoStateCorruptError(location, "projection override is invalid");
  if (!isRecord(value.actionReceipts))
    throw new DemoStateCorruptError(
      location,
      "actionReceipts must be an object",
    );
  if (!Object.values(value.actionReceipts).every(validReceipt))
    throw new DemoStateCorruptError(location, "action receipt is invalid");
  return structuredClone(value) as unknown as DemoAdapterState;
}

async function syncDirectory(path: PathLike): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch {
    // Some supported filesystems do not permit fsync on a directory. The file
    // itself is already synced before its atomic rename.
  } finally {
    await directory?.close();
  }
}

const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;

export class FileDemoAdapterStateStore implements DemoAdapterStateStore {
  public readonly location: string;

  public constructor(location = resolveDemoStatePath()) {
    this.location = resolve(location);
  }

  public async read(): Promise<DemoAdapterState> {
    let serialized: string;
    try {
      serialized = await readFile(this.location, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return createPristineDemoAdapterState();
      throw error;
    }
    try {
      return parseDemoAdapterState(JSON.parse(serialized), this.location);
    } catch (error) {
      if (error instanceof DemoStateCorruptError) throw error;
      throw new DemoStateCorruptError(this.location, "JSON cannot be parsed");
    }
  }

  public async replace(next: DemoAdapterState): Promise<void> {
    const valid = parseDemoAdapterState(next, this.location);
    await this.withLock(async () => {
      // Revalidate under the write lock so a reset cannot hide existing
      // corruption or a non-demo target, including a concurrent change after
      // the reset command's initial safety read.
      await this.read();
      await this.writeUnlocked(valid);
    });
  }

  public async update(
    updater: (current: DemoAdapterState) => DemoAdapterState,
  ): Promise<DemoAdapterState> {
    return this.withLock(async () => {
      const current = await this.read();
      const next = parseDemoAdapterState(updater(current), this.location);
      await this.writeUnlocked(next);
      return structuredClone(next);
    });
  }

  private async writeUnlocked(next: DemoAdapterState): Promise<void> {
    const directory = dirname(this.location);
    await mkdir(directory, { recursive: true });
    const temporary = join(
      directory,
      `.${basename(this.location)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.location);
      await syncDirectory(directory);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const directory = dirname(this.location);
    await mkdir(directory, { recursive: true });
    const lockPath = `${this.location}.lock`;
    const startedAt = Date.now();
    let lock;
    while (!lock) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
        const lockStat = await stat(lockPath).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs > staleLockMs) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - startedAt >= lockTimeoutMs)
          throw new Error(
            `Timed out acquiring the demo-state lock at ${JSON.stringify(lockPath)}`,
          );
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
