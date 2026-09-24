import "server-only";
// i18n-exempt-file: demo state storage errors reach the server log only; never rendered.

import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import {
  createPristineDemoAdapterState,
  DemoStateCorruptError,
  FileDemoAdapterStateStore,
  parseDemoAdapterState,
  type DemoAdapterState,
  type DemoAdapterStateStore,
  type DemoStateEnvironment,
} from "@clockwork/testing/demo-state";
import type { Store } from "@netlify/blobs";

export const DEMO_STATE_STORE_ENVIRONMENT_KEY =
  "CLOCKWORK_DEMO_STATE_STORE" as const;
export const DEMO_STATE_BLOB_STORE = "clockwork-demo-state" as const;
export const DEMO_STATE_BLOB_KEY = "adapter-state.json" as const;

const maximumWriteAttempts = 5;

/**
 * Durable demo state for a serverless deploy. The file store keeps its state on
 * a local disk that a cold start discards, so a demo mutation would disappear
 * mid-conversation. Netlify Blobs with strong consistency gives every function
 * instance the same state, and the entry tag turns the store's read-modify-write
 * into a compare-and-swap, which is this runtime's equivalent of the file
 * store's write lock.
 */
export class NetlifyBlobsDemoAdapterStateStore implements DemoAdapterStateStore {
  public readonly location: string;

  readonly #storeName: string;
  readonly #key: string;
  #store: Store | undefined;

  public constructor(
    storeName: string = DEMO_STATE_BLOB_STORE,
    key: string = DEMO_STATE_BLOB_KEY,
  ) {
    this.#storeName = storeName;
    this.#key = key;
    this.location = `netlify-blobs://${storeName}/${key}`;
  }

  public async read(): Promise<DemoAdapterState> {
    return (await this.#load()).state;
  }

  public async replace(next: DemoAdapterState): Promise<void> {
    const valid = parseDemoAdapterState(next, this.location);
    // Read before the write so a reset cannot launder existing corruption or a
    // non-demo target into an apparently clean state.
    await this.read();
    const store = await this.#openStore();
    await store.setJSON(this.#key, valid);
  }

  public async update(
    updater: (current: DemoAdapterState) => DemoAdapterState,
  ): Promise<DemoAdapterState> {
    for (let attempt = 0; attempt < maximumWriteAttempts; attempt += 1) {
      const { state, etag, present } = await this.#load();
      const next = parseDemoAdapterState(updater(state), this.location);
      const store = await this.#openStore();
      // An entry that exists without a tag cannot be written conditionally.
      // Taking the last write there costs a lost demo mutation under a race;
      // refusing every write would cost the whole demo.
      const written = await store.setJSON(
        this.#key,
        next,
        etag !== undefined
          ? { onlyIfMatch: etag }
          : present
            ? {}
            : { onlyIfNew: true },
      );
      if (written.modified) return structuredClone(next);
    }
    throw new Error(
      `Timed out writing the demo state at ${JSON.stringify(this.location)}`,
    );
  }

  async #openStore(): Promise<Store> {
    // The client is imported and opened on first use. getStore reads the
    // deploy's blob credentials from the environment, and a build that never
    // selects this store keeps the dependency out of its bundle entirely.
    if (!this.#store) {
      const { getStore } = await import("@netlify/blobs");
      this.#store = getStore({ name: this.#storeName, consistency: "strong" });
    }
    return this.#store;
  }

  async #load(): Promise<{
    readonly state: DemoAdapterState;
    readonly etag: string | undefined;
    readonly present: boolean;
  }> {
    const store = await this.#openStore();
    const entry = await store.getWithMetadata(this.#key, { type: "text" });
    // A missing key is the Blobs equivalent of the file store's ENOENT: the
    // demo has not been mutated since its last reset.
    if (!entry)
      return {
        state: createPristineDemoAdapterState(),
        etag: undefined,
        present: false,
      };
    try {
      return {
        state: parseDemoAdapterState(JSON.parse(entry.data), this.location),
        etag: entry.etag,
        present: true,
      };
    } catch (error) {
      if (error instanceof DemoStateCorruptError) throw error;
      throw new DemoStateCorruptError(this.location, "JSON cannot be parsed");
    }
  }
}

export function createDemoStateStore(
  environment: DemoStateEnvironment,
): DemoAdapterStateStore {
  const selection = environment[DEMO_STATE_STORE_ENVIRONMENT_KEY]?.trim();
  if (selection === "netlify-blobs")
    return new NetlifyBlobsDemoAdapterStateStore();
  if (selection === "memory") return createMemoryDemoStore();
  // Every other value, including an unset key, keeps local development and the
  // reset command on the durable file store they use today.
  return new FileDemoAdapterStateStore();
}

let configured: DemoAdapterStateStore | undefined;

/**
 * One store per process. The projection source and the reset route must share
 * an instance, otherwise the in-memory selection would give each caller its own
 * state and a reset would leave the served projections untouched.
 */
export function configuredDemoStateStore(): DemoAdapterStateStore {
  configured ??= createDemoStateStore(process.env);
  return configured;
}
