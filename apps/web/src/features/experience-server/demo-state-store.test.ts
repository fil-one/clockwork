import {
  createPristineDemoAdapterState,
  resolveDemoStatePath,
} from "@clockwork/testing/demo-state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredDemoStateStore,
  createDemoStateStore,
  DEMO_STATE_BLOB_KEY,
  DEMO_STATE_BLOB_STORE,
  NetlifyBlobsDemoAdapterStateStore,
} from "./demo-state-store";

const blobs = new Map<string, { data: string; etag: string }>();
const openStore = vi.fn();
let writes = 0;

const blobStore = {
  getWithMetadata(key: string) {
    const entry = blobs.get(key);
    return Promise.resolve(
      entry ? { data: entry.data, etag: entry.etag, metadata: {} } : null,
    );
  },
  setJSON(
    key: string,
    data: unknown,
    options?: { onlyIfMatch?: string; onlyIfNew?: boolean },
  ) {
    const current = blobs.get(key);
    if (
      (options?.onlyIfNew && current) ||
      (options?.onlyIfMatch !== undefined &&
        options.onlyIfMatch !== current?.etag)
    )
      return Promise.resolve({ modified: false });
    writes += 1;
    blobs.set(key, { data: JSON.stringify(data), etag: `etag-${writes}` });
    return Promise.resolve({ modified: true, etag: `etag-${writes}` });
  },
};

vi.mock("@netlify/blobs", () => ({
  getStore: (options: unknown) => {
    openStore(options);
    return blobStore;
  },
}));

const blobLocation = `netlify-blobs://${DEMO_STATE_BLOB_STORE}/${DEMO_STATE_BLOB_KEY}`;

beforeEach(() => {
  blobs.clear();
  writes = 0;
  openStore.mockClear();
});

describe("netlify blobs demo state store", () => {
  it("reads pristine state when the key has never been written", async () => {
    const state = await new NetlifyBlobsDemoAdapterStateStore().read();

    expect(state).toEqual(createPristineDemoAdapterState());
    expect(openStore).toHaveBeenCalledWith({
      name: DEMO_STATE_BLOB_STORE,
      consistency: "strong",
    });
  });

  it("makes an update visible to an independent store instance", async () => {
    const store = new NetlifyBlobsDemoAdapterStateStore();

    const written = await store.update((current) => ({
      ...current,
      revision: current.revision + 1,
      projectionOverrides: {
        "quotes/Q-2026-0184-v3": {
          version: 4,
          updatedAt: "2026-07-31T16:05:00.000Z",
          data: { status: "pending" },
        },
      },
    }));

    expect(store.location).toBe(blobLocation);
    expect(written.revision).toBe(1);
    await expect(
      new NetlifyBlobsDemoAdapterStateStore().read(),
    ).resolves.toEqual(written);
  });

  it("restores pristine state through replace", async () => {
    const store = new NetlifyBlobsDemoAdapterStateStore();
    await store.update((current) => ({ ...current, revision: 3 }));

    await store.replace(createPristineDemoAdapterState());

    await expect(store.read()).resolves.toEqual(
      createPristineDemoAdapterState(),
    );
  });

  it("refuses state that is not valid demo state", async () => {
    blobs.set(DEMO_STATE_BLOB_KEY, {
      data: JSON.stringify({
        ...createPristineDemoAdapterState(),
        target: "live",
      }),
      etag: "etag-corrupt",
    });

    await expect(
      new NetlifyBlobsDemoAdapterStateStore().read(),
    ).rejects.toThrow("target must be demo");
  });

  it("retakes an update whose entry was rewritten between its read and its write", async () => {
    const store = new NetlifyBlobsDemoAdapterStateStore();
    await store.update((current) => ({ ...current, revision: 1 }));
    let raced = false;

    const next = await store.update((current) => {
      if (!raced) {
        raced = true;
        blobs.set(DEMO_STATE_BLOB_KEY, {
          data: JSON.stringify({
            ...createPristineDemoAdapterState(),
            revision: 9,
          }),
          etag: "etag-concurrent",
        });
      }
      return { ...current, revision: current.revision + 1 };
    });

    expect(next.revision).toBe(10);
  });
});

describe("demo state store selection", () => {
  it("selects blobs, memory, or the unchanged file store", () => {
    expect(
      createDemoStateStore({ CLOCKWORK_DEMO_STATE_STORE: "netlify-blobs" })
        .location,
    ).toBe(blobLocation);
    expect(
      createDemoStateStore({ CLOCKWORK_DEMO_STATE_STORE: "memory" }).location,
    ).toBe("memory");
    for (const environment of [
      {},
      { CLOCKWORK_DEMO_STATE_STORE: "" },
      { CLOCKWORK_DEMO_STATE_STORE: "blobs" },
    ])
      expect(createDemoStateStore(environment).location).toBe(
        resolveDemoStatePath(),
      );
  });

  it("shares one store per process so a reset reaches the served projections", () => {
    expect(configuredDemoStateStore()).toBe(configuredDemoStateStore());
  });
});
