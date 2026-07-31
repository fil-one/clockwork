import {
  createDemoSeed,
  DEMO_NOW,
  DEMO_SEED_VERSION,
  type DemoSeed,
} from "./seed";

export const DEMO_RESET_COMMAND =
  "pnpm exec tsx packages/testing/src/demo/reset-command.ts" as const;

export type DemoEnvironment = Readonly<Record<string, string | undefined>>;

export interface DemoFixtureStore {
  read(): Promise<DemoSeed>;
  replace(next: DemoSeed): Promise<void>;
}

export interface DemoResetResult {
  readonly target: "demo";
  readonly seedVersion: typeof DEMO_SEED_VERSION;
  readonly resetAt: typeof DEMO_NOW;
  readonly counts: {
    readonly accounts: number;
    readonly agreements: number;
    readonly quotes: number;
    readonly orders: number;
    readonly pocs: number;
    readonly invoices: number;
    readonly queueItems: number;
  };
}

export class DemoResetBlockedError extends Error {
  override readonly name = "DemoResetBlockedError";

  constructor(reason: string) {
    super(`Demo reset refused: ${reason}`);
  }
}

const productionEnvironmentKeys = [
  "NODE_ENV",
  "VERCEL_ENV",
  "CLOCKWORK_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "ENVIRONMENT",
] as const;

function isProduction(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "production";
}

/**
 * This guard intentionally has no force or override flag. A production marker
 * from any supported deployment source wins, even when another marker says
 * development or preview.
 */
export function assertDemoResetAllowed(
  environment: DemoEnvironment,
  target: string,
): asserts target is "demo" {
  const productionMarker = productionEnvironmentKeys.find((key) =>
    isProduction(environment[key]),
  );

  if (productionMarker) {
    throw new DemoResetBlockedError(
      `${productionMarker} identifies a production environment`,
    );
  }

  if (target !== "demo") {
    throw new DemoResetBlockedError(
      `target must be exactly "demo"; received ${JSON.stringify(target)}`,
    );
  }
}

export function createMemoryDemoStore(
  initial: DemoSeed = createDemoSeed(),
): DemoFixtureStore {
  let value = structuredClone(initial);

  return {
    read() {
      return Promise.resolve(structuredClone(value));
    },
    replace(next) {
      value = structuredClone(next);
      return Promise.resolve();
    },
  };
}

export async function resetDemoExperience(
  store: DemoFixtureStore,
  options: {
    readonly environment: DemoEnvironment;
    readonly target: string;
  },
): Promise<DemoResetResult> {
  assertDemoResetAllowed(options.environment, options.target);

  const next = createDemoSeed();
  await store.replace(next);

  return {
    target: "demo",
    seedVersion: DEMO_SEED_VERSION,
    resetAt: DEMO_NOW,
    counts: {
      accounts: next.accounts.length,
      agreements: next.agreements.length,
      quotes: next.quotes.length,
      orders: next.orders.length,
      pocs: next.pocs.length,
      invoices: next.invoices.length,
      queueItems: next.queueItems.length,
    },
  };
}
