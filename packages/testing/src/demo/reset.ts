import { createDemoSeed, DEMO_NOW, DEMO_SEED_VERSION } from "./seed";
import {
  createPristineDemoAdapterState,
  findDemoProductionMarker,
  parseDemoAdapterState,
  type DemoAdapterState,
  type DemoAdapterStateStore,
} from "./state";

export const DEMO_RESET_COMMAND =
  "pnpm exec tsx packages/testing/src/demo/reset-command.ts" as const;

export type DemoEnvironment = Readonly<Record<string, string | undefined>>;

export type DemoFixtureStore = DemoAdapterStateStore;

export interface DemoResetResult {
  readonly target: "demo";
  readonly seedVersion: typeof DEMO_SEED_VERSION;
  readonly resetAt: typeof DEMO_NOW;
  readonly statePath: string;
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

/**
 * This guard intentionally has no force or override flag. A production marker
 * from any supported deployment source wins, even when another marker says
 * development or preview.
 */
export function assertDemoResetAllowed(
  environment: DemoEnvironment,
  target: string,
): asserts target is "demo" {
  const productionMarker = findDemoProductionMarker(environment);

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
  initial: DemoAdapterState = createPristineDemoAdapterState(),
): DemoFixtureStore {
  let value = parseDemoAdapterState(initial);

  return {
    location: "memory",
    read() {
      return Promise.resolve(structuredClone(value));
    },
    replace(next) {
      return Promise.resolve().then(() => {
        value = parseDemoAdapterState(next);
      });
    },
    update(updater) {
      return Promise.resolve().then(() => {
        const next = parseDemoAdapterState(updater(structuredClone(value)));
        value = next;
        return structuredClone(next);
      });
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

  const seed = createDemoSeed();
  // Refuse to launder an invalid/non-demo state file into an apparently clean
  // reset. Operators must inspect corruption rather than silently erase it.
  await store.read();
  await store.replace(createPristineDemoAdapterState());

  return {
    target: "demo",
    seedVersion: DEMO_SEED_VERSION,
    resetAt: DEMO_NOW,
    statePath: store.location,
    counts: {
      accounts: seed.accounts.length,
      agreements: seed.agreements.length,
      quotes: seed.quotes.length,
      orders: seed.orders.length,
      pocs: seed.pocs.length,
      invoices: seed.invoices.length,
      queueItems: seed.queueItems.length,
    },
  };
}
